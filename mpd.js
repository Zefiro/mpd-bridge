// Documentation
// https://www.npmjs.com/package/mpd
// https://www.musicpd.org/doc/html/protocol.html

const mpd = require('mpd')
const winston = require('winston')
const {promisify} = require('util')
const to = require('await-to-js').default

 module.exports = async function(god, mpdHost = 'localhost', id = 'mpd') { 
	var self = {
		
	id: id,
	listeners: [],
	client: {},
	mpdSend: function() {},
	mpdCommand: function() {},
	connected: false,
	mpdstatus: {},
	faderTimerId: undefined,
	logger: {},
	mqttTopic: 'grag-' + id,
	watchdog: {
		counter: 0,
		maxReconnectTries: 1, // warning: this is a sync-recursive call
		reconnectSampleTimeSec: 2,
	},

		
	init: async function(reconnect = false) {
		this.logger = winston.loggers.get(this.id)
		this.connected = false
		this.logger.info((reconnect ? "Reconnecting" : "Connecting") + " to MPD on " + mpdHost)

		this.client = mpd.connect({
		  port: 6600,
		  host: mpdHost,
		})
		this.mpdSend = promisify(this.client.sendCommand.bind(this.client))
		this.mpdCommand = (a, b) => this.mpdSend(mpd.cmd(a, b))

		this.client.on('ready', () => {
		  this.logger.info("mpd ready")
		  this.connected = true
		  this.watchdog.counter = 0
		})

		this.client.on('system', async (name) => {
			this.logger.debug("update: " + name)
			let status = await this._getStatus()
			let update = {
				'system': name,
				'status': status,
			}
			god.io.emit(this.id + '-update', update)
		})

		this.client.on('error', (error) => {
			this.logger.error("error: " + error)
		})

		this.client.on('end', () => {
			this.logger.info("connection closed")
			this.connected = false
			this.tryReconnect(false)
		})

		this.registerIoListeners()

		this.logger.debug("Subscribing to mqtt")
		god.mqtt.addTrigger('cmnd/' + this.mqttTopic + '/#', 'cmnd-' + this.id, this.onMqttCmnd.bind(this))
	},
	
	onMqttCmnd: async function(trigger, topic, message, packet) {
		this.logger.debug("mqtt: %s (%s)", topic, message)
		if (topic == 'cmnd/' + this.mqttTopic + '/pause') {
			let iDelayTimeSec = message && message > 0 && message < 1000 ? message : 0
			let res = await this.fadePause(iDelayTimeSec)
			this.logger.info("%s: pause delay=%s", topic, iDelayTimeSec)
			god.mqtt.publish('stat/' + this.mqttTopic + '/pause', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/play') {
			let iDelayTimeSec = message && message > 0 && message < 1000 ? message : 0
			let res = await this.fadePlay(iDelayTimeSec)
			this.logger.info("%s: play delay=%s", topic, iDelayTimeSec)
			god.mqtt.publish('stat/' + this.mqttTopic + '/play', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/state') {
			let state = (message == 'ON' || message == 'PLAY' || message == 1) ? 'ON' : 'OFF'
			let res = await (state == 'ON' ? this.fadePlay(5) : this.fadePause(5))
			this.logger.info("%s: state=%s", topic, state)
			god.mqtt.publish('stat/' + this.mqttTopic + '/state', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/statei') {
			let state = (message == 'ON' || message == 'PLAY' || message == 1) ? 'OFF' : 'ON'
			let res = await (state == 'ON' ? this.fadePlay(5) : this.fadePause(5))
			this.logger.info("%s: state=%s", topic, state)
			god.mqtt.publish('stat/' + this.mqttTopic + '/statei', res)
		} else {
			this.logger.info("mqtt: unrecognized topic %s (%s)", topic, message)
		}
	},

	_ioListenersRegistered: false,
	registerIoListeners: function() {
		if (this._ioListenersRegistered) return
		this._ioListenersRegistered = true
		god.ioOnConnected.push((async socket => {
			socket.on(this.id + '-setVolume', async (data) => {
				this.logger.info("websocket: set volume to " + data)
				// TODO error handling
				this.setVolume(data)
			})
			try {
				let status = await this._getStatus()
				socket.emit(this.id + '-update', { 'system': '', 'status': status } )
			} catch (e) {
				this.logger.error("Exception during getStatus for websocket: " + e)
				socket.emit(this.id + '-update', { 'system': '', 'status': 'offline' } )
			}
		}).bind(this))
	},
	
	tryReconnect: async function(throwOnError = true) {
		// reset counter if last try was more than X seconds ago
		if (Date.now() > this.watchdog.lastTry + this.watchdog.reconnectSampleTimeSec * 1000) {
			this.watchdog.counter = 0
		}
		if (this.watchdog.counter < this.watchdog.maxReconnectTries) {
			this.watchdog.counter++
			this.watchdog.lastTry = Date.now()
			await this.init(true)
			return true
		}
		this.logger.warn("Reconnection limit reached (" + this.watchdog.maxReconnectTries + " tries in " + this.watchdog.reconnectSampleTimeSec + " sec), not trying again this time")
		if (throwOnError) throw "Reconnect failed"
		return false
	},
	
	parseQueue: function(text) {
		let entries = text.split(/(?=file:)/)
		let queue = []
		entries.forEach(entry => entry && queue.push(this.parseKeyValue(entry)))
		return queue
	},
	
	// mpd.parseKeyValueMessage does not convert numerical values
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
		try {
			return await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during getStatus: " + e)
			return "retrieving status failed: " + e
		}
	},
	
	_getStatus: async function() {
		let [err, msg] = await to(this.mpdCommand("status", []))
		if (err) {
			this.logger.error("getStatus exception: %o", err)
			await this.tryReconnect()
			return await this._getStatus()
		}
//		this.logger.debug(msg)
		this.mpdstatus = this.parseKeyValue(msg)

		if ('song' in this.mpdstatus) {
			let [err2, msg2] = await to(this.mpdCommand("playlistinfo", [this.mpdstatus.song]))
			if (err2) {
				this.logger.error("getStatus exception2: %o", err2)
				await this.tryReconnect()
				return await this._getStatus()
			}
//			this.logger.info("Queue info:")
//			this.logger.info(msg2);
			let songinfo = this.parseKeyValue(msg2)
			this.mpdstatus = {...songinfo, ...this.mpdstatus }
			let reUrlPattern = /\w+:\/\/\w+/
			let urlPatternMatched = reUrlPattern.exec(this.mpdstatus.file)
			this.mpdstatus.stream = !!urlPatternMatched
		} else {
			this.mpdstatus.stream = false
		}
		this._logStatus()
		return this.mpdstatus
	},
	
	_logStatus: function() {
		var s = this.mpdstatus
		this.logger.debug("Status: state=" + s.state + (s.file ? " on '" + s.file + "'" : " [no file]") + ", volume: " + s.volume + (this.faderTimerId ? " (fading from " + this.volumeFader.startVolume + " to " + this.volumeFader.endVolume + ", target " + this.volumeFader.targetState + ")": " (no fading active)"))
	},

	getQueue: async function() {
		let msg = await this.mpdCommand("playlistinfo", [])
		let list = this.parseQueue(msg)
//this.logger.info("Queue info:")
//console.log(list)
		return list
	},
	
	syncActive: false,
	sync: async function(otherMpd) {
		if (this.syncActive) return "Sync already in progress"
		this.syncActive = true
		try {
			let res = await this._sync(otherMpd)
			this.syncActive = false
			return res
		} catch (e) {
			this.logger.error("Exception during sync: " + e)
			this.syncActive = false
			return "Sync failed: " + e
		}
	},
	
	_sync: async function(otherMpd) {
		// decide whether to play, and which file
		var status = await this._getStatus()
		var otherStatus = await otherMpd._getStatus()
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
		let queue1 = await this.getQueue()
		let queue2 = await otherMpd.getQueue()
		let files = []
		queue1.forEach(entry => files.unshift(entry.file))
		queue2.forEach(entry => files.unshift(entry.file))
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
				this.logger.error(logprefix + ": current file '" + status.file + "' not found in new queue")
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

	// MPD "next" would stop after the last file. This implements a wrap-around.
	next: async function() {
		try {
			var status = await this._getStatus()
			var list = await this.getQueue()
		} catch (e) {
			this.logger.error("Exception during next: " + e)
			return "retrieving status failed: " + e
		}
		if (status.state == "play" || (this.faderTimerId && this.volumeFader.targetState == "play")) {
			let pos = status.Pos == list.length-1 ? 0 : status.Pos + 1
			this.logger.info("Next song: pos=" + pos)
			return await this.mpdCommand("play", [pos])
		}
	},

	// MPD "previous" would stop before the first file. This implements a wrap-around.
	previous: async function() {
		try {
			var status = await this._getStatus()
			var list = await this.getQueue()
		} catch (e) {
			this.logger.error("Exception during previous: " + e)
			return "retrieving status failed: " + e
		}
		if (status.state == "play" || (this.faderTimerId && this.volumeFader.targetState == "play")) {
			let pos = status.Pos == 0 ? list.length-1 : status.Pos - 1
			this.logger.info("Next song: pos=" + pos)
			return await this.mpdCommand("play", [pos])
		}
	},

	fadePauseToggle: async function(iDelayTimePauseSec = 45, iDelayTimePlaySec = 5) {
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during fadePauseToggle: " + e)
			return "retrieving status failed: " + e
		}
		if (status.state != "play" || (this.faderTimerId && this.volumeFader.targetState != "play")) {
			return await this.fadePlay(iDelayTimePlaySec)
		} else {
			return await this.fadePause(iDelayTimePauseSec)
		}
	},

	fadePause: async function(iDelayTimeSec) {
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during fadePause: " + e)
			return "retrieving status failed: " + e
		}
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
				// TODO there seems to be a delay between fading down command and execution. Perhaps we should delay stopping briefly?
				this.logger.info("Fadedown completed, now set back to " + this.volumeFader.targetState)
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
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during fadePlay: " + e)
			return "retrieving status failed: " + e
		}
		// nothing currently selected? Than start from the beginning of the queue
		if (!status.songid) {
			let list = await this.getQueue()
			// TODO if list is empty?
			status.songid = list[0].Id
			status.file = list[0].file
		}
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
				this.logger.info("Unpausing file " + status.file)
				await this.mpdCommand("pause", [0])
			} else {
				this.logger.info("Starting file " + status.file)
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
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during setVolume: " + e)
			return "retrieving status failed: " + e
		}
		let newV = volume > 100 ? 100 : volume < 0 ? 0 : volume
		await this.mpdCommand("setvol", [newV])
		return "Volume set to " + newV
	},

	/** changes the volume by the relative amount. Only works when currently playing. */
	changeVolume: async function(delta) {
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during changeVolume: " + e)
			return "retrieving status failed: " + e
		}
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
