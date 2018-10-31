#!/usr//bin/node

const app = require('express')()
const Q = require('q')
const http = require('http').Server(app)
const {promisify} = require('util')
const fetch = require('node-fetch');
var SqueezeServer = require('squeezenode');
var squeeze = new SqueezeServer('http://localhost', 9000);
const dict = require("dict")

/* see https://unix.stackexchange.com/questions/81754/how-can-i-match-a-ttyusbx-device-to-a-usb-serial-device
   # lsusb && ll /sys/bus/usb-serial/devices && ls -l /dev/serial/by-id
 add this to /etc/udev/rules.d/50-usb.rules
----------------------------------------------------------------------------------------------------
SUBSYSTEM=="tty", ATTRS{idVendor}=="067b", ATTRS{idProduct}=="2303", SYMLINK+="ttyWoDoInCo", MODE="0666"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", SYMLINK+="ttyExtender", MODE="0666"
----------------------------------------------------------------------------------------------------
*/

// Bus 001 Device 005: ID 10c4:ea60 Cygnal Integrated Products, Inc. CP210x UART Bridge / myAVR mySmartUSB light
// usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0 -> ../../ttyUSB0
// -> ZWave

// Bus 001 Device 004: ID 067b:2303 Prolific Technology, Inc. PL2303 Serial Port
// usb-Prolific_Technology_Inc._USB-Serial_Controller-if00-port0 -> ../../ttyWoDoInCo
const wodoinco = require('./wodoinco')('/dev/ttyWoDoInCo')

// Bus 001 Device 006: ID 1a86:7523 QinHeng Electronics HL-340 USB-Serial adapter
// usb-1a86_USB2.0-Serial-if00-port0 -> ../../ttyExtender
const extender = require('./extender')('/dev/ttyExtender')

const web = require('./web')(app)

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    console.log("Bye, Bye...")
    process.nextTick(function () { process.exit(0) })
})

process.on('unhandledRejection', (err) => {
	console.error("Unhandled Async Rejection, committing suicide")
	console.error(err)
    process.nextTick(function () { process.exit(0) })
})


const mpd = require('mpd')

var client = mpd.connect({
  port: 6600,
  host: 'localhost',
})

const mpdSend = promisify(client.sendCommand.bind(client))
const mpdCommand = (a, b) => mpdSend(mpd.cmd(a, b))

var mpd_connected = false

client.on('ready', function() {
  console.log("mpd ready");
  mpd_connected = true
})

client.on('system', function(name) {
//  console.log("update", name);
})

client.on('system-player', function() {
//
})

app.use('/', require('express').static(__dirname + '/public'))

/*
var squeezePlayer
squeeze.on('register', function(){
    let players = await promisify(squeeze.getPlayers)()
	console.log("Squeeze players:") 
	console.dir(players)
	squeezePlayer = squeeze.players[reply.result[0].playerid]
	console.log(squeeze.players)
	
	let reply = await promisify(squeezePlayer.setVolume)(100)
	console.log("set volume: " + reply)
});
*/

http.listen(8080, function(){
  console.log('listening on *:8080')
})

// Test for Eslar / Slushmachine
// "[1-56 effect] [0-255 red] [0-255 green] [0-255 blue] [z.B. 1000 speed]"
// https://github.com/kitesurfer1404/WS2812FX
web.addListener("client", "0",         async (req, res) => "2 0 255 0 1000")
web.addListener("client", "1",         async (req, res) => "2 64 128 192 1000")
web.addListener("client", "2",         async (req, res) => "2 0 255 0 1000")
web.addListener("client", "3",         async (req, res) => "2 250 100 20 1000")


web.addListener("mpd", "fadePause",       async (req, res) => fadePause(1))
web.addListener("mpd", "fadePlay",        async (req, res) => fadePlay(1))
web.addListener("mpd", "fadePauseToggle", async (req, res) => fadePauseToggle(1, 1))
web.addListener("mpd", "volUp",           async (req, res) => changeVolume(+5))
web.addListener("mpd", "volDown",         async (req, res) => changeVolume(-5))

// configstring for ESP_RedButton should be:
// "http://medusa.cave.zefiro.de:8080/redButton/", "A", "B", "ping" };
web.addListener("redButton", "A",    async (req, res) => fadePauseToggle(1, 1))
web.addListener("redButton", "B",    async (req, res) => { regalbrett('calm'); openhab('alarm', 'OFF'); return "calmed" })
web.addListener("redButton", "ping", async (req, res) => "pong")

web.addListener("cave", "speakerOn",         async (req, res) => extender2('Speaker', 'on'))
web.addListener("cave", "speakerOff",        async (req, res) => extender2('Speaker', 'off'))
web.addListener("cave", "LightOn",         async (req, res) => { openhab('light_sofa', 'ON'); openhab('light_pc', 'ON') })
web.addListener("cave", "LightOff",         async (req, res) => { openhab('light_sofa', 'OFF'); openhab('light_pc', 'OFF') })

