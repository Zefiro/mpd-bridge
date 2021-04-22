const winston = require('winston')

 module.exports = function(god, app) { 
	var self = {
		
	listeners: [],
	logger: {},
	
	init: function() {
		this.logger = winston.loggers.get('web')
	},
	
	catcher: function(fn) {
		return async (req, res) => {
			try {
			return await fn(req, res)
			} catch(e) {
				self.logger.error("Catcher: %o", e)
				return "Internal Server Error"
			}
		}
	},
	
	_handleWebRequest: async function(path, req, res) {
		let sCmd = req.params.sCmd
		let oListener = self.listeners.find((value => value.path == path && (value.cmd == sCmd || (value.cmd.endsWith('*') && sCmd.startsWith(value.cmd.substr(0, value.cmd.substr.length-1))))))
		if (oListener) {
			this.logger.info("Command received: " + path + "/" + sCmd)
			let msg = await self.catcher(oListener.callback)(req, res)
			this.logger.info("Callback: " + msg)
			res.send(msg)
		} else {
			this.logger.info("Command received: " + path + "/" + sCmd + " -> unknown")
			res.send('Command unknown: ' + sCmd);
		}
	},
	
	addListener: function(path, cmd, callback) {
		if (!self._isPathKnown(path)) {
			app.get('/'+path+'/:sCmd', async (req, res) => self._handleWebRequest(path, req, res))
			this.logger.debug("web: added path " + path)
		}
		this.listeners.push({ path: path, cmd: cmd, callback: callback })
		this.logger.debug("web: added " + path + "/" + cmd)
	},
	
	_isPathKnown(path) {
		return self.listeners.some(value => value.path == path)
	},
	
	addMqttMapping: function(path, commands, topics, messages) {
		if (!Array.isArray(commands)) commands = [ commands ]
		if (!Array.isArray(messages)) messages = [ messages ]
		if (commands.length != messages.length) {
			this.logger.error("Could not add MQTT mapping for %s: parameter lengths mismatch", path)
			return
		}
		for(let i=0; i<commands.length; i++) {
			this.addListener(path, commands[i], async (req, res) => god.mqttAsyncTasmotaCommand(topics, messages[i]))
		}
	},

	addMqttMappingOnOff: function(path, topics) {
		this.addMqttMapping(path, ['on', 'off'], topics, ['ON', 'OFF'])
	},

	
}
    self.init()
    return self
}
