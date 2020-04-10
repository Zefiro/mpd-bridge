const winston = require('winston')

 module.exports = function(god, app) { 
	var self = {
		
	listeners: [],
	logger: {},
	
	init: function() {
		this.logger = winston.loggers.get('web')
	},
	
	_handleWebRequest: async function(path, req, res) {
		let sCmd = req.params.sCmd
		let oListener = self.listeners.find((value => value.path == path && (value.cmd == sCmd || value.cmd == '*')))
		if (oListener) {
			this.logger.info("Command received: " + path + "/" + sCmd)
			let msg = await oListener.callback(req, res)
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
	
}
    self.init()
    return self
}
