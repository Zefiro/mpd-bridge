// shows various texts on a usb-serial Point-of-Sale 2x20 display
//
// Flipdot has 2x18 (or 19?) chars. Stays in the same line, overwriting the last char, thus needs \n. \b clears screen (probably too fast for flickering?)
// Listens to MQTT
//

const chokidar = require('chokidar')
const winston = require('winston')
const fs = require('fs')
const fsa = fs.promises


module.exports = function(god, loggerName = 'Flipdot') { 
	var self = {

	mqttTopic: 'grag-flipdot/text',
	controller: {},
	available: false,
	light: 'OFF',
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.preterminateListeners.push(this.onPreTerminate.bind(this))
		this.controller = require('./DisplayControl')(god, loggerName)
		this.controller.fnUpdate = this.writeToFlipdot.bind(this)
		this.logger.debug("Subscribing to mqtt")
		god.mqtt.addTrigger('cmnd/grag-flipdot/light', 'cmnd-flipdot-light', this.onMqttCmndLight.bind(this))
		god.mqtt.addTrigger('grag-flipdot/ping', 'flipdot-ping', this.onMqttPing.bind(this))
		this.available = true
		this.controller.enable()
	},
	
	onPreTerminate: async function() {
        await this.writeToFlipdot('-- Offline --')
	},
	
	onMqttCmndLight: async function(trigger, topic, message, packet) {
		if (message) this.light = (message == 'ON' ? 'ON' : 'OFF')
		this.logger.debug("stat: light: " + this.light)
		god.mqtt.publish(this.mqttTopic, '\x1BL' + (this.light == 'ON' ? '1' : '0'))
		god.mqtt.publish('stat/grag-flipdot/light', this.light)
	},

	onMqttPing: async function(trigger, topic, message, packet) {
		this.logger.debug("Ping received: %s", message)
	},

	writeToFlipdot: async function(content) {
		let cmd = this.controller.sanitizeLines(content, 2, 18, '\b', '\n')
		this.logger.debug("Flipdot (light is %s): '%s'", this.light, this.controller.encode(cmd))
		await god.mqtt.publish(this.mqttTopic, cmd + '\x1BL' + (this.light == 'ON' ? '1' : '0'))
	},

	addEntry: function(id, content) {
		this.controller.addEntry(id, content)
	},
	
}
    self.init()
    return self
}
