#!/usr//bin/node

var app = require('express')()
var Q = require('q')
var http = require('http').Server(app)
const {promisify} = require('util')

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
});

const mpdSend = promisify(client.sendCommand.bind(client))

var mpd_connected = false

client.on('ready', function() {
  console.log("mpd ready");
  mpd_connected = true
});

client.on('system', function(name) {
//  console.log("update", name);
});

client.on('system-player', function() {
//
});

app.use('/', require('express').static(__dirname + '/public'))

app.get('/mpd/:sCmd', async function(req, res) {
	var sCmd = req.params.sCmd
	console.log("MPD Command received: " + sCmd)
	if (sCmd == "fadePause") {
        var msg = await fadePause()
		res.send(msg);
	} else if (sCmd == "fadePauseToggle") {
        var msg = await fadePauseToggle()
		res.send(msg);
	} else if (sCmd == "fadePlay") {
        var msg = await fadePlay()
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
});
http.listen(8080, function(){
  console.log('listening on *:8080')
})

console.log('Press <ctrl>+C to exit.')

var mpdstatus = {}

async function getStatus() {
    var msg = await mpdSend(cmd("status", []))
	var reg1 = /volume:\s(\d*)/m
	var reg2 = /state:\s(\w*)/m
	mpdstatus.volume = Number(reg1.exec(msg)[1])
	mpdstatus.state = reg2.exec(msg)[1]
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

async function fadePauseToggle() {
	var status = await getStatus()
	if (status.state != "play" || (faderTimerId && volumeFader.targetState != "play")) {
		return await fadePlay()
	} else {
		return await fadePause()
	}
}

async function fadePause() {
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
		volumeFader.endDate = Date.now() + 5 * 1000
		startFading()
		var msg = "Starting fade-down (from " + status.volume + ", reset to " + volumeFader.resetVolume + ")"
		console.log(msg)
		return msg
	} else {
		return "not playing"
	}
}

async function fadePlay() {
	var status = await getStatus()
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
		volumeFader.endDate = Date.now() + 5 * 1000
		await mpdSend(cmd("setvol", [0]))
		status.state != "play" && await mpdSend(cmd("play", [1]))
		startFading()
		var msg = "Starting fade-up (from " + volumeFader.startVolume + " to " + volumeFader.resetVolume + ")"
		console.log(msg)
		return msg
	} else {
		return "already playing"
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


