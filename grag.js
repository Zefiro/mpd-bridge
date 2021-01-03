#!/usr//bin/node

/*
  TODO
  - move even more into modules
  - change doLater() blackbox to a 'pending tasks list' which can be queried
*/


const app = require('express')()
const http = require('http').Server(app)
const fs = require('fs')
const path = require('path')
const Q = require('q')
const {promisify} = require('util')
const fetch = require('node-fetch')
const base64 = require('base-64')
const dict = require("dict")
const to = require('await-to-js').default
const winston = require('winston')
const { exec } = require("child_process")
const io = require('socket.io')(http)
const dns = require('dns')
const moment = require('moment')
const jsonminify = require("jsonminify")
const jsonc = require('./jsonc')()

console.log('Press <ctrl>+C to exit.')

let sConfigFile = 'prod.json'
console.log("Loading config " + sConfigFile)
let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
let config = jsonc.parse(configBuffer)

async function terminate(errlevel) {
	await Promise.all(god.terminateListeners.map(async listener => { 
		try { 
			await listener() 
		} catch (e) {
			if (this.logger) { this.logger.error("Exception during terminate callback: %o", e) } else { console.log("Exception during terminate callback: ", e) }
		}
	}))
    process.nextTick(function () { process.exit(errlevel) })
}

var god = {
	terminateListeners: [],
	terminate: terminate,
	io: io.of('/browser'),
	ioOnConnected: [],
	state: {},
	onStateChanged: [],
	config: config,
}

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    console.log("Bye, Bye...")
	terminate(0)
})

process.on('error', (err) => {
	console.error("Grag: Unhandled error, terminating")
	console.error(err)
    terminate(0)
})

process.on('unhandledRejection', (reason, promise) => {
	logger.error("Grag: Unhandled Async Rejection at %o, reason %o", promise, reason)
	console.error("Grag: Unhandled Async Rejection at", promise, "reason", reason)
    terminate(0)
})



app.get("/", (req, res) => {
    res.status(301).redirect(config.web.index)
})
app.use('/', require('express').static(__dirname + '/public'))

http.listen(config.web.port, function(){
  logger.info('listening on *:' + config.web.port)
})

function addNamedLogger(name, level = 'debug', label = name) {
    let { format } = require('logform');
	let prettyJson = format.printf(info => {
	  if (info.message.constructor === Object) {
		info.message = JSON.stringify(info.message, null, 4)
	  }
	  return `${info.timestamp} [${info.level}]\t[${info.label}]\t${info.message}`
	})
	let getFormat = (label, colorize = false) => {
		let nop = format((info, opts) => { return info })
		return format.combine(
			colorize ? format.colorize() : nop(),
			format.timestamp({
				format: 'YYYY-MM-DD HH:mm:ss',
			}),
			format.label({ label: label }),
			format.splat(),
			prettyJson
			)
	}
	winston.loggers.add(name, {
	  level: level,
	  transports: [
		new winston.transports.Console({
			format: getFormat(label, true),
		}),
		new winston.transports.File({ 
			format: getFormat(label, false),
			filename: 'winston.log'
		})
	  ]
	})
}

// prepareNamedLoggers
(()=>{
	let knownLoggers = ["main", "web", "mpd1", "mpd2", "gpio", "mqtt", "ubnt", "POS", "Flipdot", "allnet", "tasmota"]
	knownLoggers.forEach(name => {
		let level = config.logger[name] || 'debug'
		addNamedLogger(name, level)
	})
})()
const logger = winston.loggers.get('main')

const mqtt = require('./mqtt')(god)
god.mqtt = mqtt

// initialization race condition, hope for the best... (later code parts could already access mpd1/2 before the async func finishes)
var mpd1
(async () => { mpd1 = await require('./mpd')(god, 'localhost', 'mpd1') })()

var mpd2
(async () => { mpd2 = await require('./mpd')(god, 'grag-hoardpi', 'mpd2') })()

