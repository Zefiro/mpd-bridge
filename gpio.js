const Gpio = require('onoff').Gpio;
const winston = require('winston')

 module.exports = function(god, loggerName = 'gpio') { 
	var self = {
		
	listeners: [],
	inputs: [],
	logger: {},
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.terminateListeners.push(this.onTerminate.bind(this))
	},
	
	onTerminate: async function() {
		this.inputs.forEach(b => {
			try {
				this.logger.info("GPIO: freeing '" + b.name + "' on pin " + b.id)
				b.obj.unexport()
			} catch (e) {
				this.logger.error("Exception during freeing of GPIO pin: %o", e)
			}
		})
	},
	
	getObjForId: function(id) {
		let obj = null
		this.inputs.forEach(b => { if (b.id === id) obj = b; })
		return obj
	},
	
	addInput: function(id, name, fCallback) {
		if (this.getObjForId(id) != null) {
			throw "pin" + id + " already used" // gpio usage error
		}
		let obj = new Gpio(id, 'in', 'both')
		let b = {
			'name': name,
			'id': id,
			'obj': obj,
			'callback': fCallback,
		}		
		this.inputs.push(b)
		obj.watch((err, value) => this.onInputChange(id, err, value))
	},
	
	onInputChange: function(id, err, value) {
		if (err) {
			this.logger.error("GPIO " + id + " Error: " + err)
			throw err
		}
		let obj = this.getObjForId(id)
		this.logger.info("GPIO '" + obj.name + "' changed to " + value)
		this.inputs.forEach(b => { if (b.id == id) b.callback(value) })
	},
	
}
    self.init()
    return self
}
