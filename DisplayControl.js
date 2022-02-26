/*
 *
 */

const winston = require('winston')
const moment = require('moment')
const fetch = require('node-fetch')


module.exports = function(god, loggerName = 'DisplayControl') { 
	var self = {
		
	enabled: false,
	table: [],
	recalculateMoment: moment(),
	currentEntry: 0,	
	fnUpdate: () => {},
	updateTimer: undefined,
		
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.ioOnConnected.push(this.onIoConnected.bind(this))
	},
	
	// TODO perhaps it would be easier to just pipe everything through MQTT
	// then I wouldn't need to push to a list of sockets here, of which I need to keep track myself
	onIoConnected: async function(socket) {
		socket.on(loggerName + '-config-set', async (data) => {
			this.setDataFromWeb(data)
		})
		socket.emit(loggerName + '-config-update', this.getDataForWeb())
	},
	
	addEntry: function(entry) {
		this.logger.info('Added entry ' + entry.id)
		entry.controller = this
		this.table.push(entry)
		this.update()
		return entry
	},
	
	removeEntry: function(id) {
		this.logger.info('Removed entry ' + id)
		throw new Error('not implemented')
		// todo delete this.table[id]
		if (this.currentEntry.idx >= this.table.length) {
			this.update(true)
		}
	},
	
	periodicUpdate: async function() {
		if (moment().isBefore(this.recalculateMoment)) return
		return this.update()
	},

	currentEntry: {
		idx: 0,
		showUntil: moment(),
	},
	
	enable: function() {
		this.enabled = true
		this.update(true)
	},
	
	disable: function() {
		this.updateTimer && clearTimeout(this.updateTimer)
		this.enabled = false
	},
	
	/** Triggers an immediate update of the displayed text. if forceChange=true, then an immediate change of the displayed entry is done as well. */
	update: async function(forceChange = false) {
		this.updateTimer && clearTimeout(this.updateTimer)
		if (!this.enabled && !forceChange) return
		let content = ''
		if (this.table.length > 0) {
			// choose which entry to show next
			let entry = this.table[this.currentEntry.idx]
			if (forceChange || moment().isSameOrAfter(this.currentEntry.showUntil) || !entry.active) {
				let idx = this.currentEntry.idx
				do {
					idx = idx >= this.table.length - 1 ? 0 : idx + 1
				} while (!this.table[idx].active && this.currentEntry.idx != idx)
				this.currentEntry.idx = idx
				entry = this.table[this.currentEntry.idx]
				this.currentEntry.showUntil = moment().add(entry.showDurationSec, 's')
			}
			// update entry & get content
			if (entry.active) {
				content = await entry.getContent()
			} else {
				// all entries are inactive
				content = ''
				this.currentEntry.showUntil = moment().add(1, 's')
			}
		}
		
		// display content
		if (forceChange || content != this.currentEntry.lastContent) {			
			this.currentEntry.lastContent = content
			await this.fnUpdate(content)
		}
		// reschedule
		let nextUpdateMs = 1000
		if (!content) {
			// no content? skip to the next entry
			this.currentEntry.showUntil = moment()
			nextUpdateMs = 1
		}
		this.updateTimer = setTimeout(this.update.bind(this), nextUpdateMs)
	},
	
	sanitizeLines: function(text, lines, columns, prefix = '', newline = '', suffix = '') {
		let cmd = '\f'
		let spaces = '                                                            '
		if (text != '') {
			let lines = (text+'\n\n').split(/\r?\n/)
			// TODO if the last char is unicode, two ascii chars are transmitted - and this switches the line in POS display :(
			cmd = prefix + (lines[0] + spaces).substring(0, columns) + newline + (lines[1] + spaces).substring(0, columns) + suffix
		}	
		return cmd
	},
	
	/** Encodes newlines for display in log files */
	encode: function(text) {
		return text.replace(/\n/, '\\n')
	},

	getDataForWeb: function() {
		let data = {}
		this.table.forEach(entry => data[entry.id] = entry.getDataForWeb())
		return data
	},
	
	setDataFromWeb: function(data) {		
		this.table.forEach(entry => { if (data[entry.id]) entry.setDataFromWeb(data[entry.id]) })
		this.update()
	},

	sunsetCache: { cachedUntil: moment() },
	getTasmotaSunset: async function() {
		if (moment().isBefore(this.sunsetCache.cachedUntil)) { return this.sunsetCache }
		try {
			let res = await fetch('http://grag-main-blinds.fritz.box/tm')
			// TODO check if res.status == 200
			let resText = await res.text()
	//		logger.debug("TEST " + " responsed: " + res.status + " " + resText)
			let match = resText.match(/<b>Sunrise<\/b>\s\(([0-9:]+)\).*<b>Sunset<\/b>\s\(([0-9:]+)\)/)
			// TODO check if match.length == 3
			let sunrise = moment(match[1], "HH:mm")
			let sunset = moment(match[2], "HH:mm")
			this.logger.debug("Sunrise: %o, Sunset: %o", sunrise.format(), sunset.format())
			// TODO read offset from rule (perhaps also check if rule is active at all / today)
			let blindsDown = moment(sunset).add(30, 'm')
			let cachedUntil = moment().add(15, 'm')
			this.sunsetCache = { sunrise: sunrise, sunset: sunset, blindsDown: blindsDown, cachedUntil: cachedUntil }
			return this.sunsetCache
		} catch(e) {
			this.logger.error("Error getting sunset: %o", e)
			throw e
		}
	},
	
	fnBase: class {
		constructor(id) {
			this.id = id
			this.active = true
			this.showDurationSec = 4
		}
		async getContent() { return '' }
		getHtml() {return "[undefined]" }
		getDataForWeb() { return { active: this.active } }
		setDataFromWeb(data) {
			if (data.active !== undefined) this.active = data.active
		}
	},
	
	fnCallback: function(id, name, fnCallback) {
		let fn = new this.fnBase()
		fn.id = id
		fn.getContent = async () => {
			return fnCallback()
		},
		fn.getHtml = () => name
		return fn
	},

	fnSunset: function(id) {
		let fn = new this.fnBase()
		fn.id = id
		fn.getContent = async () => {
			try {
				let times = await self.getTasmotaSunset()
				let now = moment()	
				let content = ''
				if (now.isBefore(times.sunrise)) {
					content = 'Sunrise is\n' + times.sunrise.from(now)
				} else if (now.isAfter(times.sunset)) {
					content = 'Sunrise is\n' + moment(times.sunrise).add(1, 'd').from(now)
				} else {
					content = 'Sunset is\n' + times.sunset.from(now)
				}
				return content
			} catch(e) {
				return "-- ERROR --"
			}
		}
		fn.getHtml = () => "Sunrise/Sunset display"
		return fn
	},
	
	fnSunfilter: function(id) {
		let fn = new this.fnBase()
		fn.id = id
		fn.getContent = async () => {
			try {
				let times = await self.getTasmotaSunset()
				let now = moment()	
				let content = ''
				if (now.isBefore(times.sunrise)) {
					content = 'Sunrise is\n' + times.sunrise.from(now)
				} else if (now.isBefore(times.sunset)) {
					content = 'Sunset is\n' + times.sunset.from(now)
				} else if (now.isBefore(times.blindsDown)) {
					content = 'Sunfilter descending\n' + times.blindsDown.fromNow()
				} else {
					content = 'Sunrise is\n' + moment(times.sunrise).add(1, 'd').from(now)
				}
				return content
			} catch(e) {
				console.log(e)
				return "-- ERROR --"
			}
		}
		fn.getHtml = () => "Sunfilter timer display"
		return fn
	},

	fnTime: function(id) {
		let fn = new this.fnBase()
		fn.id = id
		fn.getContent = async () => {
			return moment().format("dddd, DD.MM.YYYY") + '\n      ' + moment().format("H:mm:ss")
		},
		fn.getHtml = () => "Date/Timer display"
		return fn
	},

	fnText: function(id, text) {
		let fn = class extends this.fnBase {
			constructor(id) {
				super(id)
				this.text = text
				this.controller = undefined
			}
			getHtml() { return "Text" }
			async getContent() {
				return this.text
			}
			getDataForWeb() {
				return { ...super.getDataForWeb(), text: this.text }
			}
			setDataFromWeb(data) {
				super.setDataFromWeb(data)
				if (data.text !== undefined) this.text = data.text
			}
		}
		return new fn(id)
	},

}
    self.init()
    return self
}
