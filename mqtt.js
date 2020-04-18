/*
 * http://www.steves-internet-guide.com/using-node-mqtt-client/
 * https://github.com/mqttjs/async-mqtt
 *
 * Configure Tasmota with:
   Backlog mqtthost grag.fritz.box; mqttport 1883; mqttuser <username>; mqttpassword <password>; topic <device_topic>;
 */


const mqtt = require('async-mqtt')
const winston = require('winston')

 module.exports = function(god) { 
	var self = {
		
	logger: {},
	client: {},
	triggers: {},
	
	init: function() {
		this.logger = winston.loggers.get('mqtt')
		this.client = mqtt.connect("mqtt://grag.fritz.box", { clientId:"grag.js" } )
		this.publish = this.client.publish.bind(this.client)
		
		this.client.on("error", async (error) => {
			this.logger.error("Can't connect" + error)
			// TODO Steve says this only happens on auth failures and they are non-recoverable - other errors don't trigger this callback
		})
		
		this.client.on("connect", async () => {	
			this.logger.info("Connected " + this.client.connected)
			this.client.subscribe('#') // for debugging or finding new messages
		})
		
		this.client.on('message', this._onMessage.bind(this))
		god.terminateListeners.push(this.close.bind(this))
	},
	
	_onMessage: function(topic, message, packet) {
		let trigger = this.triggers[topic]
		if (trigger) {
			this.logger.info(trigger.id + ": " + message.toString())
			trigger.callback.forEach(cb => cb(trigger, topic, message, packet))
		} else {
			// unrecognized mqtt message
			this.logger.debug("unrecognized: " + topic + " -> " + message.toString().substr(0, 200))
//			console.log(packet)
		}
	},
	
	/** adds a MQTT topic trigger (replaces and returns a previously set one)
	 * topic: the MQTT topic.
	 * id: ID which will be passed to the callback (as trigger.id)
	 * callback: function(trigger, topic, message, packet)
	 */
	addTrigger: async function(topic, id, callback) {
		let prev = this.triggers[topic]
		if (prev) this.logger.warn("Overwriting trigger for topic " + topic + "(old id: " + prev.id + " / new id:" + id + ")")
		this.triggers[topic] = {
			id: id,
			callback: [ callback ]
		}
		this.logger.info("Subscribing to " + topic)
		this.client.subscribe(topic)
		// trigger a stat call, to get the initial state
//		let topic2 = topic.replace('stat', 'cmnd')
//		this.client.publish(topic2, '')
		return prev
	},
	
	removeTrigger: async function(topic) {
		this.logger.info("Unsubscribing from " + topic)
		await this.client.unsubscribe(topic)
		delete this.triggers[topic]
	},
	
	publish: {},
	
	close: async function() {
		await this.client.end()
	},
	
	
}
    self.init()
    return self
}
