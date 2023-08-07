// https://github.com/EmergingTechnologyAdvisors/node-serialport/blob/3.1.2/README.md
const { SerialPort } = require('serialport')
const { ReadlineParser } = require('@serialport/parser-readline')
const winston = require('winston')

/* Hardware:
 * /dev/ttyUSB1 for USB UART
 *
 * not working? See who's using it:
 *   sudo fuser /dev/ttyUSB1
 *
 * Try with screen
 *   screen /dev/ttyUSB1 115200
 */

const BAUDRATE=115200

// returns the bit value
function BV(idx) {
	return 1 << idx
}

 module.exports = function(god, loggerName = 'extender') { 
	var self = {
		
	comPortName: god.config.extender.comPortName,
	_ready: false,
	port: undefined,
	listeners: [],

	init: function() {
        this.logger = winston.loggers.get(loggerName)
		this.port = new SerialPort({ path: this.comPortName,
            baudRate: BAUDRATE,
        })
		const parser = this.port.pipe(new ReadlineParser())
		this.port.on('open', function (data) {
            this.logger.info('Extender: Serial port "' + this.comPortName + '" opened')
			this._ready = true
        }.bind(this));
        this.port.on('error', function (error) {
           this.logger.error('Extender: failed to open serial port ' + this.comPortName + ': ' + error)
		   this._ready = false
        }.bind(this));
        parser.on('data', this.receiveSerial.bind(this));
        god.whiteboard.addCallback('extender.setOutput', this.onExtenderSetOutput.bind(this))
	},
	
    receiveSerial: function(data) {
		if (!data || !data.trim()) return
		var found = false
		if (data == "Medusa Extender") {
			// Init string, ignore)
			return
		}
		var r = /B(\d+)-(\d+)/.exec(data)
		if (r) {
			found = true
			var butVal = r[1]
			var butChanged = r[2]
			var i = 0
			while (butChanged >= BV(i)) {
				if (butChanged & BV(i)) {
					var pressed = !!(butVal & BV(i))
					this.logger.info("Extender: button " + i + " " + (pressed ? "pressed" : "released"))
					this.callButListener(i, pressed, butVal)
				}
				i++
			}
		}
		var s = /S(\d+)=(\d+)/.exec(data)
		if (s) {
			found = true
			var extIdx = s[1]
			var extValue = s[2]
			this.logger.info("Extender: output %d changed to %d", extIdx, extValue)
            god.whiteboard.getCallbacks('extender.output').forEach(cb => cb(extIdx, extValue))
		}
		if (!found) {
			this.logger.info("Extender: Unrecognized input: '" + data + "'")
		}
	},
	
	send: async function(data) {
		await this.port.write(data + '\n');
		this.logger.debug("Extender write: " + data)
		return "Wrote " + data
	},
    
    // This will set the extender output extIdx (starting with 1) to value extValue (0 or 1)
    onExtenderSetOutput: async function(extIdx, extValue) {
        let res = await this.send('S' + extIdx + extValue)
        this.logger.debug("Setting ouput %s to %s: %s", extIdx, extValue, res)
    },
	
	callButListener: function(btnIdx, pressed, butVal) {
		var found = false
		this.listeners.forEach(e => {
			if (e.btnIdx == btnIdx && e.pressed == pressed) {
				e.callback(pressed, butVal)
				found = true
			}
		})
		if (!found) {
			// only complain if neither press nor release listeners are registered
			this.listeners.forEach(e => { if (e.btnIdx == btnIdx) { found = true } })
		}
		if (!found) {
			this.logger.warn("Extender: no listener registered for button " + btnIdx)
		}
	},
	
	addListener: function(btnIdx, pressed, callback) {
		this.listeners.push({ btnIdx: btnIdx, pressed: pressed, callback: callback })
	}
	
}
    self.init()
    return self
}
