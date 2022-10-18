#!/usr//bin/node

/**

  --> Look into https://github.com/cotko/mpd-api

  TODO: Fix this:
Extender: button 0 pressed
status:
{ volume: 73,
  state: 'pause',
  song: '4',
  filename: 'http://hirschmilch.de:7000/electronic.mp3',
  stream: true }
Starting playlist file http://hirschmilch.de:7000/electronic.mp3
Extender: button 0 released
Unhandled Async Rejection, committing suicide
Error:  [5@0] {} Failed to decode http://hirschmilch.de:7000/electronic.mp3; CURL failed: Resolving timed out after 10009 milliseconds
    at MpdClient.receive (/home/zefiro/prog/mpd-bridge/node_modules/mpd/index.js:57:17)
    at Socket.<anonymous> (/home/zefiro/prog/mpd-bridge/node_modules/mpd/index.js:37:12)
    at emitOne (events.js:116:13)
    at Socket.emit (events.js:211:7)
    at addChunk (_stream_readable.js:263:12)
    at readableAddChunk (_stream_readable.js:246:13)
    at Socket.Readable.push (_stream_readable.js:208:10)
    at TCP.onread (net.js:601:20)


 And also this:
Unhandled Async Rejection, committing suicide
{ Error: This socket has been ended by the other party
    at Socket.writeAfterFIN [as write] (net.js:376:12)
    at MpdClient.send (/home/zefiro/prog/mpd-bridge/node_modules/mpd/index.js:131:15)
    at MpdClient.sendCommand (/home/zefiro/prog/mpd-bridge/node_modules/mpd/index.js:87:8)
    at bound  (internal/util.js:235:26)
    at mpdCommand (/home/zefiro/prog/mpd-bridge/server.js:91:30)
    at getStatus (/home/zefiro/prog/mpd-bridge/server.js:436:21)
    at fadePlay (/home/zefiro/prog/mpd-bridge/server.js:506:21)
    at Object.extender.addListener [as callback] (/home/zefiro/prog/mpd-bridge/server.js:286:100)
    at listeners.forEach.e (/home/zefiro/prog/mpd-bridge/extender.js:73:7)
    at Array.forEach (<anonymous>) code: 'EPIPE' }

And here:
events.js:183
      throw er; // Unhandled 'error' event
      ^

Error: read ECONNRESET
    at TCP.onread (net.js:622:25)

*/

/* see https://unix.stackexchange.com/questions/81754/how-can-i-match-a-ttyusbx-device-to-a-usb-serial-device
   # lsusb && ll /sys/bus/usb-serial/devices && ls -l /dev/serial/by-id
 add this to /etc/udev/rules.d/50-usb.rules, then activate with 'udevadm control --reload-rules && udevadm trigger'
----------------------------------------------------------------------------------------------------
SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", ATTRS{idProduct}=="2303", SYMLINK+="ttyWoDoInCo", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="ttyExtender", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", SYMLINK+="ttyZWave", MODE="0666"
----------------------------------------------------------------------------------------------------

 Bus 001 Device 005: ID 10c4:ea60 Cygnal Integrated Products, Inc. CP210x UART Bridge / myAVR mySmartUSB light
 usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0 -> ../../ttyUSB0
 -> ZWave

 Bus 001 Device 004: ID 067b:2303 Prolific Technology, Inc. PL2303 Serial Port
 usb-Prolific_Technology_Inc._USB-Serial_Controller-if00-port0 -> ../../ttyWoDoInCo

 Bus 001 Device 006: ID 1a86:7523 QinHeng Electronics HL-340 USB-Serial adapter
 usb-1a86_USB2.0-Serial-if00-port0 -> ../../ttyExtender

*/

const app = require('express')()
const http = require('http').Server(app)
const fs = require('fs')
const path = require('path')
const Q = require('q')
const {promisify} = require('util')
const base64 = require('base-64')
var SqueezeServer = require('squeezenode')
var squeeze = new SqueezeServer('http://localhost', 9000)
const dict = require("dict")
const to = require('await-to-js').default
const winston = require('winston')

// Warning: async loading
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

console.log('Press <ctrl>+C to exit.')

let sConfigFile = 'prod.json'
console.log("Loading config " + sConfigFile)
let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
let config = JSON.parse(configBuffer)

var god = {
	terminateListeners: [],
	config: config,
	app: app,
	ioOnConnected: [],
}

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

addNamedLogger('main', 'debug')
addNamedLogger('web', 'warn')
addNamedLogger('mpd', 'warn')
const logger = winston.loggers.get('main')

