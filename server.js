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
  console.log("update", name);
});

client.on('system-player', function() {
});

app.use('/', require('express').static(__dirname + '/public'))

app.get('/mpd/:sCmd', async function(req, res) {
	var sCmd = req.params.sCmd
	console.log("MPD Command received: " + sCmd)
	if (sCmd == "fadePause") {
        var msg = await fadePause()
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
	callback: undefined,
	startDate: 0,
	endDate: 0
}

async function fadePause() {
	var status = await getStatus()
	if (status.state == "play") {
		volumeFader.startVolume = status.volume
		volumeFader.endVolume = 0
		volumeFader.callback = async function() {
			console.log("Fadedown completed")
			await mpdSend(cmd("pause", [1]))
			console.log("Fadedown completed - 2")
			await mpdSend(cmd("setvol", [status.volume]))
			console.log("Fadedown completed - 3")
		}
		volumeFader.startDate = Date.now()
		volumeFader.endDate = Date.now() + 5 * 1000
		startFading()
		return "Starting fade-dowm"
	} else {
		return "not playing"
	}
}

async function fadePlay() {
	var status = await getStatus()
	if (status.state != "play") {
		volumeFader.startVolume = 0
		volumeFader.endVolume = status.volume
		volumeFader.callback = async function() {
			console.log("Fade completed")
			await mpdSend(cmd("setvol", [status.volume]))
		}
		volumeFader.startDate = Date.now()
		volumeFader.endDate = Date.now() + 5 * 1000
		await mpdSend(cmd("setvol", [0]))
		await mpdSend(cmd("play", [1]))
		startFading()
		return "Starting fade-up"
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
		console.log("Fading")
		console.log("Fading")
		if (volumeFader.endDate < Date.now()) {
			console.log("End Fading")
			clearInterval(faderTimerId)
			volumeFader.callback && volumeFader.callback()
			console.log("Fading ended")
			return
		}
		var deltaT = volumeFader.endDate - volumeFader.startDate
		var p = (Date.now() - volumeFader.startDate) / deltaT
		p = p > 1 ? 1 : p
		var deltaV = volumeFader.endVolume - volumeFader.startVolume
		var newV = Math.floor(volumeFader.startVolume + deltaV * p)
		mpdSend(cmd("setvol", [newV]))
		console.log("Volume: " + newV)
	}, 50)
}


