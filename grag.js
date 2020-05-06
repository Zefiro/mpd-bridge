#!/usr//bin/node

/*
  TODO
  - move even more into modules
  - change doLater() blackbox to a 'pending tasks list' which can be queried
*/


const app = require('express')()
const http = require('http').Server(app)
const fs = require('fs')
const fsa = fs.promises
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
const chokidar = require('chokidar')
const moment = require('moment')

console.log('Press <ctrl>+C to exit.')

let sConfigFile = 'prod.json'
console.log("Loading config " + sConfigFile)
let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
let config = JSON.parse(configBuffer)

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
	console.error("Unhandled error, terminating")
	console.error(err)
    terminate(0)
})

process.on('unhandledRejection', (err) => {
	console.error("Unhandled Async Rejection, terminating")
	console.error(err)
    terminate(0)
})



// TODO this should be configurable
app.get("/", (req, res) => {
    res.status(301).redirect("grag.html")
})
app.use('/', require('express').static(__dirname + '/public'))

// TODO this should be configurable
http.listen(1080, function(){
  logger.info('listening on *:1080')
})

function addNamedLogger(name, level = 'debug', label = name) {
    let { format } = require('logform');
	let prettyJson = format.printf(info => {
	  if (info.message.constructor === Object) {
		info.message = "doesn't work :( " + JSON.stringify(info.message, null, 4)
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

addNamedLogger('main', 'debug')
addNamedLogger('web', 'info')
addNamedLogger('mpd1', 'debug')
addNamedLogger('mpd2', 'debug')
addNamedLogger('gpio', 'debug')
addNamedLogger('mqtt', 'info')
addNamedLogger('ubnt', 'debug')
addNamedLogger('DisplayControl', 'debug')
const logger = winston.loggers.get('main')

// initialization race condition, hope for the best...
var mpd1 
(async () => { mpd1 = await require('./mpd')(god, 'localhost', 'mpd1') })()

var mpd2
(async () => { mpd2 = await require('./mpd')(god, 'mendrapi', 'mpd2') })()

const web = require('./web')(god, app)
const gpio = require('./gpio')(god)
const mqtt = require('./mqtt')(god)
const ubnt = require('./ubnt')(god)


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
function multipress(name, count, sec, fn) {
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
	'onb': 'Backlog Power1 1; Delay 50; Power1 0',
}
var proxyCommandsBlinds = {
	'up': 'Backlog Power2 0; Power1 1; Delay 450; Power1 0',
	'down': 'Backlog Power1 0; Power2 1; Delay 450; Power2 0',
}
var proxyTargets = {
	'hoard-light': { 'url': 'http://grag-hoard-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'hoard-fan': { 'url': 'http://grag-hoard-fan.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'container-light': { 'url': 'http://grag-container-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'blinds1': { 'url': 'http://grag-main-blinds.fritz.box/cm?cmnd=', cmd: proxyCommandsBlinds } ,
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

sunsetCache = { cachedUntil: moment() }
async function getTasmotaSunset() {
	if (moment().isBefore(sunsetCache.cachedUntil)) { return sunsetCache }
	try {
		let res = await fetch('http://grag-main-blinds.fritz.box/tm')
		// TODO check if res.status == 200
		let resText = await res.text()
//		logger.debug("TEST " + " responsed: " + res.status + " " + resText)
		let match = resText.match(/<b>Sunrise<\/b>\s\(([0-9:]+)\).*<b>Sunset<\/b>\s\(([0-9:]+)\)/)
		// TODO check if match.length == 3
		let sunrise = moment(match[1], "HH:mm")
		let sunset = moment(match[2], "HH:mm")
		logger.debug("Sunrise: %o, Sunset: %o", sunrise.format(), sunset.format())
		// TODO read offset from rule (perhaps also check if rule is active at all / today)
		let blindsDown = moment(sunset).add(30, 'm')
		let cachedUntil = moment().add(15, 'm')
		sunsetCache = { sunrise: sunrise, sunset: sunset, blindsDown: blindsDown, cachedUntil: cachedUntil }
		return sunsetCache
	} catch(e) {
		logger.error("Error getting sunset: ")
		logger.error(e)
		throw e
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
	let lowVolume = host == 'mendrapi' ? 15 : 50
	let cmd =  'amixer set Speaker ' + lowVolume + '%; aplay /mnt/auto/grag-audio/' + filename + '; amixer set Speaker 100%'
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
  logger.info('a user connected from %s, socket.id=%s', ip, socket.id)
  // dns is async. If we would wait for it, we might loose subsequent messages. If we postpone logging the 'user connected' line, the log gets out of order (and in case of crashes, might even not be logged at all)
/*
  (async () => {
	  let rdns = await promisify(dns.reverse)(ip).catch(err => { logger.warn("Can't resolve DNS for " + ip + ": " + err) })
	  logger.info(ip + " resolves to " + rdns)
  })()
*/

  socket.on('disconnect', function(data){
    logger.warn('user disconnected, client.id=' + socket.id)
	logger.warn(data)
  })
  
  god.ioOnConnected.forEach(callback => callback(socket))

})

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

addMqttStatefulTrigger('stat/grag_plug1/POWER', 'plug1')
addMqttStatefulTrigger('stat/grag-hoard-fan/POWER1', 'hoard-fan')
addMqttStatefulTrigger('grag-hoard-light/stat/POWER1', 'hoard-light')
addMqttStatefulTrigger('stat/grag-main-blinds/POWER1', 'blinds1a')
addMqttStatefulTrigger('stat/grag-main-blinds/POWER2', 'blinds1b', async (trigger, topic, message, packet) => { if (message == 'ON') { mqtt.publish('cmnd/tts/sun-filter-descending', '')}; changeState()(trigger, topic, message, packet) } )
mqtt.addTrigger('cmnd/tts/fanoff', 'tts-fanoff', async (trigger, topic, message, packet) => { aplay('mendrapi', 'fan-off-30min.wav') })
mqtt.addTrigger('cmnd/tts/sun-filter-descending', 'sun-filter-descending', async (trigger, topic, message, packet) => { aplay('grag', 'sun-filter-descending.wav') })

const ignore = () => {}
let mpMpd1Vol90 = multipress('MPD1 set volume to 90', 3, 2, async () => mpd1.setVolume(90) )
let mpMpd2Vol50 = multipress('MPD2 set volume to 50', 3, 2, async () => mpd2.setVolume(50) )

web.addListener("hoard-light", "on",       async (req, res) => proxy('hoard-light', 'on'))
web.addListener("hoard-light", "off",       async (req, res) => proxy('hoard-light', 'off'))
web.addListener("hoard-light", "toggle",       async (req, res) => proxy('hoard-light', 'toggle'))
web.addListener("hoard-light", "toggle5min",   async (req, res) => doLater(async () => { await proxy('hoard-light', 'toggle') }, 5 * 60))

web.addListener("hoard-fan", "on",       async (req, res) => proxy('hoard-fan', 'on'))
web.addListener("hoard-fan", "off",       async (req, res) => proxy('hoard-fan', 'off'))
web.addListener("hoard-fan", "off15min",   async (req, res) => { proxy('hoard-fan', 'on'); aplay('mendrapi', 'fan-off-15min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 15 * 60) } )
web.addListener("hoard-fan", "off30min",   async (req, res) => { proxy('hoard-fan', 'on'); aplay('mendrapi', 'fan-off-30min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 30 * 60) } )
web.addListener("hoard-fan", "off60min",   async (req, res) => { proxy('hoard-fan', 'on'); aplay('mendrapi', 'fan-off-60min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 60 * 60) } )

web.addListener("plug1", "on",       async (req, res) => proxy('plug1', 'on'))
web.addListener("plug1", "off",       async (req, res) => proxy('plug1', 'off'))
web.addListener("plug1", "toggle",       async (req, res) => proxy('plug1', 'onb'))
web.addListener("plug1", "toggle5min",   async (req, res) => doLater(async () => { await proxy('plug1', 'toggle') }, 5 * 60))

web.addListener("mpd", "fadePause",       async (req, res) => mpd1.fadePause(1))
web.addListener("mpd", "fadePauseTest",   async (req, res) => { aplay('mendrapi', 'Front_Center.wav'); return doLater(async () => { await mpd2.fadePause(5) }, 30) } )
web.addListener("mpd", "fadePause5min",   async (req, res) => doLater(async () => { await mpd1.fadePause(45) }, 5 * 60))
web.addListener("mpd", "fadePause10min",  async (req, res) => doLater(async () => { await mpd1.fadePause(45) }, 10 * 60))
web.addListener("mpd", "fadePlay",        async (req, res) => (await mpd1.fadePlay(1)) + " (" + (await mpMpd1Vol90()) + ")" )
web.addListener("mpd", "fadePauseToggle", async (req, res) => mpd1.fadePauseToggle(1, 1))
web.addListener("mpd", "volUp",           async (req, res) => mpd1.changeVolume(+5))
web.addListener("mpd", "volDown",         async (req, res) => mpd1.changeVolume(-5) )
web.addListener("mpd", "status",          async (req, res) => mpd1.getStatus())
web.addListener("mpd", "next",            async (req, res) => mpd1.next())
web.addListener("mpd", "previous",        async (req, res) => mpd1.previous())

web.addListener("mpd", "sync",       	   async (req, res) => mpd1.sync(mpd2))

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

web.addListener("redButton", "A",    async (req, res) => { mpd2.fadePauseToggle(); return "mpd2 toggled" })
web.addListener("redButton", "B",    async (req, res) => { proxy('hoard-light', 'toggle'); return "Hoard-Light toggled" })
web.addListener("redButton", "ping", async (req, res) => "pong")

gpio.addInput(4, "GPIO 4", async value => { console.log("(main) GPIO: " + value); if (value) mpd1.fadePauseToggle(1, 3) })

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

const watcher = chokidar.watch('/dev/ttyACM0', { persistent: true })
// Something to use when events are received.
const log = console.log.bind(console);
// Add event listeners.
watcher
  .on('add', async path => onPOSready())
  .on('unlink', async path => onPOSremoved())
god.terminateListeners.push(async () => watcher.close())

// lsusb
//   Bus 001 Device 006: ID 0416:f012 Winbond Electronics Corp.
// modprobe usbserial vendor=0x0416 product=0xf012
// -> /dev/ttyACM0
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
async function onPOSready() {
	logger.info("POS is available");
	await mqtt.addTrigger('grag/pos', 'pos', async (trigger, topic, message, packet) => { 
		let cmd = message
		fnWriteToPOS(cmd)
	})
}
async function onPOSremoved() {
	logger.info("POS has been removed");
	await mqtt.removeTrigger('grag/pos')
}

function sanitizeLines(text, lines, columns, prefix = '', newline = '', suffix = '') {
	let cmd = '\f'
	let spaces = '                                                            '
	if (text != '') {
		let lines = (text+'\n\n').split(/\r?\n/)
		cmd = prefix + (lines[0] + spaces).substring(0, columns) + newline + (lines[1] + spaces).substring(0, columns) + suffix
	}	
	return cmd
}

// POS has 2x20 chars. Wraps around on end of line. Supports backspace and newline. \f clears screen (flickering) and ensures the cursor is at home
async function fnWriteToPOS(content) {
	// TODO check if POS is connected
	let cmd = sanitizeLines(content, 2, 20, '\b\n')
	logger.info("POS: '" + cmd + "'")
	try {
		await fsa.writeFile('/dev/ttyACM0', cmd) 
	} catch (e) {
		logger.error("POS: can't write to serial console: %o", e);
	}
}

// Flipdot has 2x18 (or 19?) chars. Stays in the same line, overwriting the last char, thus needs \n. \b clears screen (probably too fast for flickering?)
async function fnWriteToFlipdot(content) {
	let cmd = sanitizeLines(content, 2, 18, '\b', '\n')
	logger.info("Flipdot: '" + cmd + "'")
	mqtt.client.publish('grag-flipdot/text', cmd, { retain:true })
}


let fnSunfilter = async () => {
	try {
		let times = await getTasmotaSunset()
		let now = moment()	
		let content = ''
		if (now.isBefore(times.sunrise)) {
			content = 'Sunrise is\n' + times.sunrise.from(now)
		} else if (now.isBefore(times.sunset)) {
			content = 'Sunset is\n' + times.sunset.from(now)
		} else if (now.isBefore(times.blindsDown)) {
			content = 'Sunfilter descending\n' + times.blindsDown.fromNow()
		} else {
			content = 'Sunrise is\n' + times.sunrise.add(1, 'd').from(now)
		}
		return content
	} catch(e) {
		return "-- ERROR --"
	}
}

let fnSunset = async () => {
	try {
		let times = await getTasmotaSunset()
		let now = moment()	
		let content = ''
		if (now.isBefore(times.sunrise)) {
			content = 'Sunrise is\n' + times.sunrise.from(now)
		} else if (now.isAfter(times.sunset)) {
			content = 'Sunrise is\n' + times.sunrise.add(1, 'd').from(now)
		} else {
			content = 'Sunset is\n' + times.sunset.from(now)
		}
		return content
	} catch(e) {
		return "-- ERROR --"
	}
}

const displayPos = require('./DisplayControl')(god)
displayPos.fnUpdate = async content => fnWriteToPOS(content)
displayPos.addEntry('welcome', '     Welcome to\n       Clawtec')
displayPos.addEntry('time', async () => moment().format("dddd, DD.MM.YYYY") + '\n      ' + moment().format("H:mm:ss"))
displayPos.addEntry('sunfilter', fnSunfilter)

const displayFlipdot = require('./DisplayControl')(god)
displayFlipdot.fnUpdate = async content => fnWriteToFlipdot(content)
displayFlipdot.addEntry('welcome', '     Welcome to\n       Clawtec')
displayFlipdot.addEntry('time', async () => moment().format("dddd, DD.MM.YYYY") + '\n      ' + moment().format("H:mm"))
displayFlipdot.addEntry('sunfilter', fnSunset)




/* Tasmota Config
- common to all devices
    Backlog mqtthost grag.fritz.box; mqttport 1883; mqttuser <username>; mqttpassword <password>; topic <device_topic>;
    TimeZone 99
- grag-hoard-light
	FriendlyName Hoard Light
	webbutton1 Deckenlicht
	webbutton2 (empty)
	SwitchMode1 0
- grag-hoard-fan
	FriendlyName Hoard Fan
	webbutton1 Lüfter
	webbutton2 (empty)
	SwitchMode1 9
	Timers 1
	Rule1 on Switch1#state=3 do backlog power1 1; RuleTimer1 1800; publish cmnd/tts/fanoff 30 endon on Rules#Timer=1 do power1 off endon
	rule 1
- grag-main-blinds
	FriendlyName Main Blinds
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
	rule1 on Switch1#state=3 do backlog power1 1; delay 300; power1 0 endon on Switch2#state=3 do backlog power2 1; delay 300; power2 0 endon on Clock#Timer=1 do backlog power2 1;
	rule1 1
	delay 300; power2 0 endon
	latitude 49.039296
	longitude 8.283805
	Timers 1
	Timer1 {"Arm":1,"Mode":2,"Time":"00:30","Window":0,"Days":"1111111","Repeat":1,"Output":2,"Action":3}
	# https://tasmota.github.io/docs/Commands/#timezone
  close shutter completely, then: ShutterSetClose
  open shutter halfway, then: ShutterSetHalfway
*/

/* Voice Output
- Glados from http://15.ai
  "The fan will be switched off in XX minutes"

*/