// TODO add loggers
const wodoinco = require('./wodoinco')('/dev/ttyWoDoInCo')
const extender = require('./extender')('/dev/ttyExtender')

// initialization race condition, hope for the best...
var mpd
(async () => { mpd = await require('./mpd')(god, 'localhost', 'mpd') })()

const web = require('./web')(god)

// TODO this should be configurable
app.get("/", (req, res) => {
    res.status(301).redirect("medusa.html")
})
app.use('/', require('express').static(__dirname + '/public'))

// TODO this should be configurable
http.listen(8080, function(){
  logger.info('listening on *:8080')
})



/*
TODO commented out until this is fixed - it happens on Medusa reboot
Squeeze players:
{ Error: connect ECONNREFUSED 127.0.0.1:9000
    at Object._errnoException (util.js:992:11)
    at _exceptionWithHostPort (util.js:1014:20)
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1186:14)
  code: 'ECONNREFUSED',
  errno: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 9000,
  ok: false }
Unhandled Async Rejection, committing suicide
TypeError: Cannot read property '0' of undefined
    at /home/zefiro/prog/mpd-bridge/server.js:80:48
    at <anonymous>
    at process._tickCallback (internal/process/next_tick.js:188:7)


function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

var squeezePlayer
squeeze.on('register', async function(){
    let players = await new Promise((resolve, reject) => squeeze.getPlayers(resolve))
	if (players.result.length == 0) {
		console.log("No Squeeze players found")
		return
	}
	squeezePlayer = squeeze.players[players.result[0].playerid]
	console.log("Found Squeeze player '%s'", squeezePlayer.name)
	console.log(squeezePlayer)
	
	squeezePlayer.setVolume(100)
	
	let squeezePromisify = (fn) => {
		return promisify((...args) => {
			let callback = args.pop()
			args.push(reply => {
				callback(!reply.ok, reply.result)
			})
			fn.apply(null, args)
		})
	}

	const [ squeezeGetMode, squeezeSetVolume, squeezePlay, squeezePause ] = [squeezePlayer.getMode, squeezePlayer.setVolume, squeezePlayer.play, squeezePlayer.pause ].map(fn => fn.bind(squeezePlayer)).map(squeezePromisify)

	let r = await squeezeGetMode()
	console.log("Let's see what we got:")
	console.log(r)
	
	let r2 = await squeezeSetVolume(100)
	console.log("And now:")
	console.log(r2)
	
	await squeezePause()
	console.log(await squeezeGetMode())
	await sleep(1000)
	await squeezePlay()
	console.log(await squeezeGetMode())

});
//*/

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

