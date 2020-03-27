#!/usr//bin/node

/*
  TODO
  - include MQTT
  - move even more into modules
  - change doLater() blackbox to a 'pending tasks list' which can be queried
  - use socket.io to continously update mpd status on the web
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
const { exec } = require("child_process");

console.log('Press <ctrl>+C to exit.')

let sConfigFile = 'prod.json'
console.log("Loading config " + sConfigFile)
let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
let config = JSON.parse(configBuffer)

function terminate(errlevel) {
	god.terminateListeners.forEach(listener => listener())
    process.nextTick(function () { process.exit(errlevel) })
}

var god = {
	terminateListeners: [],
	terminate: terminate,
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
	let getFormat = (label, colorize = false) => {
		let nop = format((info, opts) => { return info })
		return format.combine(
			colorize ? format.colorize() : nop(),
			format.timestamp({
				format: 'YYYY-MM-DD HH:mm:ss',
			}),
			format.label({ label: label }),
			format.splat(),
			format.printf(info => `${info.timestamp} [${info.level}] [${info.label}] \t${info.message}`)
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
			filename: 'ledstrip.log'
		})
	  ]
	})
}

addNamedLogger('main', 'debug')
addNamedLogger('web', 'info')
addNamedLogger('mpd1', 'debug')
addNamedLogger('mpd2', 'debug')
addNamedLogger('gpio', 'debug')
const logger = winston.loggers.get('main')

// initialization race condition, hope for the best...
var mpd1 
(async () => { mpd1 = await require('./mpd')(god, 'localhost', 'mpd1') })()

var mpd2
(async () => { mpd2 = await require('./mpd')(god, 'mendrapi', 'mpd2') })()

const web = require('./web')(god, app)
const gpio = require('./gpio')(god)


/* Starts a timer to monitor a value
 *
 * Every 'intervalSec' the function 'fnWatch' is queried, then on each change of the return value 'fnOnChange' is called
 */
timer = {
	timers: dict(),
	watchChange: async function(name, intervalSec, fnWatch, fnOnChange) {
		var self = this
		// TODO winston
		console.log("Timer: added change watch '%s' every %d sec", name, intervalSec)
		var timerId = setInterval(async () => {
			let value = await fnWatch()
			let lastValue = self.timers.get(name).lastValue
			self.timers.get(name).lastValue = value
			if (value != lastValue) {
				// TODO winston
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
			// TODO winston
			logger.debug("Multipress '%s' triggered", mpData.name)
			mpData.log = []
			let r = await fn()
			return "mp triggered: " + r
		} else {
			// TODO winston
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
var proxyTargets = {
	'hoard-light': { 'url': 'http://grag-hoard-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'hoard-fan': { 'url': 'http://grag-hoard-fan.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'container-light': { 'url': 'http://grag-container-light.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
	'main-blinds': { 'url': 'http://grag-main-blinds.fritz.box/cm?cmnd=', cmd: proxyCommands } ,
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
	let lowVolume = 10
	exec("/usr/bin/ssh " + host + '.fritz.box "amixer set Speaker ' + lowVolume + '%; aplay /mnt/auto/grag-audio/' + filename + '; amixer set Speaker 100%"', (error, stdout, stderr) => {
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

const ignore = () => {}
let mpMpd1Vol90 = multipress('MPD1 set volume to 90', 3, 2, async () => mpd1.setVolume(90) )
let mpMpd2Vol50 = multipress('MPD2 set volume to 50', 3, 2, async () => mpd2.setVolume(50) )

web.addListener("hoard-light", "on",       async (req, res) => proxy('hoard-light', 'on'))
web.addListener("hoard-light", "off",       async (req, res) => proxy('hoard-light', 'off'))
web.addListener("hoard-light", "toggle",       async (req, res) => proxy('hoard-light', 'toggle'))
web.addListener("hoard-light", "toggle5min",   async (req, res) => doLater(async () => { await proxy('hoard-light', 'toggle') }, 5 * 60))

web.addListener("hoard-fan", "on",       async (req, res) => proxy('hoard-fan', 'on'))
web.addListener("hoard-fan", "off",       async (req, res) => proxy('hoard-fan', 'off'))
web.addListener("hoard-fan", "off5min",   async (req, res) => { aplay('mendrapi', 'fan-off-5min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 5 * 60) } )
web.addListener("hoard-fan", "off15min",   async (req, res) => { aplay('mendrapi', 'fan-off-15min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 15 * 60) } )
web.addListener("hoard-fan", "off60min",   async (req, res) => { aplay('mendrapi', 'fan-off-60min.wav'); return doLater(async () => { await proxy('hoard-fan', 'off') }, 60 * 60) } )

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
web.addListener("mpd", "volDown",         async (req, res) => mpd1.changeVolume(-5))
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

gpio.addInput(4, "GPIO 4", async value => { console.log("(main) GPIO: " + value); if (value) mpd1.fadePauseToggle(1, 3) })





