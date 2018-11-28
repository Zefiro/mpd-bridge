// https://github.com/EmergingTechnologyAdvisors/node-serialport/blob/3.1.2/README.md
var SerialPort = require('serialport')

/* Hardware:
 * /dev/ttyUSB1 for USB UART
 *
 * not working? See who's using it:
 *   sudo fuser /dev/ttyUSB1
 *
 * Try with screen
 *   screen /dev/ttyUSB1 2400
 */
 
// returns the bit value
function BV(idx) {
	return 1 << idx
}

 module.exports = function(comPortName) { 
	var self = {
		
	_comPortName: comPortName,
	_ready: false,
	port: undefined,
	listeners: [],

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
					console.log("Extender: button " + i + " " + (pressed ? "pressed" : "released"))
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
			console.log("Extender: output %d changed to %d", extIdx, extValue)
		}
		if (!found) {
			console.log("Extender: Unrecognized input: '" + data + "'")
		}
	},
	
	send: async function(data) {
		await this.port.write(data + '\n');
		console.log("Extender write: " + data)
		return "Wrote " + data
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
			console.log("Extender: no listener registered for button " + btnIdx)
		}
	},
	
	init: function() {
        this.port = new SerialPort(this._comPortName, {
            baudRate: 115200,
        })
		const parser = this.port.pipe(new SerialPort.parsers.Readline())		
		this.port.on('open', function (data) {
            console.log('Extender: Serial port "' + this._comPortName + '" opened')
			this._ready = true
        }.bind(this));
        this.port.on('error', function (error) {
           console.log('Extender: failed to open serial port ' + this._comPortName + ': ' + error)
		   this._ready = false
        }.bind(this));
        parser.on('data', this.receiveSerial.bind(this));
	},
	
	addListener: function(btnIdx, pressed, callback) {
		this.listeners.push({ btnIdx: btnIdx, pressed: pressed, callback: callback })
	}
	
}
    self.init()
    return self
}
