// Special support for Tasmota devices

const winston = require('winston')

module.exports = function(god, loggerName = 'Tasmota') { 
	var self = {
		
	expectedMqttConfigAnswers: {}, // TODO old
	currentDeviceConfig: {}, // maps mqtt-devicename to object{ option: { "currentValue": read-value, "expectedValue": config-value, "comment": tbd } 
	mismatchingMqttConfigAnswers: {}, // TODO old
	checkConfigAllDevices: false, // TODO old
	correctConfigSettings: false, // TODO old
    mqttTriggerId: null,
		
	init: function() {
		this.logger = winston.loggers.get(loggerName)
        // TODO old
		this.checkConfigAllDevices && this.correctConfigSettings && this.logger.error("Correcting of config settings for all devices is activated. Disable this for daily use.")
		this.checkConfigAllDevices && process.nextTick(this.verifyAllDeviceConfig.bind(this))
        this.populateAllDeviceConfig()
        god.ioOnConnected.push(this.onIoConnected.bind(this))
	},
	
	onIoConnected: async function(socket) {
		socket.on('tasmotaConfigTriggerUpdate', async (data) => {
            this.logger.debug("Received tasmotaConfigTriggerUpdate %o", data)
            if (data) {
                await this.triggerReadDeviceConfig(data)
            } else {
                await this.triggerReadAllDeviceConfig()
            }
		})
		socket.on('tasmotaConfigSaveChanges', async (data) => {
            this.logger.info("Received tasmotaConfigSaveChanges %o", data)
            let deviceNames = Object.keys(data)
            for(i = 0; i < deviceNames.length; i++) {
                let deviceName = deviceNames[i]
                await this.updateDeviceConfig(deviceName, data[deviceName])
            }
		})
	},
    
    updateDeviceConfig: async function(deviceName, options) {
        let optionNames = Object.keys(options)
        this.logger.info('Updating config of ' + deviceName + ' (' + optionNames.length + ' changes)')
        for(i = 0; i < optionNames.length; i++) {
            let optionName = optionNames[i]
            let value = options[optionName]
            console.log('Updating option ' + deviceName + '/' + optionName + ' to ' + value)
            await god.mqtt.publish('cmnd/' + deviceName + '/' + optionName, value)
        }
    },

	// TODO old
    verifyAllDeviceConfig: async function() {
		let devices = this.getKnownDevices()
		let setConfig = (name, mismatches) => this.correctConfigSettings && this.setDeviceConfig(name, Object.keys(mismatches))
		for(let i=0; i<devices.length; i++) {
			await this.verifyDeviceConfig(devices[i], setConfig)
		}
	},
	
	setDeviceConfig: async function(name, cfgkeys) {
		let tasmotaConfig = this.mergeTasmotaConfig(name)
		await Promise.all(cfgkeys.map(async key => {
			let value = tasmotaConfig[key]
			if (!value) {
				this.logger.error("Trying to set device config for %s/%s, but new value is empty", name, key)
				return
			}
			this.logger.warn("Setting %s/%s %s", name, key, value)
			await god.mqtt.publish('cmnd/' + name + '/' + key, value)
		}))
	},

	populateAllDeviceConfig: async function() {
		let devices = this.getKnownDevices()
		for(let i=0; i<devices.length; i++) {
			await this.populateDeviceConfig(devices[i])
		}
    },
    
	populateDeviceConfig: async function(name) {
		let cfg = this.mergeTasmotaConfig(name)
		let c = {}
		Object.keys(cfg).forEach(key => { c[key] = { 'currentValue': null, 'expectedValue': cfg[key] }})
		this.currentDeviceConfig[name] = c
	},
	
	triggerReadAllDeviceConfig: async function() {
		let devices = this.getKnownDevices()
		for(let i=0; i<devices.length; i++) {
			await this.triggerReadDeviceConfig(devices[i])
		}
        god.whiteboard.getCallbacks('tasmotaConfigUpdated').forEach(cb => cb(this.currentDeviceConfig))
    },
    
	triggerReadDeviceConfig: async function(name) {
        if (!this.mqttTriggerId) {
            this.mqttTriggerId = await god.mqtt.addTrigger('stat/#', '', this.parseDeviceConfigMessage.bind(this))
            this.logger.debug('Added trigger for stat/#: %s', this.mqttTriggerId)
        }
        let now = new Date()
        // for all values the config knows about...
		await Promise.all(Object.keys(this.currentDeviceConfig[name]).map(async key => {
			this.logger.debug("Querying %s / %s (expected: %o)", name, key, this.currentDeviceConfig[name][key]['expectedValue'])
            // clear previously retrieved values
            this.currentDeviceConfig[name][key]['currentValue'] = null
            // trigger getting new values
			this.currentDeviceConfig[name][key]['pending_since'] = now
			await god.mqtt.publish('cmnd/' + name + '/' + key, '')
		}))
	},
	
    // incoming MQTT /stat/#/RESULT message
	parseDeviceConfigMessage: async function(trigger, topic, message, packet) {
        this.logger.debug("%s: %s", topic, message)
        
        // check if this device is known to our config
        let re = new RegExp('^stat/([^/]+)/RESULT$')
        let reResult = topic.match(re)
        if (!reResult) {
            this.logger.warn("Could not parse topic: %s", topic)
            return
        }
        let deviceName = reResult[1]
        this.logger.debug("Got stat for device %s", deviceName)
        let config = this.currentDeviceConfig[deviceName]
        
        if (!config) {
            this.logger.warn("Device %s is not yet known in our config", topic)
            return
        }
        
        // parse message
        let msg = JSON.parse(message)
        let msgKeys = Object.keys(msg)
        if (msgKeys.length == 0) {
            this.logger.error("Unexpected MQTT result: no arguments for %s", topic)
            return
        }
        if (msgKeys.length > 1 && msgKeys[0].match(/^Rule[0-9]+$/)) {
            this.logger.error("Unimplemented MQTT result - rule checking currently not supported")
            return
        }
        if (msgKeys.length > 1) {
            this.logger.error("Unimplemented MQTT result: more than one argument for %s: %o", topic, msgKeys)
            return
        }
        let msgKey = msgKeys[0]
        
		let actualValue = msg[msgKey]
        this.logger.debug("Got stat for option %s/%s = %o (expected: %o)", deviceName, msgKey, actualValue, (config[msgKey] ? config[msgKey].expectedValue : 'unknown'))

        // check if this option is known in our config
        if (config[msgKey] == null) {
            let match = Object.keys(config).filter(key => key.toLowerCase() == msgKey.toLowerCase())
            if (match.length == 1) {
                this.logger.warn("MQTT result %s: key differs in case, expected '%s', actual '%s'", deviceName, match[0], msgKey)
                msgKey = match[0]
            } else if (match.length > 1) {
                this.logger.error("Internal error for %s: ambigous cases found for key '%s' in config", deviceName, msgKey)
                return
            } else if (this.checkIgnoreUnsolicitedMqtt(msgKey, message)) {
                // TODO perhaps don't ignore anymore
                return
            } else {
                this.logger.warn("Unexpected MQTT result for %s: key '%s' not known to our config (%s)", deviceName, msgKey, message)
                return
            }
        }
        config[msgKey].currentValue = actualValue
        partialConfig = {}
        partialConfig[deviceName] = {}
        partialConfig[deviceName][msgKey] = config[msgKey]
        god.whiteboard.getCallbacks('tasmotaConfigUpdated').forEach(cb => cb(partialConfig))
    },
	
    // TODO old
	verifyDeviceConfig: async function(name, callback) {
		let result = {}
		let tasmotaConfig = this.mergeTasmotaConfig(name)
		this.logger.info("Config for %s is %o", name, tasmotaConfig)
		this.expectedMqttConfigAnswers[name] = { ...tasmotaConfig }
		
		// special handling of Timers
		Object.keys(this.expectedMqttConfigAnswers[name]).filter(key => key.match(/^Timer[0-9]+$/) != null).forEach(key => {
			// it's "Arm" in the old version, but "Enable" in the new version
			this.expectedMqttConfigAnswers[name][key] = this.expectedMqttConfigAnswers[name][key].replace('Arm', 'Enable')
			// JSON insists on ", but that's awkward to write in the config, so accept ' as well
			this.expectedMqttConfigAnswers[name][key] = JSON.parse(this.expectedMqttConfigAnswers[name][key].replace(/'/g, '"'))
		})
		
		// TODO special handling of rules
		Object.keys(this.expectedMqttConfigAnswers[name]).filter(key => key.match(/^Rule[0-9]+$/) != null).forEach(key => {
			// TODO
		})
		
		this.mismatchingMqttConfigAnswers[name] = {}

		let triggerId = await god.mqtt.addTrigger('stat/' + name + '/RESULT', '', async (trigger, topic, message, packet) => {
			this.logger.debug("%s: %s", topic, message)
			let msg = JSON.parse(message)
			let msgKeys = Object.keys(msg)
			if (msgKeys.length == 0) {
				this.logger.error("Unexpected MQTT result: no arguments for %s", topic)
				return
			}
			if (msgKeys.length > 1 && msgKeys[0].match(/^Rule[0-9]+$/)) {
				this.logger.error("Unimplemented MQTT result - rule checking currently not supported")
				return
			}
			if (msgKeys.length > 1) {
				this.logger.error("Unimplemented MQTT result: more than one argument for %s: %o", topic, msgKeys)
				return
			}
			let msgKey = msgKeys[0]
			let expectedValue = this.expectedMqttConfigAnswers[name][msgKey]
			let actualValue = msg[msgKey]
			if (expectedValue == null) {
				let match = Object.keys(this.expectedMqttConfigAnswers[name]).filter(key => key.toLowerCase() == msgKey.toLowerCase())
				if (match.length == 1) {
					this.logger.warn("MQTT result %s: key differs in case, expected '%s', actual '%s'", topic, match[0], msgKey)
					msgKey = match[0]
					expectedValue = this.expectedMqttConfigAnswers[name][msgKey]
				} else if (match.length > 1) {
					this.logger.error("Internal error for %s: ambigous cases found for key '%s'", topic, msgKey)
					return
				} else if (this.checkIgnoreUnsolicitedMqtt(msgKey, message)) {
					return
				} else {
					this.logger.warn("Unexpected MQTT result for %s: key '%s' unknown (%s)", topic, msgKey, message)
					return
				}
			}
			
			if (expectedValue != actualValue && JSON.stringify(expectedValue) !== JSON.stringify(actualValue)) {
				this.logger.warn("Value mismatch %s: %o expected %o but actually %o", topic, msgKey, expectedValue, actualValue)
				this.mismatchingMqttConfigAnswers[name][msgKey] = actualValue
			} else {
				this.logger.debug("Value matches %s: %o = %o", topic, msgKey, actualValue)
			}
			
			delete this.expectedMqttConfigAnswers[name][msgKey]
			if (Object.keys(this.expectedMqttConfigAnswers[name]).length == 0) {
				await god.mqtt.removeTrigger('stat/' + name + '/RESULT', triggerId)
				let l = Object.keys(this.mismatchingMqttConfigAnswers[name])
				if (l.length == 0) {
					this.logger.info("All Values checked for %s (all fine)", name)
				} else {
					this.logger.info("All Values checked for %s, found %s differences: %s", name, l.length, l)
				}
				callback && callback(name, this.mismatchingMqttConfigAnswers[name])
			}
		})
		
		await Promise.all(Object.keys(tasmotaConfig).map(async key => {
			this.logger.debug("Querying %s / %s", name, key)
			result[key] = { pending: true }
			await god.mqtt.publish('cmnd/' + name + '/' + key, '')
		}))
	},
	
	getKnownDevices: function() {
		return Object.keys(god.config.tasmota_config).filter(name => name != "*")
	},
	
	// reads Tasmota config from config.json, merging specific values for $name with default values (name="*") and returning an object by splitting the config on the first space
	// TODO rename
	mergeTasmotaConfig: function(name) {
		let cfg = {}
		god.config.tasmota_config['*'].concat(god.config.tasmota_config[name]).map(line => line.trim()).filter(line => line).forEach(line => { 
            let i = line.indexOf(' ')
            if (i > 0) {
                cfg[line.substring(0, i)] = line.substring(i).trim()
            } else {
                cfg[line] = ""
            }
        })
		return cfg
	},
	
	/** Returns true if this STAT message may appear without asking for it and can safely be ignored */
    // TODO old
	checkIgnoreUnsolicitedMqtt: function(key, message) {
		return ['POWER', 'POWER1', 'POWER2', 'Timers1', 'Timers2', 'Timers3', 'Timers4'].includes(key)
	}
	
}
    self.init()
    return self
}
