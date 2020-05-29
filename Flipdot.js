// shows various texts on a usb-serial Point-of-Sale 2x20 display
//
// Flipdot has 2x18 (or 19?) chars. Stays in the same line, overwriting the last char, thus needs \n. \b clears screen (probably too fast for flickering?)
// Listens to MQTT
//

const chokidar = require('chokidar')
const winston = require('winston')
const fs = require('fs')
const fsa = fs.promises


 module.exports = function(god, loggerName = 'POS') { 
	var self = {
		
	mqttTopic: 'grag-flipdot/text',
	controller: {},
	available: false,
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.terminateListeners.push(this.onTerminate.bind(this))
		this.controller = require('./DisplayControl')(god, loggerName)
		this.controller.fnUpdate = this.writeToFlipdot.bind(this)
		this.available = true
		this.controller.enable()
	},
	
	onTerminate: async function() {
	},

	writeToFlipdot: async function(content) {
		let cmd = this.controller.sanitizeLines(content, 2, 18, '\b', '\n')
		this.logger.debug("Flipdot: '" + this.controller.encode(cmd) + "'")
		god.mqtt.client.publish(this.mqttTopic, cmd, { retain:true })
	},

	addEntry: function(id, content) {
		this.controller.addEntry(id, content)
	},
	
}
    self.init()
    return self
}
