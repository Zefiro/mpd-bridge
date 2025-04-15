/*
 Reacts on MQTT messages, taking state into account, then reacts with mqtt messages (one of them being scenario information)
 
 Ideas:
 
 on stat/mpd/status=play AND main-onkyo-power != 'ON' do 'onkyo/set/system-power' 'on'
 
 on cmnd/grag/scenario=sleep do
   all lights off (except hoard)
   main strip off (or dimmed?)
   mpd off, onkyo off
   // POS off
   zapper on

 on cmnd/grag/scenario=day do
   main strip on
   POS on
   zapper off
   main blinds up

 on cmnd/grag/scenario=away do
   include scenario 'sleep'
   hoard light off
   mpd2 off

   ----------------------------------------
   Configuration in main config file, section 'scenarios'
   key = scenario name
   trigger = optional, tbd
   value = name (string)
           commands (array)
   
   a command is either a string (shorthand for action=mqtt-tasmota) or an object with
   action = mqtt
     combined = full mqtt topic + space + message (same as in config file)
   action = mqtt-tasmota (default if string form is used)
     combined = similar to normal combined mqtt action, but uses mqttAsyncTasmotaCommand(), i.e. cmnd/ is automatically prepended to the topic
   action = include
     scenario = name of scenario to include (at this point in the command list)
   action = delay
     time = delay time in seconds
     next = command to execute (string or object)
   action = thingScenario
     id = thing scenario id

*/
const winston = require('winston')

 module.exports = function(god, loggerName = 'scenario') { 
	var self = {
		
	logger: {},
	mqttTopic: 'scenario',
    lastThingStatus: {},
	
	init: async function() {
		this.logger = winston.loggers.get(loggerName)
		god.mqtt.addTrigger('cmnd/' + this.mqttTopic, 'cmnd-scenario', this.onMqttCmnd.bind(this))
        god.onThingChanged.push(this.onThingChanged.bind(this))
        if (!god.config.scenarios) god.config.scenarios = { "": {} }
        Object.keys(god.config.scenarios).forEach(key => this.initTriggers(key, god.config.scenarios[key]))
	},
    
    initTriggers: function(key, scenario) {
        if (!scenario.trigger) return
        if (scenario.trigger.mqtt) {
            this.logger.info("Adding trigger for scenario %s (%s): %s=%s", scenario.name, key, scenario.trigger.mqtt, scenario.trigger.value)
            god.mqtt.addTrigger(scenario.trigger.mqtt, key, this.onMqttCmnd.bind(this))
        } else if (scenario.trigger.thingId) {
            // generic onThingChange handler already set in init()
        } else {
            return // only mqtt and thing based triggers supported currently
        }
    },
    
    onThingChanged: async function(thing) {
        let triggeredScenarios = Object.values(god.config.scenarios).filter(scenario => scenario?.trigger?.thingId == thing.id)
        for (const scenario of triggeredScenarios) {
            // TODO perhaps use https://jsonpath-plus.github.io/JSONPath/docs/ts/
console.log(thing.json)
            let value
            if (!scenario.trigger.field) {
                value = thing?.json?.value
            } else if (!scenario.trigger.field.includes(".")) {
                value = thing?.json?.value[scenario.trigger.field]
            } else if (scenario.trigger.field == 'status.state') { 
                value = thing?.json?.value?.status?.state
            } else {
                this.logger.error("Field specification currently not supported: %s", scenario.trigger.field); 
                return 
            }
console.log(value)
console.log(scenario.trigger.value)
            if (this.lastThingStatus[thing.id] && this.lastThingStatus[thing.id] == value) { this.logger.debug("Thing %s status '%s' is unchanged: '%s'", thing.id, scenario.trigger.field, value); return }
            this.lastThingStatus[thing.id] = value
            if (value == scenario.trigger.value) {
                this.logger.info("Scenario '%s' triggered", scenario.name)
                await this.runCommands(scenario.commands)
            } else {
                this.logger.debug("Thing %s status '%s' is changed to '%s', but only triggering on '%s'", thing.id, scenario.trigger.field, value, scenario.trigger.value);
            }
        }
    },
    
	onMqttCmnd: async function(trigger, topic, message, packet) {
		this.logger.debug("mqtt: %s (%s)", topic, message)
        let scenarioId = trigger.id
        if (scenarioId == 'cmnd-scenario') { // not a trigger, but a direct command
            await this.activateScenario(message)
        } else {
            let scenario = god.config.scenarios[scenarioId]
            if (!scenario || !scenario.trigger || !scenario.trigger.mqtt) {
                this.logger.debug("Received %s, but trigger.id=%s is not a valid scenario", topic, scenarioId)
                return
            }
            if (scenario.trigger.mqtt != topic) {
                this.logger.debug("Received %s, but trigger.id=%s mqtt=% does not match topic", topic, scenarioId, scenario.trigger.mqtt)
                return
            }
            let value = scenario.trigger.value
            if (value != message) {
                this.logger.debug("Received %s, ignored because value=%s is not triggering value=%s", topic, message, value)
                return
            }
            let currentThingScenario = god.thingController?.getCurrentScenario()?.id ?? ''
            if ([...(scenario?.trigger?.excludedThingScenarios ?? [])].includes(currentThingScenario)) {
                this.logger.debug("Received %s, ignored because current scenario '%s' is excluded from trigger", topic, currentThingScenario)
                return
            }
            this.logger.info("Scenario %s (%s) triggered by %s=%s", scenario.name, scenarioId, topic, value)
            await this.runCommands(scenario.commands)
        }
	},

	activateScenario: async function(name) {
		let scenario = god.config.scenarios[name]
		if (!scenario) {
			this.logger.error('Scenario %s unknown', name)
			return
		}
		this.logger.info("Scenario %s (%s) activated", scenario.name, name)
		await this.runCommands(scenario.commands)
	},
	
	runCommands: async function(commands) {
        if (!Array.isArray(commands)) commands = [ commands ]
		let idx = 0
		while (idx < commands.length) {
			cmd = commands[idx]
			if (!(cmd instanceof Object)) cmd = { "action": "mqtt-tasmota", "combined": cmd }
			switch(cmd.action) {
				case "mqtt-tasmota": {
					if (!cmd.combined) {
						this.logger.error("mqtt-tasmota cmd is missing combined argument: %o", cmd)
						return
					}
					let match = cmd.combined.match(/([^ ]+) +(.+)/)
					if (!match) {
						this.logger.error("mqtt-tasmota cmd contains no space, confusing: %s", cmd.combined)
						return
					}
					let topic = match[1]
					let message = match[2]
					await god.mqttAsyncTasmotaCommand(topic, message)
				} break
				case "mqtt": {
					let match = cmd.combined.match(/([^ ]+) +(.+)/)
					if (!match) {
						this.logger.error("mqtt cmd contains no space, confusing: %s", cmd.combined)
						return
					}
					let topic = match[1]
					let message = match[2]
					await god.mqtt.publish(topic, message)
				} break
				case "include": {
					let name = cmd.scenario
					let scenario = god.config.scenarios[name]
					if (!scenario) {
						this.logger.error('Scenario for inclusion "%s" unknown', name)
						return
					}
					this.logger.info("Including commands of scenario %s (%s)", scenario.name, name)
					await this.runCommands(scenario.commands)
				} break
				case "delay": {
					let delay = cmd.time
					this.logger.info("Delaying execution of command for %s seconds: %o", delay, cmd)
                    // create function to put cmd into closure
                    let cb = (delay2, cmd2) =>
                        setTimeout((async () => {
                            this.logger.info("Running delayed command %o", cmd2.next)
                            await this.runCommands(cmd2.next)
                        }).bind(this), delay2 * 1000)
                    cb.bind(this)
                    cb(delay, cmd)
				} break
                case "thing": {
                    this.logger.info("Scenario triggered action '%s' on thing %s", cmd.thingAction, cmd.thingId)
                    god.thingController.onAction(cmd.thingId, cmd.thingAction)
                } break
                case "thingScenario": {
                    // set scenario via mqtt instead of directly (using god.thingController.setCurrentScenario) so that we can use the retain feature
                    await god.mqtt.publish(god.thingController.mqttTopic, cmd.id, {retain: true})
                } break
			}
			idx++
		}
	}

}
    self.init()
    return self
}
