/* Starts actions at specific absolute or relative times
 */

const winston = require('winston')

// https://stackoverflow.com/a/16608045/131146
var isObject = function(a) {
    return (!!a) && (a.constructor === Object);
}
var isArray = function(a) {
    return (!!a) && (a.constructor === Array);
}

var god, logger

class Timer {
    id = undefined
    isActive = true
    firesAt = undefined
    timeoutId = undefined
    
    constructor(config) {
        this.logger = logger
        this.id = config.id ?? 'Timer #' + this.autoIncrementId++
        this.config = config
        if (config.relTime) {
            // TODO see https://stackoverflow.com/a/1214753/131146
            // regex simple statements of '5m' or '3s' or 5min 3ssec'
            let match = config.relTime.match(/\s*\+?((\d+)\s*m(in)?)?\s*((\d+)\s*s(ec)?)?/)
            if (match) {
                let min = match[2] ?? 0
                let sec = match[5] ?? 0
                this.firesAt = new Date(Date.now() + ((min * 60 + sec) * 1000))
                this.logger.debug('Set timeout for %s to %d min %d sec', this.id, min, sec)
            } else {
                this.logger.error('reltime unrecognized: %s ', config.relTime)
            }
        }
        if (!this.firesAt) {
            this.logger.error('No firing time defined for timer ', id)
            return
        }
        let fireIn = this.firesAt - Date.now()
        this.timeoutId = setTimeout(this.fire.bind(this), fireIn)
    }
    
    unregister(reason) {
        if (this.isActive || this.timeoutId) {
            this.isActive = false
            clearTimeout(this.timeoutId)
            this.timeoutId = undefined
            this.logger.debug('Unregistered "%s"', this.id)
        } else {
            this.logger.debug('Unregister called on "%s", but not active', this.id)
        }
    }
    
    async fire() {
        this.isActive = false
        this.timeoutId = undefined
        this.logger.info('Timer "%s" fired, performing action', this.id)
        let actions = isArray(this.config.action) ? this.config.action : [ this.config ]
        for(let action of actions) {
            if (action.action == 'mqtt') {
                let index = action.mqtt.indexOf(' ')
                let topic = action.mqtt.substr(0, index)
                let message = action.mqtt.substr(index + 1)
                this.logger.debug('Timer "%s": sending mqtt: "%s" "%s"', this.id, topic, message)
                god.mqtt.publish(topic, message)
            } else if (action.action == 'extender') {
                let result = await god.extender.send(action.cmnd);
                this.logger.debug('Timer "%s": sending extender: "%s" -> "%s"', this.id, action.cmnd, result)
            } else {
                this.logger.error('Timer "%s": action unrecognized: %s', this.id, action.action)
            }
        }
    }
}

class RepeatingTimer extends Timer {
    // TODO WIP
}

class TimerController {
    timers = {}
    
    constructor(mqttTopic) {
        this.logger = logger
        this.mqttTopic = mqttTopic
        god.mqtt.addTrigger('cmnd/' + this.mqttTopic + '/#', 'timer', this.onMqttMessage.bind(this))
    }
    
    async onMqttMessage(trigger, topic, message, packet) {
		let data = message.toString()
        this.logger.debug('Received mqtt %s: %s', topic, data)
		try {
			data = JSON.parse(data)
		} catch(e) {
            this.logger.error('MQTT: Failed to parse JSON: ' + data)
            return
        }
        if (topic == 'cmnd/' + this.mqttTopic + '/set') {
            if (this.timers[data.id]) this.timers[id].unregister()
            this.timers[id] = new Timer(data)
        }
    }

}

module.exports = function(god2, loggerName = 'timer', _mqttTopic = undefined) { 
	var self = {
        
	mqttTopic: _mqttTopic ?? loggerName,
    timerController: undefined,

    init: function() {
        god = god2
        this.logger = logger = winston.loggers.get(loggerName)
        timerController = new TimerController(_mqttTopic)
    },
}

    self.init()
    return self
}
