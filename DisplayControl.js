/*
 *
 */

const winston = require('winston')
const moment = require('moment')

// Warning: async loading
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

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
        god.mqtt.addTrigger('stat/grag-main-blinds/STATUS7', '', this.onMqtt.bind(this))
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
        await this.getTasmotaSunsetMQTT()
        return this.sunsetCache // this will still return the old, cached value. But that's ok, it only changes once daily
    },

	getTasmotaSunsetMQTT: async function() {
        god.mqtt.publish('cmnd/grag-main-blinds/STATUS', '7')
        this.sunsetCache = { cachedUntil: moment() }
    },

    onMqtt: async function(trigger, topic, message, packet) {
        let newValue = message.toString()
        try {
            let json = JSON.parse(newValue)
            newValue = json
        } catch(e) {}
        if (topic == 'stat/grag-main-blinds/STATUS7') {
            // "Status 7" -> {"StatusTIM":{"UTC":"2023-11-11T16:21:07","Local":"2023-11-11T17:21:07","StartDST":"2023-03-26T02:00:00","EndDST":"2023-10-29T03:00:00","Timezone":99,"Sunrise":"07:29","Sunset":"16:50"}}
			let sunrise = moment(newValue.StatusTIM.Sunrise, "HH:mm")
			let sunset = moment(newValue.StatusTIM.Sunset, "HH:mm")
			this.logger.debug("Sunrise: %o, Sunset: %o", sunrise.format(), sunset.format())
			// TODO read offset from rule (perhaps also check if rule is active at all / today)
			let blindsDown = moment(sunset).add(30, 'm')
			let cachedUntil = moment().add(15, 'm')
			this.sunsetCache = { sunrise: sunrise, sunset: sunset, blindsDown: blindsDown, cachedUntil: cachedUntil }
        }
    },

	// dead code -> has been replaced with async MQTT call
    getTasmotaSunsetREST: async function() {
		try {
			let res = await fetch('http://grag-main-blinds.lair.clawtec.de/tm')
			// TODO check if res.status == 200
			let resText = await res.text()
//			logger.debug("TEST " + " responsed: " + res.status + " " + resText)
			let match = resText.match(/<b>Sunrise<\/b>\s\(([0-9:]+)\).*<b>Sunset<\/b>\s\(([0-9:]+)\)/)
			// TODO check if match.length == 3
			let sunrise = moment(match[1], "HH:mm")
			let sunset = moment(match[2], "HH:mm")
			this.logger.debug("Sunrise: %o, Sunset: %o", sunrise.format(), sunset.format())
			// TODO read offset from rule (perhaps also check if rule is active at all / today)
			let blindsDown = moment(sunset).add(30, 'm')
			let cachedUntil = moment().add(15, 'm')
			this.sunsetCache = { sunrise: sunrise, sunset: sunset, blindsDown: blindsDown, cachedUntil: cachedUntil }
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
                if (!times.hasOwnProperty('sunrise')) {
                    content = 'Sun state unknown'
				} else if (now.isBefore(times.sunrise)) {
					content = 'Sunrise is\n' + times.sunrise.from(now)
				} else if (now.isAfter(times.sunset)) {
					content = 'Sunrise is\n' + moment(times.sunrise).add(1, 'd').from(now)
				} else {
					content = 'Sunset is\n' + times.sunset.from(now)
				}
                god?.mqtt?.publish('sun/sunset', JSON.stringify({ value: content }))
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
                let precise = ''
                if (!times.hasOwnProperty('sunrise')) {
                    content = 'Sun state unknown'
                    precise = moment()
                } else if (now.isBefore(times.sunrise)) {
                    precise = times.sunrise
					content = 'Sunrise is\n' + precise.from(now)
				} else if (now.isBefore(times.sunset)) {
                    precise = times.sunset
					content = 'Sunset is\n' + precise.from(now)
				} else if (now.isBefore(times.blindsDown)) {
                    precise = times.blindsDown
					content = 'Sunfilter descending\n' + precise.fromNow()
				} else { // before midnight: sunrise is next day
                    precise = moment(times.sunrise).add(1, 'd')
					content = 'Sunrise is\n' + precise.from(now)
				}
                god?.mqtt?.publish('sun/sunfilter', JSON.stringify({ value: content, precise: precise.format('h:mm DD.MM.YYYY') }))
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
