#!/usr//bin/node

const app = require('express')()
const Q = require('q')
const http = require('http').Server(app)
const {promisify} = require('util')
const fetch = require('node-fetch');

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


var mpd = require('mpd'),
    cmd = mpd.cmd

var client = mpd.connect({
  port: 6600,
  host: 'localhost',
})

const mpdSend = promisify(client.sendCommand.bind(client))

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

app.get('/mpd/:sCmd', async function(req, res) {
	var sCmd = req.params.sCmd
	console.log("MPD Command received: " + sCmd)
	if (sCmd == "fadePause") {
        var msg = await fadePause(1)
		res.send(msg);
	} else if (sCmd == "fadePauseToggle") {
        var msg = await fadePauseToggle(1, 1)
		res.send(msg);
	} else if (sCmd == "fadePlay") {
        var msg = await fadePlay(1)
		res.send(msg);
	} else if (sCmd == "volUp") {
        var msg = await changeVolume(+5)
		res.send(msg);
	} else if (sCmd == "volDown") {
        var msg = await changeVolume(-5)
		res.send(msg);
	} else {
		res.send('Command unknown: ' + sCmd);
	}
})

http.listen(8080, function(){
  console.log('listening on *:8080')
})

wodoinco.addListener("A Tast A", async (txt) => { console.log("WoDoInCo: Light toggled") })
wodoinco.addListener("A Tast B", async (txt) => { console.log(await fadePlay(2)) })
wodoinco.addListener("A Tast C", async (txt) => { console.log(await fadePause(5)) })
wodoinco.addListener("A Tast Do", async (txt) => { console.log(await changeVolume(+2)) })
wodoinco.addListener("A Tast Du", async (txt) => { console.log(await changeVolume(-2)) })

extender.addListener(0 /* green       */, 1, async (pressed, butValues) => { console.log(await fadePlay(2)) })
extender.addListener(1 /* red         */, 1, async (pressed, butValues) => { console.log(await fadePause(0)) })
//extender.addListener(2 /* tiny blue   */, 1, async (pressed, butValues) => { openhab('alarm', 'TOGGLE') })
//extender.addListener(3 /* tiny red    */, 1, async (pressed, butValues) => { regalbrett('alarm') })
extender.addListener(2 /* tiny blue   */, 1, async (pressed, butValues) => { openhab('FensterLedNetz', 'ON'); openhab('Monitors', 'ON'); openhab('Regalbrett', 'ON') })
extender.addListener(3 /* tiny red    */, 1, async (pressed, butValues) => { openhab('FensterLedNetz', 'OFF'); openhab('Monitors', 'OFF'); openhab('Regalbrett', 'OFF') })
extender.addListener(4 /* tiny yellow */, 1, async (pressed, butValues) => { regalbrett('disco') })
extender.addListener(5 /* tiny green  */, 1, async (pressed, butValues) => { regalbrett('calm'); openhab('alarm', 'OFF') })


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

async function openhab(item, action) {
	let itemId = ""
	if (item == "light_sofa") itemId = 'zwave_device_controller_node5_switch_binary2'
	if (item == "light_pc") itemId = 'zwave_device_controller_node5_switch_binary'
	if (item == "light_wc") itemId = 'zwave_device_controller_node10_switch_binary'
	if (item == "alarm") itemId = 'Alarm'
	if (item == "FensterLedNetz") itemId = 'FensterLednetz_Switch'
        if (item == "Regalbrett") itemId = 'SwitchRegalbrett_Switch'
        if (item == "Monitors") itemId = 'PC_Monitors'
	if (!itemId) {
		console.log("OpenHAB: item '" + item + "' unknown")
	}
	console.log("OpenHAB: sending '" + action + "' to item " + item + " (" + itemId + ")")
	try {
		let res = await fetch('http://medusa.cave.zefiro.de/rest/items/' + itemId, { method: "POST", headers: [ 'Content-Type: text/plain', 'Accept: application/json' ], body: action })
		let resText = await res.text()
		console.log("OpenHAB responsed (" + res.status + " " + res.statusText + "): " + resText)
	} catch(e) {
		console.log("OpenHAB Error: ")
		console.log(e)
	}
}

async function getStatus() {
    var msg = await mpdSend(cmd("status", []))
	console.log(msg)
	var reg1 = /volume:\s(\d*)/m
	var reg2 = /state:\s(\w*)/m
	var reg3 = /song:\s(\w*)/m
	mpdstatus.volume = Number(reg1.exec(msg)[1])
	mpdstatus.state = reg2.exec(msg)[1]
	mpdstatus.song = reg3.exec(msg)[1]

    mpdstatus.filename = ""
    mpdstatus.stream = false
	
	if (mpdstatus.song) {
		var msg2 = await mpdSend(cmd("playlistinfo", [mpdstatus.song]))
		console.log("Playlist info:")
		console.log(msg2);
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
			await mpdSend(cmd("pause", [1]))
			await mpdSend(cmd("setvol", [volumeFader.resetVolume]))
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
			await mpdSend(cmd("setvol", [volumeFader.resetVolume]))
		}
		volumeFader.startDate = Date.now()
		volumeFader.endDate = Date.now() + iDelayTimeSec * 1000
		await mpdSend(cmd("setvol", [0]))
		// pause modus? Then unpause, except it's a stream which should better be restarted fresh
		var unpause = status.state == "pause" && !status.stream
		if (unpause) {
			console.log("Unpausing playlist file " + status.filename)
			await mpdSend(cmd("pause", [0]))
		} else {
			console.log("Starting playlist file " + status.filename)
			await mpdSend(cmd("play", [status.song]))
		}
		startFading()
		var msg = "Starting fade-up (from " + volumeFader.startVolume + " to " + volumeFader.resetVolume + " in " + iDelayTimeSec + " sec)"
		return msg
	} else {
		// restart playing
		await mpdSend(cmd("stop", []))
		await mpdSend(cmd("play", [status.song]))
		return "restarted play"
	}
}

async function changeVolume(delta) {
	var status = await getStatus()
	if (status.state == "play") {
		var newV = status.volume + delta
		newV = newV > 100 ? 100 : newV < 0 ? 0 : newV
		await mpdSend(cmd("setvol", [newV]))
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
		mpdSend(cmd("setvol", [newV]))
	}, 50)
}