wodoinco.addListener("A Tast A",  async (txt) => { console.log("WoDoInCo: Light toggled: " + txt) })
wodoinco.addListener("A Tast B",  async (txt) => { extender2('Speaker', 'on'); console.log(await fadePlay(2)) })
wodoinco.addListener("A Tast C",  async (txt) => { extender2('Speaker', 'timed-off'); console.log(await fadePause(5)) })
wodoinco.addListener("A Tast Do", async (txt) => { console.log(await changeVolume(+2)) })
wodoinco.addListener("A Tast Du", async (txt) => { console.log(await changeVolume(-2)) })

extender.addListener(0 /* green           */, 1, async (pressed, butValues) => { console.log(await fadePlay(2)); })
extender.addListener(1 /* red             */, 1, async (pressed, butValues) => { console.log(await fadePause(0)) })
extender.addListener(2 /* tiny blue       */, 1, async (pressed, butValues) => { openhab('alarm', 'TOGGLE') })
extender.addListener(3 /* tiny red        */, 1, async (pressed, butValues) => { regalbrett('alarm') })
extender.addListener(4 /* tiny yellow     */, 1, async (pressed, butValues) => { regalbrett('disco'); openhab('light_sofa', 'OFF'); openhab('light_pc', 'OFF') })
extender.addListener(5 /* tiny green      */, 1, async (pressed, butValues) => { regalbrett('calm'); openhab('alarm', 'OFF') })
extender.addListener(6 /* red switch (on) */, 1, async (pressed, butValues) => { extender2('Speaker', 'on'); wodoinco2('Light', 'on') })
extender.addListener(6 /* red switch (off)*/, 0, async (pressed, butValues) => { extender2('Speaker', 'off'); wodoinco2('Light', 'off') })
extender.addListener(7 /* big blue switch */, 1, async (pressed, butValues) => { openhab('FensterLedNetz', 'ON'); openhab('Monitors', 'ON'); openhab('Regalbrett', 'ON'); openhab('Regalbrett2', 'ON') })
extender.addListener(7 /* big blue switch */, 0, async (pressed, butValues) => { openhab('FensterLedNetz', 'OFF'); openhab('Monitors', 'OFF'); openhab('Regalbrett', 'OFF'); openhab('Regalbrett2', 'OFF') })

// TODO WIP
var waschmaschine = {}

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


timer.watchChange("WaMa_On", 60, () => openhabQuery('waschmaschine', 'state'), (state) => { if (state == 'ON') { waschmaschine.onSince = new Date(); regalbrett('blue_fire') } else { waschmaschine.onSince = null }})
timer.watchChange("WaMa_Finished", 60, () => waschmaschine.onSince && (new Date() - waschmaschine.onSince > 90 * 60 * 1000), (value) => { if (value) { regalbrett('green_fire'); console.log(waschmaschine.onSince); waschmaschine.onSince += 5 * 60 * 1000; console.log(waschmaschine.onSince) } })


console.log('Press <ctrl>+C to exit.')

var mpdstatus = {}

async function regalbrett(scenarioName) {
	try {
		console.log("Regalbrett: setting scenario " + scenarioName)
		let res = await fetch('http://regalbrett.dyn.cave.zefiro.de/scenario/' + scenarioName)
		console.log("Regalbrett responsed: " + await res.text())
	} catch(e) {
		console.log("Regalbrett Error: ")
		console.log(e)
	}
}

var openhabMapping = dict({
	"light_sofa": 'zwave_device_controller_node5_switch_binary2',
	"light_pc": 'zwave_device_controller_node5_switch_binary',
	"light_wc": 'zwave_device_controller_node10_switch_binary',
	"alarm": 'Alarm',
	"FensterLedNetz": 'FensterLednetz_Switch',
    "Regalbrett": 'SwitchRegalbrett_Switch',
    "Regalbrett2": 'ZWaveNode4_Switch',
    "Monitors": 'PC_Monitors',
	'waschmaschine': 'Waschmaschine_Switch',
})

