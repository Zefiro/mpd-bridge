/*
 * https://github.com/delian/node-unifiapi
 * https://ubntwiki.com/products/software/unifi-controller/api
 *
 */

const unifi = require('node-unifiapi');
const winston = require('winston')

 module.exports = function(god, loggerName = 'ubnt') { 
	var self = {
		
	controller: {},
		
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		this.logger.info("Connecting to Unifi controller on " + god.config.ubnt.controllerUrl)
		this.controller = unifi({
			baseUrl: god.config.ubnt.controllerUrl,
			username: god.config.ubnt.user,
			password: god.config.ubnt.passwd,
			// debug: true, // More debug of the API (uses the debug module)
			// debugNet: true // Debug of the network requests (uses request module)
		})
		this.controller.list_clients()
			.then(done => {
//				this.logger.warn('Success %o',done)
				done.data.forEach(client => {
					let l = Math.trunc(Date.now() / 1000) - client.last_seen
					let line = client.hostname + " (last seen " + l + " sec ago)"
					this.logger.debug(line)
				})
			})
			.catch(err => this.logger.error('Error %o',err))
	},
	
	
}
    self.init()
    return self
}