const web = require('./web')(god, app)
const gpio = require('./gpio')(god, 'gpio')
const allnet = require('./allnet')(god, 'allnet')
const ubnt = require('./ubnt')(god, 'ubnt')
const displayPos = require('./POS')(god, 'POS')
const displayFlipdot = require('./Flipdot')(god, 'Flipdot')
const tasmota = require('./tasmota')(god, 'tasmota')


/* Starts a timer to monitor a value
 *
 * Every 'intervalSec' the function 'fnWatch' is queried, then on each change of the return value 'fnOnChange' is called
 */
timer = {
	timers: dict(),
	watchChange: async function(name, intervalSec, fnWatch, fnOnChange) {
		var self = this
		console.log("Timer: added change watch '%s' every %d sec", name, intervalSec)
		var timerId = setInterval(async () => {
			let value = await fnWatch()
			let lastValue = self.timers.get(name).lastValue
			self.timers.get(name).lastValue = value
			if (value != lastValue) {
				console.log("Timer: change detected for '%s': %s -> %s", name, lastValue, value)
				await fnOnChange(value)
			}
		}, intervalSec * 1000)
		self.timers.set(name, { id: timerId })
		return timerId
	}
}

/* Call functions on repeated button presses
 * 
 * Returns an async function which counts invocations and calls the given callback when 'count' invocations have occured in the last 'sec' seconds
 */
var multipress = function(name, count, sec, fn) {
	// init private fields
	if (!this.id) {
		this.id = 0
		this.multipressData = []
	}
	// current id as closure
	let mpId = this.id++
	this.multipressData[mpId] = {
		name: name,
		count: count,
		msec: sec * 1000,
		log: []
	}
	return async () => {
		let mpData = this.multipressData[mpId]
		let now = new Date()
		while (mpData.log.length > 0 && now - mpData.log[0] > mpData.msec) {
			mpData.log.shift()
		}
		mpData.log.push(now)
		if (mpData.log.length >= mpData.count) {
			logger.debug("Multipress '%s' triggered", mpData.name)
			mpData.log = []
			let r = await fn()
			return "mp triggered: " + r
		} else {
			logger.debug("Multipress '%s', count %s of %s", mpData.name, mpData.log.length, mpData.count)
			return "mp=" +  mpData.log.length + "/" + mpData.count
		}
	}
}

// TODO WIP
let laterList = []

let doLaterFunc = undefined
async function doLater(func, seconds) {
	clearTimeout(doLaterFunc)
	timerSpeaker = setTimeout(async function() {
		return await func()
	}, seconds * 1000)
	return "Do something " + seconds + " seconds later"
}

/** Allowed targets and parameters for the proxy
 * key: name of target device
 * url: base url
 * cmd: array of allowed parameters, which are appended to the base url
 */