async function openhab(item, action) {
	let itemId = openhabMapping.get(item)
	if (!itemId) {
		console.log("OpenHAB: item '" + item + "' unknown")
		return
	}
	console.log("OpenHAB: sending '" + action + "' to item " + item + " (" + itemId + ")")
	try {
		let res = await fetch('http://localhost/rest/items/' + itemId, { method: "POST", headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' }, body: action })
		let resText = await res.text()
		console.log("OpenHAB responsed (" + res.status + " " + res.statusText + "): " + resText)
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
		let res = await fetch('http://localhost/rest/items/' + itemId, { method: "GET", headers: { 'Content-Type': 'text/plain', 'Accept': 'application/json' } })
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
			}, 5 * 60 * 1000)
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

async function getStatus() {
    var msg = await mpdCommand("status", [])
//	console.log(msg)
	var reg1 = /volume:\s(\d*)/m
	var reg2 = /state:\s(\w*)/m
	var reg3 = /song:\s(\w*)/m
	mpdstatus.volume = Number(reg1.exec(msg)[1])
	mpdstatus.state = reg2.exec(msg)[1]
	mpdstatus.song = reg3.exec(msg)[1]

    mpdstatus.filename = ""
    mpdstatus.stream = false
	
	if (mpdstatus.song) {
		var msg2 = await mpdCommand("playlistinfo", [mpdstatus.song])
//		console.log("Playlist info:")
//		console.log(msg2);
    	var reg4 = /file:\s(.*)/m
    	var reg5 = /\w+:\/\/\w+/
		mpdstatus.filename = reg4.exec(msg2)[1]
		if (reg5.exec(mpdstatus.filename)) {
			mpdstatus.stream = true
		}
	}
    return mpdstatus
}

var volumeFader = {
	startVolume: 0,
	endVolume: 0,
	resetVolume: 0,
	targetState: undefined,
	callback: undefined,
	startDate: 0,
	endDate: 0
}

async function fadePauseToggle(iDelayTimePauseSec, iDelayTimePlaySec) {
	var status = await getStatus()
	if (status.state != "play" || (faderTimerId && volumeFader.targetState != "play")) {
		return await fadePlay(iDelayTimePlaySec)
	} else {
		return await fadePause(iDelayTimePauseSec)
	}
}

async function fadePause(iDelayTimeSec) {
	var status = await getStatus()
	if (status.state == "play" || (faderTimerId && volumeFader.targetState == "play")) {
		volumeFader.startVolume = status.volume
		volumeFader.endVolume = 0
		volumeFader.targetState = "pause"
		faderTimerId || (volumeFader.resetVolume = status.volume)
		volumeFader.callback = async function() {
			console.log("Fadedown completed")
			await mpdCommand("pause", [1])
			await mpdCommand("setvol", [volumeFader.resetVolume])
		}
		volumeFader.startDate = Date.now()
		volumeFader.endDate = Date.now() + iDelayTimeSec * 1000
		startFading()
		var msg = "Starting fade-down (from " + status.volume + ", reset to " + volumeFader.resetVolume + ", in " + iDelayTimeSec + " sec)"
		return msg
	} else {
		return "not playing"
	}
}

async function fadePlay(iDelayTimeSec) {
	var status = await getStatus()
console.log("status: ")
console.log(status)
	if (status.state != "play" || (faderTimerId && volumeFader.targetState != "play")) {
		volumeFader.startVolume = (faderTimerId && volumeFader.targetState != "play") ? status.volume : 0
		volumeFader.endVolume = faderTimerId ? volumeFader.resetVolume : status.volume
		volumeFader.targetState = "play"
		faderTimerId || (volumeFader.resetVolume = status.volume)
		volumeFader.callback = async function() {
			console.log("Fade completed")
			await mpdCommand("setvol", [volumeFader.resetVolume])
		}
		volumeFader.startDate = Date.now()
		volumeFader.endDate = Date.now() + iDelayTimeSec * 1000
		await mpdCommand("setvol", [0])
		// pause modus? Then unpause, except it's a stream which should better be restarted fresh
		var unpause = status.state == "pause" && !status.stream
		if (unpause) {
			console.log("Unpausing playlist file " + status.filename)
			await mpdCommand("pause", [0])
		} else {
			console.log("Starting playlist file " + status.filename)
			await mpdCommand("play", [status.song])
		}
		startFading()
		var msg = "Starting fade-up (from " + volumeFader.startVolume + " to " + volumeFader.resetVolume + " in " + iDelayTimeSec + " sec)"
		return msg
	} else {
		// restart playing
		await mpdCommand("stop", [])
		await mpdCommand("play", [status.song])
		return "restarted play"
	}
}

async function changeVolume(delta) {
	var status = await getStatus()
	if (status.state == "play") {
		var newV = status.volume + delta
		newV = newV > 100 ? 100 : newV < 0 ? 0 : newV
		await mpdCommand("setvol", [newV])
		return "Volume set to " + newV
	} else {
		return "not playing"
	}
}

var faderTimerId = 0
function startFading() {
	console.log("Start fading")
	clearInterval(faderTimerId)
	faderTimerId = setInterval(() => {
		if (volumeFader.endDate < Date.now()) {
			clearInterval(faderTimerId)
			faderTimerId = 0
			volumeFader.callback && volumeFader.callback()
			return
		}
		var deltaT = volumeFader.endDate - volumeFader.startDate
		var p = (Date.now() - volumeFader.startDate) / deltaT
		p = p > 1 ? 1 : p
		var deltaV = volumeFader.endVolume - volumeFader.startVolume
		var newV = Math.floor(volumeFader.startVolume + deltaV * p)
		mpdCommand("setvol", [newV])
	}, 50)
}


