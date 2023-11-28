// Documentation
// https://www.npmjs.com/package/mpd
// https://www.musicpd.org/doc/html/protocol.html

const mpd = require('mpd')
const winston = require('winston')
const {promisify} = require('util')
const to = require('await-to-js').default
const youtubedl = require('youtube-dl')
var fs = require('fs')
var Q = require('q')
const util = require('util')
const moment = require('moment')

module.exports = async function(god, mpdHost = 'localhost', id = 'mpd', _mqttTopic = undefined) { 
	var self = {
		
	mappingFilename: 'mpd-youtube-cache.json',
	id: id,
	listeners: [],
	client: {},
	mpdSend: function() {},
	mpdCommand: function() {},
	connected: false,
	mpdstatus: {},
	faderTimerId: undefined,
	logger: {},
	mqttTopic: _mqttTopic ?? id,
	watchdog: {
		counter: 0,
		maxReconnectTries: 1, // warning: this is a sync-recursive call
		reconnectSampleTimeSec: 2,
	},
	mapping: {},

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
			god.io && god.io.emit(this.id + '-update', update)
			god.mqtt && god.mqtt.publish('tele/' + this.mqttTopic + '/STATE', JSON.stringify(update))
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

		this.logger.debug("Subscribing to mqtt cmnd/%s", this.mqttTopic)
		god.mqtt && god.mqtt.addTrigger('cmnd/' + this.mqttTopic + '/#', 'cmnd-' + this.id, this.onMqttCmnd.bind(this))
		
		this.loadMappings()
	},
	
	onMqttCmnd: async function(trigger, topic, message, packet) {
        const maxDelayInSec = 30 * 60
		this.logger.debug("mqtt received: %s (%s)", topic, message)
		if (topic == 'cmnd/' + this.mqttTopic + '/changevolume') {
			let relVolume = parseInt(message ?? 0)
			let res = await this.changeVolume(relVolume)
			this.logger.info("%s: change volume: %s", topic, res)
			god.mqtt.publish('stat/' + this.mqttTopic + '/pause', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/pause') {
			let iDelayTimeSec = message && message > 0 && message < maxDelayInSec ? message : 0
			let res = await this.fadePause(iDelayTimeSec)
			this.logger.info("%s: pause delay=%s", topic, iDelayTimeSec)
			god.mqtt.publish('stat/' + this.mqttTopic + '/pause', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/play') {
			let iDelayTimeSec = message && message > 0 && message < maxDelayInSec ? message : 0
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
		} else if (topic == 'cmnd/' + this.mqttTopic + '/toggle') {
			let res = await this.fadePauseToggle(message, message)
			let state = this.volumeFader.targetState
			this.logger.info("%s: state=%s", topic, state)
			god.mqtt.publish('stat/' + this.mqttTopic + '/state', res)
		} else if (topic == 'cmnd/' + this.mqttTopic + '/status') {
			let status = {}
			try {
				status = await this._getStatus()
			} catch (e) {
				this.logger.error("Exception during getStatus for mqtt: " + e)
				status = 'offline'
			}
			let update = { 'system': '', 'status': status }
			god.mqtt.publish('tele/' + this.mqttTopic + '/STATE', JSON.stringify(update))
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
				await this.setVolume(data)
			})
			socket.on(this.id + '-getQueue', async (data) => {
				this.logger.debug("Socket: queue requested")
				await socket.emit(this.id + '-queue', await this.getQueue())
			})
			socket.on(this.id + '-playId', async (data) => {
				this.logger.debug("Socket: play Id '" + data + "' requested")
				this.fadePlay(1, data)
			})

			// send initial status
			let status = {}
			try {
				status = await this._getStatus()
			} catch (e) {
				this.logger.error("Exception during getStatus for websocket: " + e)
				status = 'offline'
			}
			let update = { 'system': '', 'status': status }
			socket.emit(this.id + '-update', update )
			god.mqtt && god.mqtt.publish('tele/' + this.mqttTopic + '/STATE', JSON.stringify(update))
            this.updateMappings() // check for stale Youtube links
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
//		this.logger.debug('getStatus returned: %o', msg)
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
/*
			let reUrlPattern = /\w+:\/\/\w+/
			let urlPatternMatched = reUrlPattern.exec(this.mpdstatus.file)
			this.mpdstatus.stream = !!urlPatternMatched
*/
			this.mpdstatus.stream = !this.mpdstatus.duration
		} else {
			this.mpdstatus.stream = false
		}
		if (this.mpdstatus.file && this.mapping[this.mpdstatus.file]) {
			let mapping = this.mapping[this.mpdstatus.file]
//			console.log(cache)
			this.mpdstatus.Name = mapping.name
			this.mpdstatus.file = mapping.orig_url
			this.mpdstatus.Title = mapping.title
		}
		this._logStatus()
		return this.mpdstatus
	},
	
	_logStatus: function() {
		var s = this.mpdstatus
		this.logger.debug("Status: state=" + s.state + (s.file ? " on '" + s.file + "'" : " [no file]") + ", volume: " + s.volume + (this.faderTimerId ? " (fading from " + this.volumeFader.startVolume + " to " + this.volumeFader.endVolume + ", target " + this.volumeFader.targetState + ")": " (no fading active)"))
        if (s.error) this.logger.warn('MPD returned error: %s', s.error)
	},

	getQueueRaw: async function() {
		let msg = await this.mpdCommand("playlistinfo", [])
		return this.parseQueue(msg)
	},

	// returns the current MPD queue, with Youtube URLs already mapped
	getQueue: async function() {
		try {
			let list = (await this.getQueueRaw()).map(entry => {
				if (entry.file && this.mapping[entry.file]) {
					let mapping = this.mapping[entry.file]
					entry.Name = mapping.name
					entry.file = mapping.orig_url
					entry.Title = mapping.title
				}
				return entry
			})
	//this.logger.info("Queue info:")
	//console.log(list)
			return list
		} catch (error) {
			this.logger.error(error)
		}
	},
    
    updateMusicCollection: async function() {
		try {
            let res = await this.mpdCommand("update", [])
			return res
		} catch (e) {
			this.logger.error("Exception during updateMusicCollection: " + e)
			return "updateMusicCollection failed: " + e
		}
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
		// TODO does the catch() improve anything? -> https://medium.com/@JonasJancarik/handling-those-unhandled-promise-rejections-when-using-javascript-async-await-and-ifee-5bac52a0b29f

        // Just to be safe: update the music collections
		this.logger.info("Updating Music Collections")
        await Promise.allSettled([this.updateMusicCollection(), otherMpd.updateMusicCollection()])
		
		var status = await this._getStatus().catch(e => { throw e })
		var otherStatus = await otherMpd._getStatus().catch(e => { throw e })
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
		this.logger.info("Synching. Target state is " + targetState + (currentFile ? " on file " + currentFile : " (no song selected)"))
        
		// retrieve and merge queues
		let queue1 = await this.getQueue()
		let queue2 = await otherMpd.getQueue()
		let files = []
		queue1.forEach(entry => files.unshift(entry.file))
		queue2.forEach(entry => files.unshift(entry.file))
		files = [...new Set(files)]
		this.logger.debug("Sync: #%s + #%s = #%s songs", queue1.length, queue2.length, files.length)

		// clear and rebuild queues
		let rebuildQueue = async (currentFile, mpd, logprefix) => {
			await mpd.mpdCommand("stop", [])
			await mpd.mpdCommand("clear", [])
			let currentId = -1
			this.logger.debug("sync '%s': rebuilding queue for %s", logprefix, mpd.id)
			for(let i=0; i < files.length; i++) {
				let file = files[i]
				let isCurrent = (currentFile == file)
				try {
					let res = await mpd.mpdCommand("addid", [file])
					let res2 = this.parseKeyValue(res)
					this.logger.debug("Sync '" + logprefix + "': Queue add " + file + " as #" + res2.Id + (isCurrent ? " <- currently playing" : ""))
					if (isCurrent) currentId = res2.Id
				} catch(e) {
					this.logger.error("sync %s: while rebuilding queue on %s: adding file '%s' resulted in: %o", logprefix, mpd.id, file, e)
				}
			}
			if (currentId >= 0) {
				this.logger.info("sync %s: Done. New id for current selection %s is #%s", logprefix, currentFile, currentId)
			} else if (currentFile) {
				this.logger.error("sync %s: Done. But current selection %s not found in new queue", logprefix, currentFile)
			} else {
				this.logger.info("sync %s: Done. Nothing selected", logprefix)
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
	
	fadePlay: async function(iDelayTimeSec, id) {
		try {
			var status = await this._getStatus()
		} catch (e) {
			this.logger.error("Exception during fadePlay/getStatus: " + e)
			return "retrieving status failed: " + e
		}
		// nothing currently selected? Than start from the beginning of the queue
		if (id || !status.songid) {
			let list = await this.getQueue()
			if (!list.length) {
				return "Queue empty - nothing to play"
			}
			let list2 = list.filter(a => a.Id == id)
			if (!list2.length) list2[0] = list[0]
			status.songid = list2[0].Id
			status.file = list2[0].file
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
            try {
                await this.mpdCommand("setvol", [0])
            } catch (e) {
                this.logger.error("Exception during fadePlay/setvol: " + e)
                return "Restarting play failed: " + e
            }
			// pause modus? Then unpause, except it's a stream which should better be restarted fresh
			var unpause = status.state == "pause" && !status.stream
			if (unpause) {
				this.logger.info("Unpausing file " + status.file)
                try {
                    await this.mpdCommand("pause", [0])
                } catch (e) {
                    this.logger.error("Exception during fadePlay/unpause: " + e)
                    return "Unpausing failed: " + e
                }
			} else {
				this.logger.info("Starting file " + status.file)
                try {
                    await this.mpdCommand("playid", [status.songid])
                } catch (e) {
                    this.logger.error("Exception during fadePlay/play: " + e)
                    return "Starting play failed: " + e
                }
			}
			this.startFading(iDelayTimeSec)
			var msg = "Starting fade-up (from " + this.volumeFader.startVolume + " to " + this.volumeFader.resetVolume + " in " + iDelayTimeSec + " sec)"
			this.logger.info(msg)
			return msg
		} else {
			// explicitely restart playing
            try {
                await this.mpdCommand("stop", [])
                await this.mpdCommand("playid", [status.songid])
                return "restarted play"
            } catch (e) {
                this.logger.error("Exception during fadePlay: " + e)
                return "Restarting play failed: " + e
            }
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
	
	saveMappings: async function() {
		// TODO merge across all MPD instances ?
		if (id != 'mpd1') return
		let writeFile = util.promisify(fs.writeFile)
		try {
			await writeFile(this.mappingFilename, JSON.stringify(this.mapping, null, 4), {encoding: 'utf-8'})
			this.logger.info("Youtube cache info saved")
		} catch (error) {
			this.logger.error("Failed to write Youtube cache info " + this.mappingFilename + ": " + error)
		}
	},
	
	loadMappings: async function() {
		if (id != 'mpd1') return
		this.logger.info("Loading YouTube cache info")
		let readFile = util.promisify(fs.readFile)
		try {
			let data = await readFile(this.mappingFilename, {encoding: 'utf-8'})
			this.mapping = JSON.parse(data)
		} catch (error) {
			this.logger.error("Failed to read YouTube cache info " + this.mappingFilename + ": " + error)
		}
		try {
			await this.updateMappings()
		} catch (error) {
			this.logger.error("Failed to update YouTube cache info " + this.mappingFilename + ": " + error)
		}
	},
	
	updateMappings: async function() {
		this.logger.debug('updateMappings for %s mapping links', Object.keys(this.mapping).length)
		let urls = Object.keys(this.mapping)
		for(let i=0; i < urls.length; i++) {
			await this.updateMapping(urls[i])
		}
	},
	
	updateMapping: async function(url) { // actual stream URL, in case of Youtube: temporary one
		let entry = this.mapping[url]
		this.logger.debug("checking url for '%s'", entry.title)
		let m = url.match(/[?&]expire=(\d+)/)
		if (m) {
//			if (entry.title.indexOf('xxxxxxx') == -1) return
			let expire = moment.unix(m[1])
			this.logger.info("Expire date for '%s' is %s -> %s", entry.title, expire, expire.from(moment()))
			if (expire.isBefore(moment())) {
				this.logger.debug("%s has expired, refetching", entry.title)
				let list = await this.getQueueRaw()
				console.log(list)
				let entry2 = list.filter(entry3 => url == entry3.file)
				if (entry2.length == 0) {
					this.logger.warn("Mapping entry for '%s' does not exist anymore in playlist: %s", entry.title, entry.orig_url)
					// TODO might exist in the other mpd?
					delete this.mapping[url]
					await this.saveMappings()
					return
				} else {
					this.logger.debug("Found file in current playlist: %o", entry2)
				}
				for(let i=0; i<entry2.length; i++) { 
					this.logger.debug("Removing playlist entry #%s (Id #%s) for '%s'", [entry2[i].Pos], [entry2[i].Id], [entry2[i].title])
					let res = await this.mpdCommand("deleteid", [entry2[i].Id]) 
				}
				await this.getYoutubeUrl(entry.orig_url, entry2[0].Pos)
			} else {
				this.logger.debug("'%s' has not expired yet", entry.title)
			}
		} else {
			this.logger.debug("'%s' url did not contain an expire date: %s", entry.title, url)
		}
	},
	
	getYoutubeUrl: async function(url, pos = null) {
		this.logger.info("Retrieving Youtube URL for %s%s", url, pos != null ? " (placing at pos #" + pos + ")" : "")
		this.logger.debug("Using binary from %s", youtubedl.getYtdlBinary())

		let options = ['--format=bestaudio']
		let info = undefined
		try {
			info = await promisify(youtubedl.getInfo.bind(youtubedl))(url, options)
		} catch (e) {
			this.logger.error("Exception during youtube-dl: " + e)
			return "failed to get YouTube file: " + e
		}
		this.logger.info('Found: %s', info.title)
		let res = await this.mpdCommand("addid", [info.url])
		let res2 = this.parseKeyValue(res)
		if (pos) {
			let res3 = await this.mpdCommand("moveid", [res2.Id, pos])
		}
		let res4 = await this.mpdCommand("addtagid", [res2.Id, 'title', info.title])
		let res5 = await this.mpdCommand("addtagid", [res2.Id, 'name', info.title])
		this.logger.debug('Queue add ' + info.url + " as #" + res2.Id)
//		this.logger.debug("Youtube details: %o", info)
		//		await this.fadePlay(1, res2.Id)
		mapping = {
			type: 'YouTube',
			name: 'YouTube',
			title: info.title,
			orig_url: url,
			orig_retrieved: Date.now(),
		}
		this.mapping[info.url] = mapping
		this.saveMappings()
		return "Added " + info.title
	},
}
    await self.init()
    return self
}
