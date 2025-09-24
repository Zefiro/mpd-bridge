// shows various texts on a usb-serial Point-of-Sale 2x20 display
//
// POS has 2 lines with 20 chars each. Wraps around on end of line. Supports backspace and newline. \f clears screen (flickering) and ensures the cursor is at home
//
// lsusb
//   Bus 001 Device 006: ID 0416:f012 Winbond Electronics Corp.
// modprobe usbserial vendor=0x0416 product=0xf012
// -> /dev/ttyACM0

//const chokidar = require('chokidar')
const winston = require('winston')
const fs = require('fs')
const fsa = fs.promises
const moment = require('moment')


module.exports = function(god, loggerName = 'POS', _mqttTopic = undefined) {
	var self = {
		
	watcher: null,
	posAvailable: false,
	mqttTopic: _mqttTopic ?? loggerName + '/',
    timeout: null,
    lastMqttMessage: null,
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.preterminateListeners.push(this.onPreTerminate.bind(this))
		god.terminateListeners.push(this.onTerminate.bind(this))
//		this.watcher = chokidar.watch(god.config.POS.tty, { persistent: true })
//		this.watcher.on('add', async path => this.onPOSready.bind(this))
//		this.watcher.on('unlink', async path => this.onPOSremoved.bind(this))
//		this.watcher.on('all', async path => this.logger.debug("Chokidar event: %o", arguments ))
		if (true || fs.existsSync(god.config.POS.tty)) { this.onPOSready() } else { this.logger.warn("POS is not available") }
        this.writeToPOS("Waiting for Grag")
		god.mqtt && god.mqtt.addTrigger(this.mqttTopic + 'text', 'pos-receiver', this.onMqttReceived.bind(this))
	},
    
    onMqttReceived: async function(trigger, topic, message, packet) {
        let cmd = message
        this.writeToPOS(cmd)
        clearTimeout(this.timeout)
        this.lastMqttMessage = moment()
        if (god.config.POS?.timeout) {
            this.timeout = setTimeout((() => {
                this.writeToPOS("Waiting for Grag...\n" + this.lastMqttMessage.fromNow())
            }).bind(this), god.config.POS.timeout * 1000)
        }
    },
	
	onPreTerminate: async function() {
        await this.writeToPOS('-- Offline --')
        // TODO send mqtt unavailable, retained
	},

	onTerminate: async function() {
		this.watcher && await this.watcher.close()
	},

	onPOSready: async function() {
		this.logger.info("POS is available")
		this.posAvailable = true
		// TODO send mqtt available, retained
        // TODO how to set a will?
	},

	onPOSremoved: async function() {
		this.logger.info("POS has been removed");
		this.posAvailable = false
        // TODO send mqtt unavailable, retained
	},

	
	writeToPOS: async function (content) {
		this.posAvailable = fs.existsSync(god.config.POS.tty)
		let cmd = this.sanitizeLines(content, 2, 20, '\f')
		if (!this.posAvailable) {
			this.logger.debug("Not writing to POS, as it's not available: '" + cmd + "'")
			return
		}
		this.logger.debug("Writing: '" + this.encode(cmd) + "'")
		let filehandle
		try {
			filehandle = await fsa.open(god.config.POS.tty, 'w');
			await filehandle.writeFile(cmd) 
		} catch (e) {
			this.logger.error("can't write to serial console: %o", e);
		} finally {
			filehandle && await filehandle.close()
		}
	},

	sanitizeLines: function(text, lines, columns, prefix = '', newline = '', suffix = '') {
		let cmd = '\f'
		let spaces = '                                                            '
		if (text != '') {
			let lines = (text+'\n\n').split(/\r?\n/)
			// TODO if the last char is unicode, two ascii chars are transmitted - and this switches the line in POS display :(
			cmd = prefix + (lines[0] + spaces).substring(0, columns) + newline + (lines[1] + spaces).substring(0, columns) + suffix
		}	
		return cmd
	},
	
	/** Encodes newlines for display in log files */
	encode: function(text) {
		return text.replace(/\n/, '\\n')
	},

}
    self.init()
    return self
}
