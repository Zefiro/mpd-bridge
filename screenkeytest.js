const SerialPort = require('serialport')
const winston = require('winston')
const fs = require('fs')
const Mutex = require('async-mutex').Mutex
const jsonc = require('./jsonc')()
const path = require('path')
const moment = require('moment')
const Influx = require('influx');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

const COL_OFF=0x10
const DARK_GREEN_LEFT=0x01
const DARK_GREEN_RIGHT=0x02
const DARK_GREEN=0x03
const LIGHT_GREEN=0x33
const DARK_RED_LEFT=0x04
const DARK_RED_RIGHT=0x08
const DARK_RED=0x0c
const LIGHT_RED_LEFT=0x44
const LIGHT_RED_RIGHT=0x88
const LIGHT_RED=0xcc
const DARK_ORANGE=0x0f
const LIGHT_ORANGE=0xff



 module.exports = function(god, loggerName = 'keys') { 
	var self = {

	offlineMode: false, // will not connect to or complain about missing serial

	logger: {},
	log: { sending: true, ack: true, },
	serial: null,
	serialReady: false,
	serialMutex: new Mutex(),
	serialWaitForAck: null,
	led: 0,
	bitmaps: {},
	keyconfig: [],
	currentMode: 'default',
	serialKeepAliveTimer: null,
	
	init: async function() {
		this.logger = winston.loggers.get(loggerName)
		// TODO use https://github.com/dhepper/font8x8 or https://github.com/robhagemans/hoard-of-bitfonts or something...
		let buffer = fs.readFileSync(path.resolve(__dirname, 'bitmaps', 'numbers.json'), 'utf-8')
		this.bitmaps = jsonc.parse(buffer)
		buffer = fs.readFileSync(path.resolve(__dirname, 'bitmaps', 'misc.json'), 'utf-8')
		Object.assign(this.bitmaps, jsonc.parse(buffer))
		this.setKeyconfig()
		this.initSerial()
		this.onStateChanged = this.onStateChanged.bind(this)
		this.onSensorUpdated = this.onSensorUpdated.bind(this)
		this.onHistoricValueUpdated = this.onHistoricValueUpdated.bind(this)
		god.onStateChanged.push(this.onStateChanged)
		god.onSensorUpdated.push(this.onSensorUpdated)
		god.onHistoricValueUpdated.push(this.onHistoricValueUpdated)
		god.ioOnConnected.push(async socket => {
			socket.on('screenkeys-btn', idx => {
				this.onButtonPress(idx, 0)
			})
			socket.on('screenkeys-btnup', idx => {
				this.onButtonRelease(idx, 0)
			})
			// TODO for bitmap.html - but that's broken as I changed /bitmap to /browser
			socket.on('load_bitmap', async (data) => {
				this.logger.info("Loading Bitmap %o", data)
				socket.emit('load_bitmap', this.bitmaps[data])
			})
			this.logger.info('Client connected from %s - triggering full refresh', socket.client.conn.remoteAddress)
			this.doRefreshAll()
		})
		this.influxDB = new Influx.InfluxDB({
				'host': god.config.influx.host,
				'port': god.config.influx.port,
				'username': god.config.influx.user,
				'password': god.config.influx.passwd,
				'database': god.config.influx.database,
			})
	},
	
	setKeyconfig: async function(mode = 'default') {
		this.logger.info('setKeyconfig(%s)', mode)
		let c = (cbRefresh, cbStateChanged, cbSensorUpdated, cbButtonPress, cbButtonRelease) => ({ 'onRefresh': cbRefresh, 'onStateChanged': cbStateChanged, 'onSensorUpdated': cbSensorUpdated, 'onButtonPress': cbButtonPress, 'onButtonRelease': cbButtonRelease })
		let refresh = idx => this.doRefresh(idx)
		let refreshOld = idx => this.doRefresh_old(idx)
		let empty = idx => this.paintStaticBitmap(idx)
		let setKeyconfig = mode => async (buttonIdx, buttons) => { this.setKeyconfig(mode); await this.doRefreshAll() }
		let onButtonPressOld = (buttonIdx, buttons) => this.onButtonPress_old(buttonIdx, buttons)
		let state = (name, value, orCondition = null) => () => god.state[name] == value || (orCondition && orCondition())
		if (mode == 'default') {
			this.keyconfig = [
				c(idx => this.paintStaticBitmap(idx, 'blinds', state('blinds1up', 'ON', state('blinds1down', 'ON', state('blinds2up', 'ON', state('blinds2down', 'ON'))))), refresh, null, null, setKeyconfig('blinds')),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(refreshOld, refresh, null, onButtonPressOld, null),
				c(refreshOld, refresh, null, onButtonPressOld, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(refreshOld, null, null, onButtonPressOld, null),
				c(refreshOld, null, null, onButtonPressOld, null),
				c(idx => this.paintSensorValue(idx, 'co2', 'sensor1.value.SCD30.CarbonDioxide'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, 'temp', 'sensor2.value.DS18B20-1.Temperature'), null, refresh, null, setKeyconfig('tempOverview')),
			]
		} else if (mode == 'blinds') {
			this.keyconfig = [
				c(idx => this.paintStaticBitmap(idx, 'main_blinds'), null, null, null, null),
				c(idx => this.paintStaticBitmap(idx, 'up', state('blinds1up', 'ON')), refresh, null, () => god.mqtt.publish('cmnd/grag-main-blinds/Power1', 'ON'), () => god.mqtt.publish('cmnd/grag-main-blinds/Power1', 'OFF')),
				c(idx => this.paintStaticBitmap(idx, 'down', state('blinds1down', 'ON')), refresh, null, () => god.mqtt.publish('cmnd/grag-main-blinds/Power2', 'ON'), () => god.mqtt.publish('cmnd/grag-main-blinds/Power2', 'OFF')),
				c(empty, null, null, null, null),
				c(idx => this.paintStaticBitmap(idx, '2nd_blinds'), null, null, null, null),
				c(idx => this.paintStaticBitmap(idx, 'up', state('blinds2up', 'ON')), refresh, null, () => god.mqtt.publish('cmnd/grag-main-blinds2/Power1', 'ON'), () => god.mqtt.publish('cmnd/grag-main-blinds2/Power1', 'OFF')),
				c(idx => this.paintStaticBitmap(idx, 'down', state('blinds2down', 'ON')), refresh, null, () => god.mqtt.publish('cmnd/grag-main-blinds2/Power2', 'ON'), () => god.mqtt.publish('cmnd/grag-main-blinds2/Power2', 'OFF')),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(() => this.paintStaticBitmap(16, 'exit'), null, null, null, setKeyconfig()),
			]
		} else if (mode == 'tempOverview') {
			this.keyconfig = [
				c(idx => this.paintSensorValue(idx, '1', 'sensor2.value.DS18B20-1.Temperature'), null, refresh, null, setKeyconfig('sensorHistory')),
				c(idx => this.paintSensorValue(idx, '2', 'sensor2.value.DS18B20-2.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '3', 'sensor2.value.DS18B20-3.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '4', 'sensor2.value.DS18B20-4.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '5', 'sensor2.value.DS18B20-5.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '6', 'sensor2.value.DS18B20-6.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '7', 'sensor2.value.DS18B20-7.Temperature'), null, refresh, null, null),
				c(idx => this.paintSensorValue(idx, '8', 'sensor2.value.DS18B20-8.Temperature'), null, refresh, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(() => this.paintStaticBitmap(16, 'exit'), null, null, null, setKeyconfig()),
			]
		} else if (mode == 'sensorHistory') {
			let query = 'SELECT median("Temperature") FROM "SENSOR" WHERE "sensor" = \'DS18B20-1\' AND "location" = \'grag-sensor2\' AND time >= now() - 10h GROUP BY time(1h), "location", "sensor"'
			let d = (cbRefresh, cbHistoricValueUpdated, cbButtonPress, cbButtonRelease) => ({ 'onRefresh': cbRefresh, 'onHistoricValueUpdated': cbHistoricValueUpdated, 'onButtonPress': cbButtonPress, 'onButtonRelease': cbButtonRelease })
			this.keyconfig = [
				c(idx => this.paintStaticBitmap(idx, 'temp'), null, null, null, null),
				c(empty, null, null, null, null),
				d(idx => this.paintHistoricValue(idx, query, 0), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 1), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 2), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 3), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 4), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 5), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 6), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 7), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 8), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 9), refresh, null, null),
				d(idx => this.paintHistoricValue(idx, query, 10), refresh, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(empty, null, null, null, null),
				c(() => this.paintStaticBitmap(16, 'exit'), null, null, null, setKeyconfig()),
			]
			this.triggerHistoricValueQuery(query)
		} else {
			this.logger.error("Unknown keyconfig mode: " + mode)
			this.keyconfig = []
		}
	},
	
	onStateChanged: async function(id, oldState, newState) {
//		console.log("state: " + id + ":", newState)
		for(let idx=0; idx<this.keyconfig.length; idx++) {
			if (this.keyconfig[idx].onStateChanged) await this.keyconfig[idx].onStateChanged(idx, id, oldState, newState)
		}
	}, 

	onSensorUpdated: async function(id, oldState, newState) {
//		console.log("sensor %s updated: %o", id, newState)
		for(let idx=0; idx<this.keyconfig.length; idx++) {
			if (this.keyconfig[idx].onSensorUpdated) await this.keyconfig[idx].onSensorUpdated(idx, id, oldState, newState)
		}
	},
	
	onHistoricValueUpdated: async function(cache) {
		for(let idx=0; idx<this.keyconfig.length; idx++) {
			if (this.keyconfig[idx].onHistoricValueUpdated) await this.keyconfig[idx].onHistoricValueUpdated(idx, cache)
		}
	},
	
	getXPath: function(obj, path) {
		path = path.split('.')
		while (path.length > 0) {
			let currentPath = path.shift()
			if (!obj[currentPath]) return null
			obj = obj[currentPath]
		}
		return obj
	},

	// composes a bitmap of a header image (upper half) and a four-digit number (lower half, decimals allowed)
	// paints the resulting bitmap to the given key
	paintNumberWithHeader: async function(keyIdx, headerBitmapName, value) {
		let bitmap = this.createBitmap(32, 16)
		if (value !== null) {
			let digits = ('    ' + value).substr(-4)
			if (digits[0] != ' ') bitmap.addJson(this.bitmaps[digits[0]], 0, 8)
			if (digits[1] != ' ') bitmap.addJson(this.bitmaps[digits[1]], 8, 8)
			if (digits[2] != ' ') bitmap.addJson(this.bitmaps[digits[2]], 16, 8)
			if (digits[3] != ' ') bitmap.addJson(this.bitmaps[digits[3]], 24, 8)
		} else {
			this.logger.info('paintNumberWithHeader: value is %o', value)
		}
		bitmap.addJson(this.bitmaps[headerBitmapName], 0, 0)
		await this.keysStoreBitmap(keyIdx, bitmap)
		await this.keysSetBitmap(1 << keyIdx, keyIdx)
		await this.keysSetColor(1 << keyIdx, DARK_GREEN)
	},
	
	paintSensorValue: async function(keyIdx, headerBitmapName, valuePath) {
		let value = this.getXPath(god.sensors, valuePath)
//		this.logger.debug('Sensor %s = %s', valuePath, value)
		await this.paintNumberWithHeader(keyIdx, headerBitmapName, value)
	},
	
	historicValueQueryCache: {},
	paintHistoricValue: async function(keyIdx, query, queryIdx) {
		let cache = god.historicValueCache[query]
		if (!cache) {
			return
		}
		if (cache.status == 'Error') {
			// TODO
			return
		}
		if (cache.status == 'Pending' && !cache.value) {
			// TODO
			return
		}
		let value = 0
		let headerBitmapName = ''
		let now = moment()
		res = cache.value[queryIdx]
		if (!res) {
			this.logger.warn("Historic query '%s' failure", query)
			return
		}
		let m = moment(res.time)
		console.log()
		value = res.median
		this.logger.debug('Historic value "%s" index %s => %s / %s', query, queryIdx, m.from(now), value)
		await this.paintNumberWithHeader(keyIdx, headerBitmapName, value)
	},
	
	// paints a named bitmap to the given keyIdx
	// if a condition callback is given and returns true, uses the bitmapName2 instead
	// if no bitmapName2 is given, then just inverts the bitmap
	paintStaticBitmap: async function(keyIdx, bitmapName = '', cbCondition = null, bitmapName2 = null) {
		let bitmap = this.createBitmap(32, 16)
		if (cbCondition && cbCondition()) {
			if (bitmapName2) {
				bitmap.addJson(this.bitmaps[bitmapName2], 0, 0)
			} else {
				bitmap.addJson(this.bitmaps[bitmapName], 0, 0)
				bitmap.invert()
			}
		} else {
			bitmap.addJson(this.bitmaps[bitmapName], 0, 0)
		}
		await this.keysStoreBitmap(keyIdx, bitmap)
		await this.keysSetBitmap(1 << keyIdx, keyIdx)
		await this.keysSetColor(1 << keyIdx, DARK_GREEN)
	},
	
	doRefreshAll: async function() {
		await this.keysSetColor((1 << 18)-1, COL_OFF)
		for(let i=0; i<17; i++) { await this.doRefresh(i) }
	},

	timerCount: 0,
    onTimer: function() {
		if (!this.serial) return
        this.timerCount++
        this.logger.debug('Send keep-alive')
		this.serial.write('\n')
        if (this.timerCount == 1) {
            this.paintStaticBitmap(8, 'main_blinds')
            this.paintStaticBitmap(9, 'main_blinds')
            this.paintStaticBitmap(10, 'main_blinds')
            this.paintStaticBitmap(11, 'main_blinds')
            this.paintStaticBitmap(12, 'main_blinds')
            this.paintStaticBitmap(13, 'main_blinds')
        }
    return
	},

// ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------
	
	col: 0,
	col2: 0,
	doRefresh: async function(idx) {
		if (this.keyconfig[idx] && this.keyconfig[idx].onRefresh) await this.keyconfig[idx].onRefresh(idx)
		else {
			this.logger.error("Keyconfig undefined for refresh on #%s", idx)
			await this.paintStaticBitmap(idx, 'error')
			await this.keysSetColor(1 << idx, DARK_RED)
		}
	},

	doRefresh_old: async function(idx) {
		if (idx == 0) {
			let b = this.createBitmap(32, 16)
			b.addJson(this.bitmaps['blinds'], 0, 0)
			if (god.state['blinds1up'] == 'ON' || god.state['blinds1down'] == 'ON' || god.state['blinds2up'] == 'ON' || god.state['blinds2down'] == 'ON') b.invert()
			await this.keysStoreBitmap(0, b)
			await this.keysSetBitmap(1 << 0, 0)
			await this.keysSetColor(1 << 0, DARK_GREEN)
		}
		if (idx == 6) {
			let b = this.createBitmap(32, 16)
			let col
			if (god.state['mpd1'] && god.state['mpd1'].status) {
				if (god.state['mpd1'].status.state == 'stop') {
					b.addJson(this.bitmaps['musik_play'], 0, 0)
					col = DARK_GREEN_LEFT
				} else {
					b.addJson(this.bitmaps['musik_stop'], 0, 0)
					col = LIGHT_GREEN
				}
			} else {
				b.addJson(this.bitmaps['error'], 0, 0)
				col = DARK_RED_LEFT
			}
			await this.keysStoreBitmap(6, b)
			await this.keysSetBitmap(1 << 6, 6)
			await this.keysSetColor(1 << 6, col)
		}
		if (idx == 7) {
			let b = this.createBitmap(32, 16)
			b.addJson(this.bitmaps['main_light'], 0, 0)
			await this.keysStoreBitmap(7, b)
			await this.keysSetBitmap(1 << 7, 7)
			let col = god.state['main-light1'] == 'ON' ? LIGHT_RED_LEFT : DARK_GREEN_LEFT
			col |= god.state['main-light2'] == 'ON' ? LIGHT_RED_RIGHT : DARK_GREEN_RIGHT
			await this.keysSetColor(1 << 7, col)
		}
		if (idx == 13) {
			await this.paintNumberWithHeader(13, 'co2', this.col)
			await this.keysSetColor(1 << 13, this.col)
		}
		if (idx == 14) {
			await this.paintNumberWithHeader(14, 'co2', this.col2)
			await this.keysSetColor(1 << 14, this.col2)
		}
		if (idx == 15) {
			if (god.sensors['sensor1'] && god.sensors['sensor1'].value && god.sensors['sensor1'].value['SCD30'] && god.sensors['sensor1'].value['SCD30'].CarbonDioxide) {
				let co2 = god.sensors['sensor1'].value['SCD30'].CarbonDioxide
				await this.paintNumberWithHeader(15, 'co2', co2)
				await this.keysSetColor(1 << 15, co2 < 600 ? LIGHT_GREEN : co2 < 1000 ? DARK_GREEN : co2 < 1500 ? DARK_RED : LIGHT_RED)
			}
		}
		if (idx == 16) {
			if (god.sensors['sensor2'] && god.sensors['sensor2'].value && god.sensors['sensor2'].value['DS18B20-1'] && god.sensors['sensor2'].value['DS18B20-1'].Temperature) {
				let temp = god.sensors['sensor2'].value['DS18B20-1'].Temperature
				await this.paintNumberWithHeader(16, 'temp', temp)
				await this.keysSetColor(1 << 16, DARK_GREEN)
			}
		}
	},
	
	onButtonPress: async function(buttonIdx, buttons) {
		this.logger.info('Button %i pressed', buttonIdx)
		if (this.keyconfig[buttonIdx] && this.keyconfig[buttonIdx].onButtonPress) await this.keyconfig[buttonIdx].onButtonPress(buttonIdx, buttons)
	},

	onButtonPress_old: async function(buttonIdx, buttons) {
		if (buttonIdx == 1) god.mqtt.publish('cmnd/grag-main-blinds/Power1', 'ON')
		if (buttonIdx == 2) god.mqtt.publish('cmnd/grag-main-blinds/Power2', 'ON')
		if (buttonIdx == 6) god.mqtt.publish('cmnd/grag-mpd1/toggle', '1')
		if (buttonIdx == 7) {
			let onState = god.state['main-light1'] == 'ON' || god.state['main-light2'] == 'ON'
			let newState = onState ? "OFF" : "ON"
			god.mqtt.publish('cmnd/grag-main-light/POWER1', newState)
			god.mqtt.publish('cmnd/grag-main-light/POWER2', newState)
		}
		if (buttonIdx == 13) {
			this.col++
			console.log("Color: " + this.col)
			await this.doRefresh(13)
		}
		if (buttonIdx == 14) {
			this.col2++
			this.col = 0
			console.log("Color2: " + this.col2)
			await this.doRefresh(14)
			await this.doRefresh(13)
		}
	},

	onButtonRelease: async function(buttonIdx, buttons) {
		if (this.keyconfig[buttonIdx] && this.keyconfig[buttonIdx].onButtonRelease) {
			this.logger.info('Button %i released', buttonIdx)
			await this.keyconfig[buttonIdx].onButtonRelease(buttonIdx, buttons)
		}
	},

// ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------
// Serial communication with Screenkeys (incoming)

	initSerial: function() {
		if (this.offlineMode) {
			this.logger.warn("Screenkeys in offline mode")
			return
		}
		if (!fs.existsSync(god.config.screenkeys.tty)) {
			this.logger.info("Serial device %s not found", god.config.screenkeys.tty)
			return
		}
        try {
            this.serial = new SerialPort(god.config.screenkeys.tty, {
                baudRate: 115200
            })
            this.serial.on('open', this.onSerialOpen.bind(this))
            this.serial.on('data', this.onSerialData.bind(this))
            this.serial.on('close', this.onSerialClose.bind(this))
        } catch(error) {
            this.logger.error('Failed to open %s: %s', god.config.screenkeys.tty, error)
        }
    },

	onSerialOpen: async function() {
		this.logger.info('Serial Port ' + god.config.screenkeys.tty + ' opened');
		this.serialReady = true
		// set loglevel=0 to prevent overrun / timing issues
		var buffer = Buffer.from('lx\n')
//		buffer[1] = 0x00
		buffer[1] = 0xff // TODO debug
		await this.sendSerial(buffer, 'l')
//		await this.doRefreshAll()

		if (this.serialKeepAliveTimer) clearInterval(this.serialKeepAliveTimer)
		this.serialKeepAliveTimer = setInterval(this.onTimer.bind(this), 4000)
	},	

	onSerialClose: function() {
		this.logger.warn('Serial closed')
		this.serialReady = false
		if (this.serialKeepAliveTimer) clearInterval(this.serialKeepAliveTimer)
	},

	pendingSerialData: "",
	// called for each chunk of incoming serial data, which might be a part of one line, but also multiple lines
	onSerialData: async function(data) {
		let d = data.toString()
//		this.logger.debug('Data: %s', d)
		d = d.replace(/\r/g, '') // Serial.println adds both \r\n
		// TODO abort if too long?
		this.pendingSerialData += d
		let s
		while ((s = this.pendingSerialData.indexOf('\n')) != -1) {
			let line = this.pendingSerialData.substr(0, s)
			this.pendingSerialData = this.pendingSerialData.substr(s + 1)
			if (line) await this.onSerialLine(line)
		}
	},
	
	// called for each full line received from serial
	onSerialLine: async function(line) {
//		this.logger.debug("Line: '%s'", line)
		// "welcome back"?
		if (line == 'INFO ?') { // keep-alive request
			this.logger.debug("Keep-Alive requested & sent")
			this.serial.write('\n')
			return
		}
		if (line == 'INFO ~') {
			this.logger.info("Waking up serial connection - resending current config")
// TODO this will deadlock!
//			await this.doRefreshAll()
			return
		}
		// Button change event?
		let match = line.match(/INFO KEYS ([0-9A-Fa-f]+) ([0-9A-Fa-f]+)/)
		if (match) {
			let buttons = parseInt(match[1], 16)
			let changed = parseInt(match[2], 16)
			this.logger.debug("KEY Status changed: %o %o", buttons, changed)
			let buttonIdx = 0
			let buttons2 = buttons
			while (changed > 0) {
				if (changed & 1) {
					if (buttons & 1) {
						this.logger.debug("KEY %s released", buttonIdx)
						await this.onButtonRelease(buttonIdx, buttons)
					} else {
						this.logger.info("KEY %s pressed", buttonIdx)
						await this.onButtonPress(buttonIdx, buttons)
					}
				}
				buttonIdx++
				changed >>= 1
				buttons >>= 1
			}
			return
		}
		if (line.includes("Zefiro")) { // Initialization line
			this.logger.info("Initialization received: %s", line)
			if (this.serialWaitForAck) await this.serialWaitForAck(line)
			return
		} else if (line.startsWith("INFO")) {
			this.logger.info("Connector: %s", line)
			return
		} else if (line.startsWith("DEBUG")) {
			this.logger.debug("Connector: %s", line)
			return
		} else if (line.startsWith("AT")) {
			this.logger.debug("Connector: %s", line)
			return
		} else if (line.startsWith("ACK")) {
			if (this.serialWaitForAck) await this.serialWaitForAck(line)
		} else {
			this.logger.info("Connector: %s", line)
		}
	},

	// TODO Remove
	onTimerLeds: async function() {
		if (!this.serial) return
		let muster = [ 0b0000, 0b0001, 0b0011, 0b0111, 0b1111, 0b1110, 0b1100, 0b1000 ]
		this.led++
		if (this.led >= muster.length) {
			this.led = 0
		}
		await this.keysSetLEDs(muster[this.led])
	},
	
// ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------
// Commands towards Screenkeys (via Serial and also via whiteboard -> web)

	serialWaitForLine: null,
	serialWaitMutex: null,
	serialSendBuffer: [],
	sendSerial: async function(buffer, expectedReturn) {
		if (this.offlineMode || !this.serialReady) return
		if (this.serialWaitForLine) {
			this.logger.debug("Wanting to send %s, but already waiting for serial %s", buffer.toString(), this.serialWaitForLine)
			this.serialSendBuffer.push([buffer, expectedReturn])
			return
		}
		this.sendSerial_internal(buffer, expectedReturn)
	},
	
	sendSerial_internal: async function(buffer, expectedReturn) {
		this.serialWaitMutex = await this.serialMutex.acquire()
		this.log.sending && this.logger.debug("Sending %s", buffer.toString())
		this.serialWaitForLine = expectedReturn
		this.serialWaitForAck = line => {
			if (line == "ACK " + this.serialWaitForLine) {
				this.log.ack && this.logger.debug("TX: got expected '%s'", line)
				this.serialWaitForAck = null
				this.serialWaitForLine = null
				this.serialWaitMutex()
				if (this.serialSendBuffer.length) {
					let [nextBuffer, nextExpectedReturn] = this.serialSendBuffer.shift()
					this.sendSerial_internal(nextBuffer, nextExpectedReturn)
				}
			} else if (line.includes('Zefiro')) {
				// Initialization - resend buffer
				this.serial.write('++ATl')
//				this.serial.write('++ATL') // TODO debug
				this.serial.write(buffer)
			} else {
				// probably a transmit error
				this.logger.error("TX ERR, expecting '%s' but got '%s', resending", this.serialWaitForLine, line)
//				this.serial.write(buffer)
			}
		}
		this.serial.write(buffer)
	},

	// Sends command STORE BITMAP
	keysStoreBitmap: async function (idx, bitmap) {
		let command = { cmnd: 'StoreBitmap', idx: idx, bitmap: bitmap.toJson() }
		god.whiteboard.getCallbacks('screenkeys').forEach(cb => cb(command))
		if (this.offlineMode) return
		if (!this.serialReady) {
			this.logger.error("keysStoreBitmap - Serial not available")
			return
		}
//		this.logger.debug(bitmap.toJson())
		let buffer = new Uint8Array(67)
		buffer[0] = 'b'.charCodeAt(0)
		buffer[1] =  idx
		buffer.set(bitmap.toBinary(), 2)
		buffer[66] = '\n'.charCodeAt(0)
//		this.logger.debug(buffer.toString())
		await this.sendSerial(buffer, 'b')
	},
	
	// Sends command SET BITMAP
	keysSetBitmap: async function(keyMask, idx) {
		let command = { cmnd: 'SetBitmap', keymask: keyMask, idx: idx }
		god.whiteboard.getCallbacks('screenkeys').forEach(cb => cb(command))
		if (this.offlineMode) return
		if (!this.serialReady) {
			this.logger.error("keysSetBitmap - Serial not available")
			return
		}
		buffer = Buffer.from('cxxxx\n');
		buffer[1] = keyMask >> 16
		buffer[2] = (keyMask >> 8) & 0xFF
		buffer[3] = keyMask & 0xFF
		buffer[4] = idx
		await this.sendSerial(buffer, 'c')
	},
	
	// Sends command SET LEDS
	keysSetLEDs: async function(ledMask) {
		let command = { cmnd: 'SetLEDs', ledmask: ledMask }
		god.whiteboard.getCallbacks('screenkeys').forEach(cb => cb(command))
		if (this.offlineMode) return
		if (!this.serialReady) {
			this.logger.error("keysSetLEDs - Serial not available")
			return
		}
		let buffer = Buffer.from('dx\n')
		buffer[1] = ledMask
		await this.sendSerial(buffer, 'd')
	},
	
	// Sends command SET COLOR
	keysSetColor: async function(keyMask, color) {
		let command = { cmnd: 'SetColor', keymask: keyMask, color: color }
		god.whiteboard.getCallbacks('screenkeys').forEach(cb => cb(command))
		if (this.offlineMode) return
		if (!this.serialReady) {
			this.logger.error("keysSetColor - Serial not available")
			return
		}
		buffer = Buffer.from('axxxx\n')
		buffer[1] = keyMask >> 16
		buffer[2] = (keyMask >> 8) & 0xFF
		buffer[3] = keyMask & 0xFF
		buffer[4] = color
		await this.sendSerial(buffer, 'a')
	},
	
// ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------
// Bitmap helper class

	// returns an empty bitmap object of the given size. Use bitmap.addJson to place stuff in it.
	createBitmap: function(sizeX, sizeY) { return {
		data: new Array(sizeX * sizeY),
		logger: this.logger,
		
		invert: function() {
			for(let i=0; i<this.data.length; i++) {
				this.data[i] = !this.data[i]
			}
		},
		
		// adds a json-style bitmap on top of this bitmap (blend more: OR)
		addJson: function(json, fromX=0, fromY=0) {
			if (!json) {
				this.logger.error("json not defined")
				return
			}
			if (fromX >= sizeX || fromY >= sizeY) return
			let maxX = Math.min(sizeX - fromX, json.x)
			let maxY = Math.min(sizeY - fromY, json.y)
			for(y = 0; y < maxY; y++) {
				let line = json['line' + (y < 10 ? '0' : '') + y]
				for(x = 0; x < maxX; x++) {
					if (line[x] != ' ') {
						this.data[(fromY + y) * sizeX + fromX + x] = 1
					}
				}
			}
		},
		
		// Returns a json-style representation of this bitmap, to be used with bitmap.addJson as well as the web interface
		toJson: function(name = '') {
			let json = {
				"name": name,
				'x': sizeX,
				'y': sizeY,
			}
			for(y = 0; y < sizeY; y++) {
				let line = ''
				for(x = 0; x < sizeX; x++) {
					line += this.data[y * sizeX + x] ? 'X' : ' '
				}
				json['line' + (y < 10 ? '0' : '') + y] = line
			}
			return json
		},
		
		// returns a binary representation of this bitmap to be send to Screenkeys
		toBinary: function() {
			let sizeX2 = (sizeX >> 3) + (sizeX & 7 ? 1 : 0)
			let buffer = new Uint8Array(sizeX2 * sizeY)
			let bufIdx = 0
			for(y = 0; y < sizeY; y++) {
				let c = 0
				let i = 0
				for(x = 0; x < sizeX; x++) {
					c |= (this.data[y * sizeX + x] ? 1 : 0) << i
					if (i < 7) {
						i++
					} else {
						buffer[bufIdx] = c
						bufIdx++
						c = 0
						i = 0
					}
				}
			}
			return buffer
		}
	}},

// ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ---------- ----------
// InfluxDB helper class

	InfluxHelper: function(conf) { return {
		influxDb: null,
		
		connect: async function() {
			this.influxDb = new Influx.InfluxDB({
				'host': conf.host,
				'port': conf.port,
				'username': conf.user,
				'password': conf.passwd,
				'database': conf.database,
			})
		},
		
	}},

	triggerHistoricValueQuery: async function(query) {
		let cache = god.historicValueCache[query]
		if (!cache) cache = { query: query }
		if (cache.status == "Pending") return
		if (cache.cachedUntil && moment().isBefore(cache.cachedUntil)) { return cache }
		
		cache.status = "Pending"
		cache.value = null
		god.historicValueCache[query] = cache

		try {
			res = await this.influxDB.query(query)
			cache.value = res
			cache.cachedUntil = moment().add(5, 'm')
			cache.status = "OK"
		} catch (error) {
			this.logger.error("QueryHistoricValue of '%s': %s", query, error)
			cache.status = "Error"
			cache.cachedUntil = moment().add(1, 'm')
		}
		god.historicValueCache[query] = cache
		god.onHistoricValueUpdated.forEach(cb => cb(cache))
	},
	
}
    self.init()
    return self
}

// ----------------------------------------

let sConfigFile = 'prod.json'
console.log("Loading config " + sConfigFile)
let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
let config = jsonc.parse(configBuffer)