var proxyCommands = {
	'off': 'Power1 0',
	'on': 'Power1 1',
	'toggle': 'Power1 2',
	'off2': 'Power2 0',
	'on2': 'Power2 1',
	'onb': 'Backlog Power1 1; Delay 50; Power1 0',
}
var proxyCommandsBlinds = {
	'up': 'Backlog Power2 0; Power1 1; Delay 200; Power1 0',
	'down': 'Backlog Power1 0; Power2 1; Delay 200; Power2 0',
}
var proxyTargets = {
	'hoard-light': { 'url': 'http://grag-hoard-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'hoard-fan': { 'url': 'http://grag-hoard-fan.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'container-light': { 'url': 'http://grag-container-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'blinds1': { 'url': 'http://grag-main-blinds.fritz.box/cm?cmnd=', cmd: proxyCommandsBlinds } ,
	'blinds2': { 'url': 'http://grag-main-blinds2.fritz.box/cm?cmnd=', cmd: proxyCommandsBlinds } ,
	'plug1': { 'url': 'http://grag-plug1.fritz.box/cm?cmnd=', cmd: proxyCommands },
}
async function proxy(targetId, cmd) {
	let target = proxyTargets[targetId]
	if (!target) return "[target unknown]"
	if (!target.cmd[cmd]) return "[cmd unknown]"
	let param = encodeURIComponent(target.cmd[cmd])
	try {
		let res = await fetch(target.url + param)
		let resText = await res.text()
		logger.info("proxy " + targetId + " responsed: " + res.status + " " + resText)
		return resText
	} catch(e) {
		logger.error("proxy " + targetId + " Error: ")
		logger.error(e)
		return "[ERROR] " + e
	}
}



// https://stackabuse.com/executing-shell-commands-with-node-js/
function auto_mount(host, filename) {
	exec("/usr/bin/ssh " + host + '.fritz.box "ls -alF /mnt/auto/grag-audio/' + filename + '"', (error, stdout, stderr) => {
		if (error) {
			console.log(`error: ${error.message}`);
			return false;
		}
		if (stderr) {
			console.log(`stderr: ${stderr}`);
			return false;
		}
		console.log(`stdout: ${stdout}`);
		return true
	});
}

function aplay(host, filename) {
	auto_mount(host, filename)
	let lowVolume = host == 'grag-hoardpi' ? 25 : 50
	let device = host == 'grag-hoardpi' ? 'Speaker' : 'Master'
	let cmd =  'amixer set ' + device + ' ' + lowVolume + '%; sudo aplay /mnt/auto/grag-audio/' + filename + '; amixer set ' + device + ' 100%'
	if (host != 'grag') {
		cmd = '/usr/bin/ssh ' + host + '.fritz.box "' + cmd + '"'
	}
	exec(cmd, (error, stdout, stderr) => {
		if (error) {
			console.log(`error: ${error.message}`);
			return false;
		}
		if (stderr) {
			console.log(`stderr: ${stderr}`);
			return false;
		}
		console.log(`stdout: ${stdout}`);
		return true
	});
}

io.of('/browser').on('connection', async (socket) => {
  let ip = socket.client.conn.remoteAddress
  logger.debug('a user connected from %s, socket.id=%s', ip, socket.id)
  // dns is async. If we would wait for it, we might loose subsequent messages. If we postpone logging the 'user connected' line, the log gets out of order (and in case of crashes, might even not be logged at all)
/*
  (async () => {
	  let rdns = await promisify(dns.reverse)(ip).catch(err => { logger.warn("Can't resolve DNS for " + ip + ": " + err) })
	  logger.info(ip + " resolves to " + rdns)
  })()
*/

  socket.on('disconnect', function(data){
    logger.debug('user disconnected, client.id=%s (%s): %s', socket.id, socket.client.conn.remoteAddress, data)
  })
  
  god.ioOnConnected.forEach(callback => callback(socket))

})

/** Send a tasmota-style mqtt command
  * topic excludes the prefix, but does include the relais, e.g. 'grag-main-light/POWER1'
  * topics can be a single string or an array
  */
var mqttAsyncTasmotaCommand = async (topics, message) => {
	if (!Array.isArray(topics)) topics = [ topics ]
	let commands = {}
	for(let i = 0; i < topics.length; i++) {
		let topic = topics[i]
		let command = {
			cmdTopic: 'cmnd/' + topic,
			statTopic: 'stat/' + topic,
		}
		command.uuid = await mqtt.addTrigger(command.statTopic, 'Tasmota', async (trigger, topic, message, packet) => { 
			// TODO check if the received status is the one we wanted
			logger.info("TODO: received %s: %s", topic, message)
			mqtt.removeTrigger(topic, trigger.uuid)
		})
		commands[command.uuid] = command
	}
	let keys = Object.keys(commands)
	for(let i = 0; i < keys.length; i++) {
		command = commands[keys[i]]
		command.publishPromise = mqtt.publish(command.cmdTopic, message)
	}
	// TODO start a timeout timer, which rejects this mqttAsyncTasmotaCommand (and also removes the triggers)
	let res = ''
	for(let i = 0; i < keys.length; i++) {
		command = commands[keys[i]]
		res = await command.publishPromise
		// TODO check for errors
		// TODO handle res for i>0
	}
	// TODO should wait for (and sum up) the callbacks for stat/ and return those instead
	return res
}

// TODO move to mqtt?!
god.mqttAsyncTasmotaCommand = mqttAsyncTasmotaCommand

// returns a callback which changes the global state and cascades the change
// id: global state id, will be set to the mqtt message
var changeState = () => {
	return async (trigger, topic, message, packet) => {
		let id = trigger.id
		let oldState = god.state[id]
		let newState = message.toString()
		god.state[id] = newState
		god.onStateChanged.forEach(cb => cb(id, oldState, newState))
	}
}

var addMqttStatefulTrigger = (topic, id, callback = changeState()) => {
	god.state[id] = undefined
	mqtt.addTrigger(topic, id, callback)
	// trigger a stat call, to get the initial state
	let topic2 = topic.replace('stat', 'cmnd')
	mqtt.publish(topic2, '')
}
// pushes state changes to websocket clients
god.onStateChanged.push((id, oldState, newState) => god.io.emit('state-changed', { id: id, oldState: oldState, newState: newState } ))
god.ioOnConnected.push(socket => socket.emit('state', god.state ))

addMqttStatefulTrigger('stat/grag-flipdot/light', 'flipdot-light')
addMqttStatefulTrigger('stat/grag_plug1/POWER', 'plug1')
//addMqttStatefulTrigger('stat/grag-hoard-fan/POWER1', 'hoard-fan-out')
//addMqttStatefulTrigger('stat/grag-hoard-fan/POWER2', 'hoard-fan-in')
addMqttStatefulTrigger('stat/grag-hoard-fan/POWER', 'hoard-fan-in')
addMqttStatefulTrigger('stat/grag-hoard-light/POWER1', 'hoard-light')
addMqttStatefulTrigger('stat/grag-hoard-light/POWER2', 'hoard-light2')
addMqttStatefulTrigger('stat/grag-attic/POWER1', 'attic-light')
addMqttStatefulTrigger('stat/grag-attic/POWER2', 'main-ventilator')
addMqttStatefulTrigger('stat/grag-main-light/POWER1', 'main-light1')
addMqttStatefulTrigger('stat/grag-main-light/POWER2', 'main-light2')
addMqttStatefulTrigger('stat/grag-main-blinds/POWER1', 'blinds1a')
addMqttStatefulTrigger('stat/grag-main-blinds/POWER2', 'blinds1b', async (trigger, topic, message, packet) => { if (message == 'ON') { mqtt.publish('cmnd/tts/sun-filter-descending', '')}; changeState()(trigger, topic, message, packet) } )
addMqttStatefulTrigger('stat/grag-main-blinds2/POWER1', 'blinds2a')
addMqttStatefulTrigger('stat/grag-main-blinds2/POWER2', 'blinds2b')
addMqttStatefulTrigger('stat/grag-halle-main/POWER1', 'halle-main-light')
addMqttStatefulTrigger('stat/grag-halle-door/POWER1', 'halle-door-light')
addMqttStatefulTrigger('stat/grag-halle-door/POWER2', 'halle-compressor')
addMqttStatefulTrigger('stat/grag-usbsw1/POWER', 'usbsw1')
addMqttStatefulTrigger('stat/grag-usbsw2/POWER', 'usbsw2')
addMqttStatefulTrigger('stat/grag-4plug/POWER1', '4plug-1')
addMqttStatefulTrigger('stat/grag-4plug/POWER2', '4plug-2')
addMqttStatefulTrigger('stat/grag-4plug/POWER3', '4plug-3')
addMqttStatefulTrigger('stat/grag-4plug/POWER4', '4plug-4')
addMqttStatefulTrigger('stat/grag-4plug/POWER5', '4plug-usb')

mqtt.addTrigger('cmnd/tts/fanoff', 'tts-fanoff', async (trigger, topic, message, packet) => { aplay('grag-hoardpi', 'fan-off-60min.wav') })
mqtt.addTrigger('cmnd/tts/sun-filter-descending', 'sun-filter-descending', async (trigger, topic, message, packet) => { aplay('grag', 'sun-filter-descending.wav') })

const ignore = () => {}
let mpMpd1Vol90 = multipress('MPD1 set volume to 90', 3, 2, async () => mpd1.setVolume(90) )
let mpMpd2Vol50 = multipress('MPD2 set volume to 50', 3, 2, async () => mpd2.setVolume(50) )

god.onStateChanged.push((id, oldState, newState) => { if ((id == 'blinds1a' ||id == 'blinds1b') && typeof oldState !== 'undefined') mqttAsyncTasmotaCommand('grag-4plug/POWER1', newState) })


web.addMqttMappingOnOff("main-lights", ['grag-main-light/POWER1', 'grag-main-light/POWER2'])
web.addMqttMappingOnOff("main-ventilator", 'grag-attic/POWER2')

web.addMqttMappingOnOff("hoard-light", 'grag-hoard-light/POWER1')
web.addListener("hoard-light", "toggle",   async (req, res) => proxy('hoard-light', 'toggle'))
web.addListener("hoard-light", "toggle5min",   async (req, res) => doLater(async () => { await proxy('hoard-light', 'toggle') }, 5 * 60))
web.addMqttMappingOnOff("hoard-light2", 'grag-hoard-light/POWER2')

web.addMqttMappingOnOff("attic-light", 'grag-attic/POWER1')

web.addMqttMappingOnOff("halle-main-light", 'grag-halle-main/POWER1')
web.addMqttMappingOnOff("halle-door-light", 'grag-halle-door/POWER1')
web.addMqttMappingOnOff("halle-compressor", 'grag-halle-door/POWER2')

web.addMqttMappingOnOff("usbsw1", 'grag-usbsw1/POWER')
web.addMqttMappingOnOff("usbsw2", 'grag-usbsw2/POWER')

web.addMqttMappingOnOff("4plug-1", 'grag-4plug/POWER1')
web.addMqttMappingOnOff("4plug-2", 'grag-4plug/POWER2')
web.addMqttMappingOnOff("4plug-3", 'grag-4plug/POWER3')
web.addMqttMappingOnOff("4plug-4", 'grag-4plug/POWER4')
web.addMqttMappingOnOff("4plug-usb", 'grag-4plug/POWER5')


web.addListener("xhr", "status", async (req, res) => {
	return '{"text":"Dragon", "time": ' +new Date() +'}'
})


/*
web.addListener("hoard-fan-out", "on",        async (req, res) => proxy('hoard-fan', 'on'))
web.addListener("hoard-fan-out", "off",       async (req, res) => proxy('hoard-fan', 'off'))
web.addListener("hoard-fan-out", "off15min",  async (req, res) => { proxy('hoard-fan', 'on'); aplay('grag-hoardpi', 'fan-off-15min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 15 * 60) } )
web.addListener("hoard-fan-out", "off30min",  async (req, res) => { proxy('hoard-fan', 'on'); aplay('grag-hoardpi', 'fan-off-30min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 30 * 60) } )
web.addListener("hoard-fan-out", "off60min",  async (req, res) => { proxy('hoard-fan', 'on'); aplay('grag-hoardpi', 'fan-off-60min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 60 * 60) } )
*/
web.addListener("hoard-fan-in", "on",        async (req, res) => proxy('hoard-fan', 'on'))
web.addListener("hoard-fan-in", "off",       async (req, res) => proxy('hoard-fan', 'off'))

web.addListener("plug1", "on",       	  async (req, res) => proxy('plug1', 'on'))
web.addListener("plug1", "off",			  async (req, res) => proxy('plug1', 'off'))
web.addListener("plug1", "toggle",        async (req, res) => proxy('plug1', 'onb'))
web.addListener("plug1", "toggle5min",    async (req, res) => doLater(async () => { await proxy('plug1', 'toggle') }, 5 * 60))

// Main MPD
web.addListener("mpd", "fadePause",    	  async (req, res) => mpd1.fadePause(1))
web.addListener("mpd", "fadePauseTest",   async (req, res) => { aplay('grag-hoardpi', 'Front_Center.wav'); return doLater(async () => { await mpd2.fadePause(5) }, 30) } )
web.addListener("mpd", "fadePause5min",   async (req, res) => doLater(async () => { await mpd1.fadePause(45) }, 5 * 60))
web.addListener("mpd", "fadePause10min",  async (req, res) => doLater(async () => { await mpd1.fadePause(45) }, 10 * 60))
web.addListener("mpd", "fadePlay",        async (req, res) => (await mpd1.fadePlay(1)) + " (" + (await mpMpd1Vol90()) + ")" )
web.addListener("mpd", "fadePauseToggle", async (req, res) => mpd1.fadePauseToggle(1, 1))
web.addListener("mpd", "volUp",           async (req, res) => mpd1.changeVolume(+5))
web.addListener("mpd", "volDown",         async (req, res) => mpd1.changeVolume(-5) )
web.addListener("mpd", "status",          async (req, res) => mpd1.getStatus())
web.addListener("mpd", "next",            async (req, res) => mpd1.next())
web.addListener("mpd", "previous",        async (req, res) => mpd1.previous())

web.addListener("mpd", "sync",			  async (req, res) => mpd1.sync(mpd2))

// Hoard MPD
web.addListener("mpd2", "fadePause",       async (req, res) => mpd2.fadePause(1))
web.addListener("mpd2", "fadePause5min",   async (req, res) => doLater(async () => { await mpd2.fadePause(45) }, 5 * 60))
web.addListener("mpd2", "fadePause10min",  async (req, res) => doLater(async () => { await mpd2.fadePause(45) }, 10 * 60))
web.addListener("mpd2", "fadePlay",        async (req, res) => (await mpd2.fadePlay(1)) + " (" + (await mpMpd2Vol50()) + ")" )
web.addListener("mpd2", "fadePauseToggle", async (req, res) => mpd2.fadePauseToggle(1, 1))
web.addListener("mpd2", "volUp",           async (req, res) => mpd2.changeVolume(+5))
web.addListener("mpd2", "volDown",         async (req, res) => mpd2.changeVolume(-5))
web.addListener("mpd2", "status",          async (req, res) => mpd2.getStatus())
web.addListener("mpd2", "next",            async (req, res) => mpd2.next())
web.addListener("mpd2", "previous",        async (req, res) => mpd2.previous())

web.addListener("blinds1", "up",           async (req, res) => proxy('blinds1', 'up'))
web.addListener("blinds1", "down",         async (req, res) => proxy('blinds1', 'down'))

web.addListener("blinds2", "up",           async (req, res) => proxy('blinds2', 'up'))
web.addListener("blinds2", "down",         async (req, res) => proxy('blinds2', 'down'))

web.addListener("redButton", "A",    async (req, res) => { mpd1.fadePauseToggle(5, 2); return "mpd2 toggled" })
web.addListener("redButton", "B",    async (req, res) => { return mqttAsyncTasmotaCommand('grag-main-light/POWER1', 'TOGGLE') + mqttAsyncTasmotaCommand('grag-main-light/POWER2', 'TOGGLE') })
web.addListener("redButton", "ping", async (req, res) => "pong")

gpio.addInput(4, "GPIO 4", async value => { console.log("(main) GPIO: " + value); if (value) mpd1.fadePauseToggle(1, 3) })

allnet.addDevice('10.20.30.41', '1')
web.addListener("allnet1", "on", async (req, res) => { let v = await allnet.setState('1', 'on'); return "Switched Allnet #1 " + v })
web.addListener("allnet1", "off", async (req, res) => { let v = await allnet.setState('1', 'off'); return "Switched Allnet #1 " + v })
web.addListener("allnet1", "status", async (req, res) => { let v = await allnet.getState('1'); return "Allnet #1 is " + v })
allnet.addDevice('10.20.30.42', '2')
web.addListener("allnet2", "on", async (req, res) => { let v = await allnet.setState('2', 'on'); return "Switched Allnet #2 " + v })
web.addListener("allnet2", "off", async (req, res) => { let v = await allnet.setState('2', 'off'); return "Switched Allnet #2 " + v })
web.addListener("allnet2", "status", async (req, res) => { let v = await allnet.getState('2'); return "Allnet #2 is " + v })
	
web.addListener("flipdot-light", "on",       async (req, res) => mqttAsyncTasmotaCommand('grag-flipdot/light', 'ON'))
web.addListener("flipdot-light", "off",      async (req, res) => mqttAsyncTasmotaCommand('grag-flipdot/light', 'OFF'))

web.addListener("flipdot-cfg", "read",      (req, res) => displayFlipdot.controller.getDataForWeb())
web.addListener("flipdot-cfg", "write",      (req, res) => console.log(req) /* displayPos.controller.setDataFromWeb() */ )

/* TODO
  Goal: toggle 'Zapper' based on room light and assumed sunlight
  - room light off, after sunset -> condition kept for 2min? -> zapper on
  - room light on -> condition kept for 5min? -> zapper off
  - blinds up, after sunrise -> condition kept for 15sec? -> zapper off
  
  Needs:
  - a "condition checker" (rule)
  - triggered by events (including time, including sunset/rise times)
  - last-changed timestamp and repeatable timer to check for unchanged condition
  - remember when the condition already triggered (could use the expiring of a timer for that)
 
on AnyEvent
  for all conditions
    update condition status
	status changed?
	  update condition-status-changed timestamp
	  timer running? -> stop
	  condition changed to true? -> start new timer

*/

// TODO move to Flipdot.js ?
let flipdot = async (req, res) => { 
	let text = req.params.sCmd.substring(1)
	let cmd = '\f'
	let spaces = '                    '
	if (text != '') {
		let lines = (text+'\n\n').split(/\r?\n/)
		cmd = '\b' + (lines[0] + spaces).substring(0, 19) + '\n' + (lines[1] + spaces).substring(0, 19)
	console.log("Lines #" + lines.length)
	console.log(lines)
	}	
	console.log("Pushing: " + cmd)
	mqtt.client.publish('grag-flipdot/text', cmd, { retain:true })
	return "Message sent to Flipdot"
}
web.addListener("flipdot", "*",            flipdot)

// TODO move to POS.js ?
let pos = async (req, res) => { 
	let text = req.params.sCmd.substring(1)
	let cmd = '\f'
	let spaces = '                    '
	if (text != '') {
		let lines = (text+'\n\n').split(/\r?\n/)
		cmd = '\f' + (lines[0] + spaces).substring(0, 20) + (lines[1] + spaces).substring(0, 20)
//console.log("Lines #" + lines.length)
//console.log(lines)
	}	
	mqtt.client.publish('grag/pos', cmd, { retain:true })
	return "Message sent to POS"
}
web.addListener("pos", "*",            pos)









let fnMusic = async () => {
	if (!mpd1) return ""
	let status = await mpd1.getStatus()
	if (status.state == "play") {
		return "Currently playing\n" + (moment().second() % 4 < 2 ? status.Name : status.Title)
	}
	return '' // "no music playing"
}



//displayPos.addEntry(displayPos.controller.fnText('welcome', '     Welcome to\n       Clawtec'))
displayPos.addEntry(displayPos.controller.fnTime('time'))
displayPos.addEntry(displayPos.controller.fnSunfilter('sunfilter'))
displayPos.addEntry(displayPos.controller.fnCallback('mpd', 'Main MPD Status', fnMusic))

displayFlipdot.addEntry(displayFlipdot.controller.fnText('welcome', '     Welcome to\n       Clawtec'))
displayFlipdot.addEntry(displayFlipdot.controller.fnTime('time'))
displayFlipdot.addEntry(displayFlipdot.controller.fnSunset('sunfilter'))


//displayPos.controller.setDataFromWeb({ welcome: { active: false }})
//console.log(displayPos.controller.getDataForWeb())


/* Tasmota Config
- common to all devices
    # don't use DNS for mqtt
    Backlog mqtthost 10.20.30.40; mqttport 1883; mqttuser <username>; mqttpassword <password>; topic <device_topic>;
	# https://tasmota.github.io/docs/Commands/#timezone
    TimeZone 99
	Backlog latitude 49.039296;	longitude 8.283805
	SetOption1 1
- grag-flur-light
	DeviceName Flur Light
	webbutton1 Licht
	webbutton2 Licht2
	Timers 1
	Timer1 {"Arm":1,"Mode":2,"Time":"-00:20","Window":0,"Days":"1111111","Repeat":1,"Output":2,"Action":3}
	Timer2 {"Arm":1,"Mode":1,"Time":"00:00","Window":0,"Days":"1111111","Repeat":1,"Output":2,"Action":3}
	rule1 on Clock#Timer=1 do backlog power1 1; endon on Clock#Timer=2 do backlog power1 0; power2 0; endon
	rule1 1
- grag-hoard-light
    Template: {"NAME":"Shelly 2.5","GPIO":[56,0,17,0,21,83,0,0,6,128,5,22,156],"FLAG":2,"BASE":18}
	DeviceName Hoard Light
	webbutton1 Deckenlicht
	webbutton2 (empty)
	SwitchMode1 0
	SetOption73 1
	rule1 1
	rule1 ON Power1#state DO var1 %value% ENDON on Button3#state=11 do Backlog Power1 toggle; Publish cmnd/grag-mpd2/statei %var1%; Publish cmnd/grag-hoard-fan/POWER2 %var1% endon
- grag-hoard-fan
	DeviceName Hoard Fan
	webbutton1 Lüfter
	webbutton2 (empty)
	SwitchMode1 9
	Timers 1
	Rule1 on Switch1#state=3 do backlog power1 1; RuleTimer1 3600; publish cmnd/tts/fanoff 60 endon on Rules#Timer=1 do power1 off endon ON Power1#state DO Power2 %value% ENDON
	rule 1
	TEMPORARY
	  Configure Template: GPIO4=Relay1, GPIO15=Relay2 -> GPIO4=None, GPIO15=Relay1
      Rule1 on Switch1#state=3 do backlog power 1; RuleTimer1 3600; publish cmnd/tts/fanoff 60 endon on Rules#Timer=1 do power off endon
- grag-main-blinds
	DeviceName Main Blinds
	powerretain 1
	WebButton1 Hoch
	WebButton2 Runter
	SwitchMode1 1
	SwitchMode2 1
	SETOPTION80 0
	INTERLOCK ON
	INTERLOCK 1,2
	PulseTime1 0
	PulseTime2 0
	ShutterInvert1 1
	ShutterButton1 1 up 1
	ShutterButton1 2 down 1
	ShutterOpenDuration1 30
	ShutterCloseDuration1 30
	SwitchMode1 9
	SwitchMode2 9
	rule1 on Switch1#state=3 do backlog power1 1; delay 300; power1 0 endon on Switch2#state=3 do backlog power2 1; delay 300; power2 0 endon on Clock#Timer=1 do backlog power2 1; delay 300; power2 0 endon
	rule1 1
	Timers 1
	Timer1 {"Arm":1,"Mode":2,"Time":"00:20","Window":0,"Days":"1111111","Repeat":1,"Output":2,"Action":3}
  close shutter completely, then: ShutterSetClose
  open shutter halfway, then: ShutterSetHalfway
*/

/* Voice Output
- Glados from http://15.ai
  "The fan will be switched off in XX minutes"

*/