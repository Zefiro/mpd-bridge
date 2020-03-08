// Documentation
// https://www.npmjs.com/package/mpd
// https://www.musicpd.org/doc/html/protocol.html

const mpd = require('mpd')
const winston = require('winston')
const {promisify} = require('util')
const to = require('await-to-js').default

 module.exports = async function(god, mpdHost = 'localhost', loggerName = 'mpd') { 
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
// comes too often, e.g. during fade
//			this.logger.info("update: " + name)
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
	
	parsePlaylist: function(text) {
		let entries = text.split(/(?=file:)/)
		let playlist = []
		entries.forEach(entry => entry && playlist.push(this.parseKeyValue(entry)))
		return playlist
	},
	
	parseKeyValue: function(text) {
		let result = {}
		let lines = text.split(/\r?\n/)
		const regColon = /\s*([^:]+)\s*:\s*(.*?)\s*$/
		lines.forEach(line => {			
		let parts = regColon.exec(line)
		if (!parts) return
		let [all, key, value] = parts
			if (key && value) {
				let numberValue = Number(value)
				result[key] = (value == numberValue) ? numberValue : value
			}
		})
		return result
	},

	getStatus: async function() {
		let [err, msg] = await to(this.mpdCommand("status", []))
		if (err) {
			this.logger.error("getStatus exception:")
			this.logger.error(err)
			this.logger.error("trying to restart mpd-client")
			// TODO re-initialize? re-run init()?
			terminate(1)
		}
//		this.logger.info(msg)
		this.mpdstatus = this.parseKeyValue(msg)
//		this.logger.info(this.mpdStatus)

		if ('song' in this.mpdstatus) {
			let msg2 = await this.mpdCommand("playlistinfo", [this.mpdstatus.song])
//			this.logger.info("Playlist info:")
//			this.logger.info(msg2);
			let songinfo = this.parseKeyValue(msg2)
			this.mpdstatus = {...songinfo, ...this.mpdstatus }
			let reUrlPattern = /\w+:\/\/\w+/
			let urlPatternMatched = reUrlPattern.exec(this.mpdstatus.file)
			this.mpdstatus.stream = !!urlPatternMatched
		} else {
			this.mpdstatus.stream = false
		}
		return this.mpdstatus
	},

	getPlaylist: async function() {
		this.logger.info("Playlist info:")
		let msg = await this.mpdCommand("playlistinfo", [])
		let list = this.parsePlaylist(msg)
		return list
	},
	
	sync: async function(otherMpd) {
		// decide whether to play, and which file
		var status = await this.getStatus()
		var otherStatus = await otherMpd.getStatus()
		let currentFile = ""
		let targetState
		if (otherStatus.state == "play") {
			currentFile = otherStatus.file
			targetState = "play"
		} else if (status.state == "play") {
			currentFile = status.file
			targetState = "play"
		} else {
			// both don't play, just choose one
			currentFile = otherStatus.file ? otherStatus.file : status.file
			targetState = status.state
		}
		this.logger.info("Synching. Target state is " + targetState + " on file " + currentFile)
		
		// retrieve and merge queues
		let playlist1 = await this.getPlaylist()
		let playlist2 = await otherMpd.getPlaylist()
		let files = []
		playlist1.forEach(entry => files.unshift(entry.file))
		playlist2.forEach(entry => files.unshift(entry.file))
		files = [...new Set(files)]

		// clear and rebuild queues
		let rebuildQueue = async (currentFile, mpd, logprefix) => {
			await mpd.mpdCommand("stop", [])
			await mpd.mpdCommand("clear", [])
			let currentId = -1
			this.logger.debug(logprefix + ": Looking for " + currentFile)
			for(let i=0; i < files.length; i++) {
				let file = files[i]
				let isCurrent = currentFile == file
				let res = await mpd.mpdCommand("addid", [file])
				let res2 = this.parseKeyValue(res)
				this.logger.debug(logprefix + ': Queue add ' + file + " as #" + res2.Id + (isCurrent ? " <- currently playing" : ""))
				if (isCurrent) currentId = res2.Id
			}
			if (currentId >= 0) {
				this.logger.info(logprefix + ": New id is #" + currentId)
			} else {
				this.logger.error(logprefix + ": current file '" + status.file + "' not found in new playlist")
			}
			return currentId
		}
		let thisId = await rebuildQueue(currentFile, this, 'this')
		let otherId = await rebuildQueue(currentFile, otherMpd, 'other')
		
		// restart both players (needed to set the current song id), then if needed stop them again
		let bothMpd = async (cmd, paramThis, paramOther) => {
			let p1 = this.mpdCommand(cmd, paramThis)
			let p2 = otherMpd.mpdCommand(cmd, paramOther)
			await p1
			await p2
		}
		if (thisId >= 0 && otherId >= 0) {
			await bothMpd("playid", [thisId], [otherId])
		}
		if (targetState == "stop") {
			await bothMpd("stop", [], [])
		}
		if (targetState == "pause") {
			await bothMpd("pause", [1], [1])
		}
		
		return "Sync'd both MPDs"
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
		this.logger.debug("fadePause: state=" + status.state + (this.faderTimerId ? " (fading from " + this.volumeFader.startVolume + " to " + this.volumeFader.endVolume + ", target " + this.volumeFader.targetState + ")": " (no fading active)"))
		if (status.state == "play" || (this.faderTimerId && this.volumeFader.targetState == "play")) {
			// quick fadeoff
			if (this.faderTimerId && (this.volumeFader.targetState == "pause" || this.volumeFader.targetState == "stop")) {
				iDelayTimeSec = 1
			}
			this.volumeFader.startVolume = status.volume
			this.volumeFader.endVolume = 0
			this.volumeFader.targetState = status.stream ? "stop" : "pause"
			this.faderTimerId || (this.volumeFader.resetVolume = status.volume)
			this.volumeFader.callback = (async function() {
				this.logger.info("Fadedown completed, now " + this.volumeFader.targetState)
				if (this.volumeFader.targetState == "pause") await this.mpdCommand("pause", [1])
				if (this.volumeFader.targetState == "stop") await this.mpdCommand("stop", [])
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
		this.logger.debug("fadePlay: state=" + status.state + (this.faderTimerId ? " (fading from " + this.volumeFader.startVolume + " to " + this.volumeFader.endVolume + ", target " + this.volumeFader.targetState + ")": " (no fading active)"))
		if (status.state != "play" || (this.faderTimerId && this.volumeFader.targetState != "play")) {
			this.volumeFader.startVolume = (this.faderTimerId && this.volumeFader.targetState != "play") ? status.volume : 0
			this.volumeFader.endVolume = this.faderTimerId ? this.volumeFader.resetVolume : status.volume
			this.volumeFader.targetState = "play"
			this.faderTimerId || (this.volumeFader.resetVolume = status.volume)
			this.volumeFader.callback = (async function() {
				this.logger.debug("Fade completed")
				await this.mpdCommand("setvol", [this.volumeFader.resetVolume])
			}).bind(this)
			await this.mpdCommand("setvol", [0])
			// pause modus? Then unpause, except it's a stream which should better be restarted fresh
			var unpause = status.state == "pause" && !status.stream
			if (unpause) {
				this.logger.info("Unpausing playlist file " + status.file)
				await this.mpdCommand("pause", [0])
			} else {
				this.logger.info("Starting playlist file " + status.file)
				await this.mpdCommand("playid", [status.songid])
			}
			this.startFading(iDelayTimeSec)
			var msg = "Starting fade-up (from " + this.volumeFader.startVolume + " to " + this.volumeFader.resetVolume + " in " + iDelayTimeSec + " sec)"
			this.logger.info(msg)
			return msg
		} else {
			// explicitely restart playing
			await this.mpdCommand("stop", [])
			await this.mpdCommand("playid", [status.songid])
			return "restarted play"
		}
	},

	/** sets the volume to the given amount (0..100) */
	setVolume: async function(volume) {
		let newV = volume > 100 ? 100 : volume < 0 ? 0 : volume
		await this.mpdCommand("setvol", [newV])
		return "Volume set to " + newV
	},

	/** changes the volume by the relative amount. Only works when currently playing. */
	changeVolume: async function(delta) {
		let status = await this.getStatus()
		if (status.state == "play") {
			let newV = status.volume + delta
			newV = newV > 100 ? 100 : newV < 0 ? 0 : newV
			await this.mpdCommand("setvol", [newV])
			return "Volume changed by " + delta + " to " + newV
		} else {
			return "Volume not changed, as we're not playing"
		}
	},

	startFading: function(iDelayTimeSec) {
		this.logger.debug("Start fading")
		clearInterval(this.faderTimerId)
		this.volumeFader.startDate = Date.now()
		this.volumeFader.endDate = this.volumeFader.startDate + iDelayTimeSec * 1000
		this.faderTimerId = setInterval((function() {
			if (this.volumeFader.endDate <= Date.now()) {
				clearInterval(this.faderTimerId)
				this.faderTimerId = 0
				this.volumeFader.callback && this.volumeFader.callback()
				return
			}
			var deltaT = this.volumeFader.endDate - this.volumeFader.startDate
			var p = (Date.now() - this.volumeFader.startDate) / deltaT
			p = p > 1 ? 1 : p
			var deltaV = this.volumeFader.endVolume - this.volumeFader.startVolume
			var newV = Math.floor(this.volumeFader.startVolume + deltaV * p)
			this.mpdCommand("setvol", [newV])
//this.logger.debug("Fade volume: " + newV)
		}).bind(this), 50)
	},
}
    await self.init()
    return self
}