let doLaterFunc = undefined
async function doLater(func, seconds) {
	clearTimeout(doLaterFunc)
	timerSpeaker = setTimeout(async function() {
		return await func()
	}, seconds * 1000)
	return "Do something " + seconds + " seconds later"
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


async function regalbrett(scenarioName) {
	try {
		console.log("Regalbrett: setting scenario " + scenarioName)
		let res = await fetch('http://regalbrett.dyn.cave.zefiro.de/scenario/' + scenarioName)
		console.log("Regalbrett responsed: " + res.status + " " + await res.text())
	} catch(e) {
		console.log("Regalbrett Error: ")
		console.log(e)
	}
}

async function regalbrettCmd(cmdName) {
	try {
		console.log("Regalbrett: calling command " + cmdName)
		let res = await fetch('http://regalbrett.dyn.cave.zefiro.de/cmd/' + cmdName)
		console.log("Regalbrett responsed: " + res.status + " " + await res.text())
	} catch(e) {
		console.log("Regalbrett Error: ")
		console.log(e)
	}
}

async function sendIgor(cmdName) {
	try {
		console.log("Igor: calling command " + cmdName)
		let res = await fetch(config.igor.baseUrl + cmdName, {
			headers: { 'Authorization': 'Basic ' + base64.encode("igor:" + config.igor.passwd) }
		})
		console.log("Igor responsed: " + res.status + " " + await res.text())
	} catch(e) {
		console.log("Igor Error: ")
		console.log(e)
	}
}

var openhabMapping = dict({
	"light_sofa": 'DeckenlichtWohnzimmer_Sofa',
	"light_pc": 'DeckenlichtWohnzimmer_PC',
	"light_wc": 'DeckenlichtBad_Switch',
	"alarm": 'Alarm_Switch',
	"FensterLedNetz": 'FensterLednetz_Switch', // TODO needs new device
    "Regalbrett": 'Regalbrett_Switch',
    "Regalbrett2": 'Regalbrett2_Switch',
    "Monitors": 'PCMonitors_Switch',
	'waschmaschine': 'Waschmaschine_Switch',
	'pum': 'FreeWilly_Switch',
})

async function openhab(item, action) {
	let itemId = openhabMapping.get(item)
	if (!itemId) {
		console.log("OpenHAB: item '" + item + "' unknown")
		return
	}
	console.log("OpenHAB: sending '" + action + "' to item " + item + " (" + itemId + ")")
	try {
		let res = await fetch('http://localhost:8081/rest/items/' + itemId, { method: "POST", headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' }, body: action })
		let resText = await res.text()
		console.log("OpenHAB response to (%s %s) was %s %s: %s", item, action, resText, res.status, res.statusText)
	} catch(e) {
		console.log("OpenHAB Error:", e)
	}
}

/* Return the current status of an item in openhab, or (optionally) the value of a specific field in it
 */
async function openhabQuery(item, key) {
	let itemId = openhabMapping.get(item)
	if (!itemId) {
		console.log("OpenHAB: item '" + item + "' unknown")
		return
	}
//	console.log("OpenHAB: querying status of item " + item + " (" + itemId + ")")
	try {
		let res = await fetch('http://localhost:8081/rest/items/' + itemId, { method: "GET", headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' } })
		let resJson = await res.json()
		let data = key ? resJson[key] : resJson
//		console.log("OpenHAB response for item '%s':", item, data)
		return data
	} catch(e) {
		console.log("OpenHAB Error:", e)
	}
}

let timerSpeaker = undefined
async function extender2(item, value) {
	let txt = ""
	if (item == "Speaker") {
		clearTimeout(timerSpeaker)
		if (value == "on") {
			txt = "S11"
			console.log("Setting Speaker to on")
		} else if (value == "off") {
			txt = "S10"
			console.log("Setting Speaker to off")
		} else if (value == "timed-off") {
			timerSpeaker = setTimeout(function() {
				console.log("Timeout: switching off Speaker")
				extender2("Speaker", "off")
			}, 10 * 60 * 1000)
			console.log("Setting timer for Speaker")
			return
		} else {
			console.log("Unknown command for Speaker: " + value)
		}
	}
	let result = await extender.send(txt);
	console.log("Extender2: result='" + result + "'")
}

async function wodoinco2(item, value) {
	let txt = ""
	if (item == "Light") {
		if (value == "on") {
			txt = "1"
			console.log("Switching Light on")
		} else if (value == "off") {
			txt = "2"
			console.log("Switching Light off")
		} else {
			console.log("Unknown command for Light: " + value)
		}
	}
	let result = await wodoinco.send(txt);
	console.log("Wodoinco2: result='" + result + "'")
}

const ignore = () => {}
let mpMpdVol90 = multipress('MPD set volume to 90', 3, 1, async () => mpd.setVolume(90) )

// Test for Eslar / Slushmachine
// "[1-56 effect] [0-255 red] [0-255 green] [0-255 blue] [z.B. 1000 speed]"
// https://github.com/kitesurfer1404/WS2812FX
web.addListener("client", "0",         async (req, res) => "2 0 255 0 1000")
web.addListener("client", "1",         async (req, res) => "2 64 128 192 1000")
web.addListener("client", "2",         async (req, res) => "2 0 255 0 1000")
web.addListener("client", "3",         async (req, res) => "2 250 100 20 1000")


web.addListener("mpd", "fadePause",       async (req, res) => mpd.fadePause(1))
web.addListener("mpd", "fadePause5min",   async (req, res) => doLater(async () => { extender2('Speaker', 'timed-off'); await mpd.fadePause(45) }, 5 * 60))
web.addListener("mpd", "fadePause10min",   async (req, res) => doLater(async () => { extender2('Speaker', 'timed-off'); await mpd.fadePause(45) }, 10 * 60))
web.addListener("mpd", "fadePlay",        async (req, res) => (await mpd.fadePlay(1)) + " (" + (await mpMpdVol90()) + ")" )
web.addListener("mpd", "fadePauseToggle", async (req, res) => mpd.fadePauseToggle(1, 1))
web.addListener("mpd", "volUp",           async (req, res) => mpd.changeVolume(+5))
web.addListener("mpd", "volDown",         async (req, res) => mpd.changeVolume(-5))

// configstring for ESP_RedButton should be:
// "http://medusa.cave.zefiro.de:8080/redButton/", "A", "B", "ping" };
//web.addListener("redButton", "A",    async (req, res) => fadePauseToggle(1, 1))
web.addListener("redButton", "A",    async (req, res) => { regalbrett('alarm'); openhab('alarm', 'ON'); return "alarmed" })
web.addListener("redButton", "B",    async (req, res) => { regalbrett('calm'); openhab('alarm', 'OFF'); return "calmed" })
web.addListener("redButton", "ping", async (req, res) => "pong")

web.addListener("cave", "speakerOn",         async (req, res) => extender2('Speaker', 'on'))
web.addListener("cave", "speakerOff",        async (req, res) => extender2('Speaker', 'off'))
web.addListener("cave", "LightOn",         async (req, res) => { openhab('light_sofa', 'ON'); openhab('light_pc', 'ON') })
web.addListener("cave", "LightOff",         async (req, res) => { openhab('light_sofa', 'OFF'); openhab('light_pc', 'OFF') })
web.addListener("cave", "Pum",         async (req, res) => { openhab('pum', 'TOGGLE') })

wodoinco.addListener("A Tast A",  async (txt) => { console.log("WoDoInCo: Light toggled: " + txt) })
wodoinco.addListener("A Tast B",  async (txt) => { extender2('Speaker', 'on'); console.log((await mpd.fadePlay(2)) + " (" + (await mpMpdVol90()) + ")" ) })
wodoinco.addListener("A Tast C",  async (txt) => { extender2('Speaker', 'timed-off'); console.log(await mpd.fadePause(45)) })
wodoinco.addListener("A Tast Do", async (txt) => { console.log(await changeVolume(+2)) })
wodoinco.addListener("A Tast Du", async (txt) => { console.log(await changeVolume(-2)) })

wodoinco.addListener("A PC Light to 0", ignore )
wodoinco.addListener("A PC Light to 1", ignore )

var regalbrettSetTime = multipress('Regalbrett - set Time', 3, 1, async () => { regalbrettCmd('setTime') } )
// TODO doesn't work reliably, possibly due to async calling of openhab, and getting the order mixed up?
var openhabLightsOff = multipress('OpenHAB - Lights off', 3, 1, async () => { openhab('light_sofa', 'OFF'); openhab('light_pc', 'OFF') } )

extender.addListener(0 /* green           */, 1, async (pressed, butValues) => { console.log((await mpd.fadePlay(2)) + " (" + (await mpMpdVol90()) + ")" ) })
extender.addListener(1 /* red             */, 1, async (pressed, butValues) => { console.log(await mpd.fadePause(0)) })
extender.addListener(2 /* tiny blue       */, 1, async (pressed, butValues) => { openhab('alarm', 'TOGGLE') })
extender.addListener(3 /* tiny red        */, 1, async (pressed, butValues) => { regalbrett('alarm') })
extender.addListener(4 /* tiny yellow     */, 1, async (pressed, butValues) => { regalbrett('disco'); openhab('light_sofa', 'ON'); openhab('light_pc', 'ON'); openhabLightsOff() })
extender.addListener(5 /* tiny green      */, 1, async (pressed, butValues) => { regalbrett('calm'); openhab('alarm', 'OFF'); regalbrettSetTime() })
extender.addListener(6 /* red switch (on) */, 1, async (pressed, butValues) => { extender2('Speaker', 'on'); wodoinco2('Light', 'on') })
extender.addListener(6 /* red switch (off)*/, 0, async (pressed, butValues) => { extender2('Speaker', 'off'); wodoinco2('Light', 'off') })
extender.addListener(7 /* big blue switch */, 1, async (pressed, butValues) => { /*openhab('FensterLedNetz', 'ON');*/ openhab('Monitors', 'ON'); openhab('Regalbrett', 'ON'); openhab('Regalbrett2', 'ON'); /* sendIgor('home') */ })
extender.addListener(7 /* big blue switch */, 0, async (pressed, butValues) => { /*openhab('FensterLedNetz', 'OFF');*/ openhab('Monitors', 'OFF'); openhab('Regalbrett', 'OFF'); openhab('Regalbrett2', 'OFF') })

/*
var waschmaschine = {}
timer.watchChange("WaMa_On", 60, () => openhabQuery('waschmaschine', 'state'), (state) => { if (state == 'ON') { waschmaschine.onSince = new Date(); regalbrett('blue_fire') } else { waschmaschine.onSince = null }})
timer.watchChange("WaMa_Finished", 60, () => waschmaschine.onSince && (new Date() - waschmaschine.onSince > 90 * 60 * 1000), (value) => { if (value) { regalbrett('green_fire'); console.log(waschmaschine.onSince); waschmaschine.onSince += 5 * 60 * 1000; console.log(waschmaschine.onSince) } })
*/
