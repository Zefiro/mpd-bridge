const winston = require('winston')
var ping = require ("ping")
const dns = require('dns')
const {promisify} = require('util')

 module.exports = function(god, loggerName = 'net') { 
var self = {
        
    network: {},
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.terminateListeners.push(this.onTerminate.bind(this))
	},
	
	onTerminate: async function() {
	},
    
    getHostEntryByIP: function(ip) {
        if (!this.network[ip]) {
            this.network[ip] = {
                ip: ip,
                ping_result: false,
            }
        }
        return this.network[ip]
    },
    
    pingIP: function(ip) {
        let hostEntry = this.getHostEntryByIP(ip)
        hostEntry.ping_running = true
        ping.sys.probe(ip, function(isAlive){
                var msg = isAlive ? 'host ' + ip + ' is alive' : 'host ' + ip + ' is dead'
                this.logger.debug(msg)
                hostEntry.ping_running = false
                hostEntry.ping_result = isAlive
                this.getRDNS(ip)

                partialConfig = {}
                partialConfig[ip] = hostEntry
                god.whiteboard.getCallbacks('networkInfoUpdated').forEach(cb => cb(partialConfig))
            }.bind(this))
    },
    
    getRDNS: function(ip) {
        let hostEntry = this.getHostEntryByIP(ip)
        if (hostEntry.dns) {
            return hostEntry.dns
        }
        hostEntry.dns = '<pending>';
        (async () => {
            try {
                let rdns = await promisify(dns.reverse)(ip)
                this.logger.info(ip + " resolves to " + rdns)
                hostEntry.dns = rdns
            } catch(err) {
                this.logger.warn("Can't resolve DNS for " + ip + ": " + err)
            }
            partialConfig = {}
            partialConfig[ip] = hostEntry
            god.whiteboard.getCallbacks('networkInfoUpdated').forEach(cb => cb(partialConfig))
        }).bind(this)()
        return ip
    },
    
    pingBroadcast: function() {
        for(i = 1; i < 255; i++) {
            let ip = '10.20.30.' + i
            this.pingIP(ip)
        }
    },
	
}
    self.init()
//    setTimeout(() => self.pingBroadcast(), 1000)
    return self
}
