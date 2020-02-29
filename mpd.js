const mpd = require('mpd')
const winston = require('winston')
const {promisify} = require('util')
const to = require('await-to-js').default

 module.exports = async function(mpdHost = 'localhost', loggerName = 'mpd') { 
	var self = {
		
	listeners: [],
	client: {},
	mpdSend: function() {},
	mpdCommand: function() {},
	connected: false,
	mpdstatus: {},
	faderTimerId: undefined,
	logger: {},
		
	init: async function() {
		this.logger = winston.loggers.get(loggerName)
		this.connected = false
		this.logger.info("Connecting to MPD on " + mpdHost)

		this.client = mpd.connect({
		  port: 6600,
		  host: mpdHost,
		})
		this.mpdSend = promisify(this.client.sendCommand.bind(this.client))
		this.mpdCommand = (a, b) => this.mpdSend(mpd.cmd(a, b))

		this.client.on('ready', () => {
		  this.logger.info("mpd ready")
		  this.connected = true
		})

		this.client.on('system', (name) => {
		this.logger.info("update: " + name)
		})

		this.client.on('error', (error) => {
			this.logger.error("error: " + error)
		})

		this.client.on('end', () => {
			this.logger.info("connection closed")
			this.connected = false
		})

		this.client.on('system-player', () => {
			//
		})
	},

	getStatus: async function() {
		var [err, msg] = await to(this.mpdCommand("status", []))
		if (err) {
			this.logger.error("getStatus exception:")
			this.logger.error(err)
			this.logger.error("trying to restart mpd-client")
			// TODO re-initialize? re-run init()?
			terminate(1)
		}
//		this.logger.info(msg)
		var reg1 = /volume:\s(\d*)/m
		var reg2 = /state:\s(\w*)/m
		var reg3 = /song:\s(\w*)/m
		this.mpdStatus = {}
		this.mpdstatus.volume = Number(reg1.exec(msg)[1])
		this.mpdstatus.state = reg2.exec(msg)[1]
		this.mpdstatus.song = reg3.exec(msg)[1]

		this.mpdstatus.filename = ""
		this.mpdstatus.stream = false
		
		if (this.mpdstatus.song) {
			var msg2 = await this.mpdCommand("playlistinfo", [this.mpdstatus.song])
			this.logger.info("Playlist info:")
			this.logger.info(msg2);
			var reg4 = /file:\s(.*)/m
			var reg5 = /\w+:\/\/\w+/
			this.mpdstatus.filename = reg4.exec(msg2)[1]
			if (reg5.exec(this.mpdstatus.filename)) {
				this.mpdstatus.stream = true
			}
		}
		return this.mpdstatus
	},

	volumeFader: {
		startVolume: 0,
		endVolume: 0,
		resetVolume: 0,
		targetState: undefined,
		callback: undefined,
		startDate: 0,
		endDate: 0
	},

	fadePauseToggle: async function(iDelayTimePauseSec, iDelayTimePlaySec) {
		var status = await this.getStatus()
		if (status.state != "play" || (this.faderTimerId && this.volumeFader.targetState != "play")) {
			return await this.fadePlay(iDelayTimePlaySec)
		} else {
			return await this.fadePause(iDelayTimePauseSec)
		}
	},

	fadePause: async function(iDelayTimeSec) {
		var status = await this.getStatus()
		if (status.state == "play" || (this.faderTimerId && this.volumeFader.targetState == "play")) {
			// quick fadeoff
			if (this.faderTimerId && this.volumeFader.targetState == "pause") {
				iDelayTimeSec = 1
			}
			this.volumeFader.startVolume = status.volume
			this.volumeFader.endVolume = 0
			this.volumeFader.targetState = "pause"
			this.faderTimerId || (this.volumeFader.resetVolume = status.volume)
			this.volumeFader.callback = (async function() {
				this.logger.info("Fadedown completed")
				await this.mpdCommand("pause", [1])
				await this.mpdCommand("setvol", [this.volumeFader.resetVolume])
			}).bind(this)
			this.startFading(iDelayTimeSec)
			var msg = "Starting fade-down (from " + status.volume + ", reset to " + this.volumeFader.resetVolume + ", in " + iDelayTimeSec + " sec)"
			return msg
		} else {
			return "not playing"
		}
	},

	fadePlay: async function(iDelayTimeSec) {
		var status = await this.getStatus()
		this.logger.info("status: ")
		this.logger.info(status)
		if (status.state != "play" || (this.faderTimerId && this.volumeFader.targetState != "play")) {
			this.volumeFader.startVolume = (this.faderTimerId && this.volumeFader.targetState != "play") ? status.volume : 0
			this.volumeFader.endVolume = this.faderTimerId ? this.volumeFader.resetVolume : status.volume
			this.volumeFader.targetState = "play"
			this.faderTimerId || (this.volumeFader.resetVolume = status.volume)
			this.volumeFader.callback = (async function() {
				this.logger.info("Fade completed")
				await this.mpdCommand("setvol", [this.volumeFader.resetVolume])
			}).bind(this)
			await this.mpdCommand("setvol", [0])
			// pause modus? Then unpause, except it's a stream which should better be restarted fresh
			var unpause = status.state == "pause" && !status.stream
			if (unpause) {
				this.logger.info("Unpausing playlist file " + status.filename)
				await this.mpdCommand("pause", [0])
			} else {
				this.logger.info("Starting playlist file " + status.filename)
				await this.mpdCommand("play", [status.song])
			}
			this.startFading(iDelayTimeSec)
			var msg = "Starting fade-up (from " + this.volumeFader.startVolume + " to " + this.volumeFader.resetVolume + " in " + iDelayTimeSec + " sec)"
			return msg
		} else {
			// restart playing (and ensure volume is not stuck at too low)
			await this.mpdCommand("stop", [])
			await this.mpdCommand("setvol", [90])
			await this.mpdCommand("play", [status.song])
			return "restarted play"
		}
	},

	changeVolume: async function(delta) {
		var status = await this.getStatus()
		if (status.state == "play") {
			var newV = status.volume + delta
			newV = newV > 100 ? 100 : newV < 0 ? 0 : newV
			await this.mpdCommand("setvol", [newV])
			return "Volume set to " + newV
		} else {
			return "not playing"
		}
	},

	startFading: function(iDelayTimeSec) {
		this.logger.info("Start fading")
		clearInterval(this.faderTimerId)
		this.volumeFader.startDate = Date.now()
		this.volumeFader.endDate = this.volumeFader.startDate + iDelayTimeSec * 1000
		this.faderTimerId = setInterval((function() {
			if (this.volumeFader.endDate <= Date.now()) {
				clearInterval(this.faderTimerId)
				faderTimerId = 0
				this.volumeFader.callback && this.volumeFader.callback()
				return
			}
			var deltaT = this.volumeFader.endDate - this.volumeFader.startDate
			var p = (Date.now() - this.volumeFader.startDate) / deltaT
			p = p > 1 ? 1 : p
			var deltaV = this.volumeFader.endVolume - this.volumeFader.startVolume
			var newV = Math.floor(this.volumeFader.startVolume + deltaV * p)
			this.mpdCommand("setvol", [newV])
		}).bind(this), 50)
	},
}
    await self.init()
    return self
}
