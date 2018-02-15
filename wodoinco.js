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

 module.exports = function(comPortName) { 
	var self = {
		
	_comPortName: comPortName,
	_ready: false,
	listeners: [],

    receiveSerial: function(data) {
		console.log("WoDoInCo: received '" + data + "'")
//		data = data.replace(/(\r\n|\n|\r)/gm, "")
		var found = false
		this.listeners.forEach(e => {
			if (e.key == data) {
				e.callback(data)
				found = true
			}
		})
		if (!found) {
			console.log("no listener registered for '" + data + "'")
		}
	},
	
	init: function() {
        const port = new SerialPort(this._comPortName, {
            baudRate: 2400,
        })
		const parser = port.pipe(new SerialPort.parsers.Readline())		
		port.on('open', function (data) {
            console.log('WoDoInCo: Serial port "' + this._comPortName + '" opened')
			this._ready = true
        }.bind(this));
        port.on('error', function (error) {
           console.log('WoDoInCo: failed to open serial port ' + this._comPortName + ': ' + error)
		   this._ready = false
        }.bind(this));
        parser.on('data', this.receiveSerial.bind(this));
	},
	
	addListener: function(key, callback) {
		this.listeners.push({ key: key, callback: callback })
	}
	
}
    self.init()
    return self
}
