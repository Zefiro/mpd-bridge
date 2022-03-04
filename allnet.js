const winston = require('winston')

// Warning: async loading
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

 module.exports = function(god, loggerName = 'allnet') { 
	var self = {
		
	devices: [],
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.terminateListeners.push(this.onTerminate.bind(this))
	},
	
	onTerminate: async function() {
	},
	
	getDeviceForIp: function(ip) {
		let device = null
		this.devices.forEach(b => { if (b.ip === ip) device = b; })
		return device
	},
	
	getDeviceForName: function(name) {
		let device = null
		this.devices.forEach(b => { if (b.name === name) device = b; })
		return device
	},
	
	addDevice: function(ip, name, fCallback) {
		if (this.getDeviceForIp(ip) != null) throw "IP " + ip + " already assigned"
		if (this.getDeviceForName(name) != null) throw "Name " + name + " already assigned"
		let b = {
			'name': name,
			'ip': ip,
			'callback': fCallback, // TODO we don't have a trigger condition, remove?
		}
		this.logger.debug('Adding device ' + name + ' with IP ' + ip)
		this.devices.push(b)
	},
	
	setState: async function(name, value) {
		iValue = value && value == 'on' ? '1' : '0'
		tValue = iValue ? 'on' : 'off'
		let device = this.getDeviceForName(name)
		if (device == null) {
			this.logger.error("setState: no device known with name " + name)
			return
		}
		this.logger.info('Setting ' + name + ' to ' + tValue)
		let res = await fetch('http://' + device.ip + '/r?r=0&s=' + iValue)
		// TODO check if res.status == 200
		let resText = await res.text()
		let match = resText.match(/<A HREF="[^"]+">(ON|OFF)<\/A>/)
		// TODO check if match && match.length == 2
		tValue = match[1] == 'ON' ? 'on' : 'off'
		if (device.callback) device.callback(name, tValue)
		return tValue
	},

	getState: async function(name) {
		let device = this.getDeviceForName(name)
		if (this.getDeviceForName(name) == null) {
			this.logger.error("getState: no device known with name " + name)
			return
		}
		this.logger.debug('Getting status from ' + name)
		let res = await fetch('http://' + device.ip + '/xml')
		// TODO check if res.status == 200
		let resText = await res.text()
		let match = resText.match(/<t0>([0-1])<\/t0>/)
		// TODO check if match && match.length == 2
		let value = match[1]
		let tValue = value == '1' ? 'on' : 'off'
		this.logger.debug('Status of ' + name + ' is ' + tValue)
		if (device.callback) device.callback(name, tValue)
		return tValue
	},
	
}
    self.init()
    return self
}
