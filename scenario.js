/*
 Reacts on MQTT messages, taking state into account, then reacts with mqtt messages (one of them being scenarion information)
 
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
   

*/
const winston = require('winston')

 module.exports = function(god, loggerName = 'scenario') { 
	var self = {
		
	logger: {},
	mqttTopic: 'scenario',
	
	init: async function() {
		this.logger = winston.loggers.get(loggerName)
		god.mqtt.addTrigger('cmnd/' + this.mqttTopic, 'cmnd-scenario', this.onMqttCmnd.bind(this))
	},
	
	onMqttCmnd: async function(trigger, topic, message, packet) {
		this.logger.debug("mqtt: %s (%s)", topic, message)
		this.activateScenario(message)
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
		let idx = 0
		while (idx < commands.length) {
			cmd = commands[idx]
			if (!(cmd instanceof Object)) cmd = { "action": "mqtt", "combined": cmd }
			switch(cmd.action) {
				case "mqtt": {
					let match = cmd.combined.match(/([^ ]+) +(.+)/)
					if (!match) {
						this.logger.error("mqtt cmd contains no space, confusing: %s", cmd.combined)
						return
					}
					let topic = match[1]
					let message = match[2]
					await god.mqttAsyncTasmotaCommand(topic, message)
				} break
				case "include": {
					let name = cmd.scenario
					let scenario = god.config.scenarios[name]
					if (!scenario) {
						this.logger.error('Scenario for inclusion "%s" unknown', name)
						return
					}
					this.logger.info("Including commands of scenario %s (%s)", scenario.name, name)
					await runCommands(scenario.commands)
				} break
			}
			idx++
		}
	}

}
    self.init()
    return self
}
