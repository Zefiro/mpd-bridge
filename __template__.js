/* Template for creating new modules
 */

const winston = require('winston')

/**
 * Parameters:
 * - the god object, for dependency injection / access to everything else
 * - the name we should use for logging. We should have a sensible default.
 */
module.exports = function(god, loggerName = '__TEMPLATE__') { 
	var self = {
        
    /** Class Attributes */
    mqttTopic: '__TEMPLATE__',


    /** init function, called (explicitely at the end of this file) when this object is required from the main file
     * No parameters here - put those in the module.exports function instead.
     */
    init: function() {
        this.logger = winston.loggers.get(loggerName)
        god.mqtt.addTrigger(this.mqttTopic + '/#', '__TEMPLATE__', this.onMqttMessage.bind(this))
    },
    
    async onMqttMessage(trigger, topic, message, packet) {
		let value = message.toString()
        this.logger.debug('Received mqtt %s: %s', topic, value)
        let pathSegments = topic.split('/')
        // ... further message parsing
    },
    
}
    self.init()
    return self
}
