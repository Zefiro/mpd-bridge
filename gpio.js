const Gpio = require('onoff').Gpio;
const winston = require('winston')

 module.exports = function(god) { 
	var self = {
		
	listeners: [],
	inputs: [],
	logger: {},
	
	init: function() {
		this.logger = winston.loggers.get('gpio')
		god.terminateListeners.push(this.onTerminate.bind(this))
	},
	
	getObjForId: function(id) {
		this.inputs.forEach(b => { if (b.id == id) return b })
		return {}
	},
	
	addInput: function(id, name, fCallback) {
		this.inputs.forEach(b => { if (b.id == id) { msg = "pin" + id + " already used"
			throw msg // gpio usage error
		}})
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
	
	onTerminate: async function() {
		this.inputs.forEach(b => {
			b.obj.unexport()
			this.logger.info("GPIO: freeing '" + b.name + "' on pin " + b.id)
		})
	},
	
}
    self.init()
    return self
}
