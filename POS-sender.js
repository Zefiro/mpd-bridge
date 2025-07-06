// shows various texts on a usb-serial Point-of-Sale 2x20 display
//
// POS has 2 lines with 20 chars each. Wraps around on end of line. Supports backspace and newline. \f clears screen (flickering) and ensures the cursor is at home
//
// lsusb
//   Bus 001 Device 006: ID 0416:f012 Winbond Electronics Corp.
// modprobe usbserial vendor=0x0416 product=0xf012
// -> /dev/ttyACM0

//const chokidar = require('chokidar')
const winston = require('winston')
const fs = require('fs')
const fsa = fs.promises


module.exports = function(god, loggerName = 'POS', _mqttTopic = undefined) {
	var self = {
		
	controller: {},
	mqttTopic: _mqttTopic ?? loggerName + '/',
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.preterminateListeners.push(this.onPreTerminate.bind(this))
		god.terminateListeners.push(this.onTerminate.bind(this))
		this.controller = require('./DisplayControl')(god, loggerName)
		this.controller.fnUpdate = this.writeToPOS.bind(this)
        this.controller.enable()
	},
	
	onPreTerminate: async function() {
        god.mqtt && god.mqtt.publish(this.mqttTopic + 'text', '(Sender Offline)')
	},

	onTerminate: async function() {
	},

	
	writeToPOS: async function (content) {
        god.mqtt && god.mqtt.publish(this.mqttTopic + 'text', content)
        this.logger.debug("Sending: %o", content)
	},
	
	addEntry: function(id, content) {
		this.controller.addEntry(id, content)
	}
	
}
    self.init()
    return self
}
