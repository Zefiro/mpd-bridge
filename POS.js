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


 module.exports = function(god, loggerName = 'POS') { 
	var self = {
		
	controller: {},
	watcher: null,
	posAvailable: false,
	
	init: function() {
		this.logger = winston.loggers.get(loggerName)
		god.terminateListeners.push(this.onTerminate.bind(this))
		this.controller = require('./DisplayControl')(god, loggerName)
		this.controller.fnUpdate = this.writeToPOS.bind(this)
//		this.watcher = chokidar.watch(god.config.POS.tty, { persistent: true })
//		this.watcher.on('add', async path => this.onPOSready.bind(this))
//		this.watcher.on('unlink', async path => this.onPOSremoved.bind(this))
//		this.watcher.on('all', async path => this.logger.debug("Chokidar event: %o", arguments ))
		if (true || fs.existsSync(god.config.POS.tty)) { this.onPOSready() } else { this.logger.warn("POS is not available") }
	},
	
	onTerminate: async function() {
		this.watcher && await this.watcher.close()
	},

	onPOSready: async function() {
		this.logger.info("POS is available")
		this.posAvailable = true
		this.controller.enable()
/* TODO move to main - or don't?
		await mqtt.addTrigger('grag/pos', 'pos', async (trigger, topic, message, packet) => { 
			let cmd = message
			fnWriteToPOS(cmd)
		})
*/
	},

	onPOSremoved: async function() {
		this.logger.info("POS has been removed");
		this.posAvailable = false
		this.controller.disable()
//		await mqtt.removeTrigger('grag/pos')
	},

	
	writeToPOS: async function (content) {
		this.posAvailable = fs.existsSync(god.config.POS.tty)
		let cmd = this.controller.sanitizeLines(content, 2, 20, '\f')
		if (!this.posAvailable) {
			this.logger.debug("Not writing to POS, as it's not available: '" + cmd + "'")
			return
		}
		this.logger.debug("Writing: '" + this.controller.encode(cmd) + "'")
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
	
	addEntry: function(id, content) {
		this.controller.addEntry(id, content)
	}
	
}
    self.init()
    return self
}
