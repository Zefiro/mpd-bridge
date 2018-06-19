
 module.exports = function(app) { 
	var self = {
		
	listeners: [],
	
	init: function() {
	},
	
	_handleWebRequest: async function(path, req, res) {
		var sCmd = req.params.sCmd
		console.log("Command received: " + path + "/" + sCmd)
		var oListener = self.listeners.find((value => value.path == path && value.cmd == sCmd))
		if (oListener) {
			var msg = await oListener.callback(req, res)
			console.log(msg)
			res.send(msg)
		} else {
			res.send('Command unknown: ' + sCmd);
		}
	},
	
	addListener: function(path, cmd, callback) {
		if (!self._isPathKnown(path)) {
			app.get('/'+path+'/:sCmd', async (req, res) => self._handleWebRequest(path, req, res))
//			console.log("web: added path " + path)
		}
		this.listeners.push({ path: path, cmd: cmd, callback: callback })
//		console.log("web: added " + path + "/" + cmd)
	},
	
	_isPathKnown(path) {
		return self.listeners.some(value => value.path == path)
	},
	
}
    self.init()
    return self
}