var god = {
	terminateListeners: [],
	terminate: {},
	ioSocketList: {},
	ioOnConnected: [],
	state: {},
    things: {},
	sensors: {},
	historicValueCache: {},
	onStateChanged: [],
	onThingChanged: [],
	onSensorUpdated: [],
	onHistoricValueUpdated: [],
	config: config,
	serverRunningSince: new Date(),
}

god.whiteboard = { 'getCallbacks': () => [] }

function addNamedLogger(name, level = 'debug', label = name) {
    let { format } = require('logform');
	let prettyJson = format.printf(info => {
	  if (info.message.constructor === Object) {
		info.message = JSON.stringify(info.message, null, 4)
	  }
	  return `${info.timestamp} [${info.level}]\t[${info.label}]\t${info.message}`
	})
	let getFormat = (label, colorize = false) => {
		let nop = format((info, opts) => { return info })
		return format.combine(
			colorize ? format.colorize() : nop(),
			format.timestamp({
				format: 'YYYY-MM-DD HH:mm:ss',
			}),
			format.label({ label: label }),
			format.splat(),
			prettyJson
			)
	}
	winston.loggers.add(name, {
	  level: level,
	  transports: [
		new winston.transports.Console({
			format: getFormat(label, true),
		}),
		new winston.transports.File({ 
			format: getFormat(label, false),
			filename: 'winston-test.log'
		})
	  ]
	})
}

// prepareNamedLoggers
config.logger.keys = 'debug';

(()=>{
	let knownLoggers = ["main", "web", "mpd1", "mpd2", "gpio", "mqtt", "ubnt", "POS", "Flipdot", "allnet", "tasmota", "net", "keys", "scenario", "things"]
	knownLoggers.forEach(name => {
		let level = config.logger[name] || 'debug'
		addNamedLogger(name, level)
	})
})()
const logger = winston.loggers.get('main')
logger.info('Grag waking up and ready for service')

sk =  module.exports(god)


