/*
 * http://www.steves-internet-guide.com/using-node-mqtt-client/
 * https://github.com/mqttjs/async-mqtt
 *
 * Configure Tasmota with:
   Backlog mqtthost 10.20.30.40; mqttport 1883; mqttuser <username>; mqttpassword <password>; topic <device_topic>;
 */


const mqtt = require('async-mqtt')
const winston = require('winston')
const { v4: uuidv4 } = require('uuid')

 module.exports = function(config, god) { 
	var self = {
		
	logger: {},
	client: {},
	triggers: {},
	
	init: function() {
		this.logger = winston.loggers.get('mqtt')
		this.client = mqtt.connect(config.server, { clientId: config.clientId } )
		this.logger.info("Connecting to mqtt server %s as %s", config.server, config.clientId)
		this.publish = this.client.publish.bind(this.client)
		
		this.client.on("error", async (error) => {
			this.logger.error("Can't connect" + error)
			// TODO Steve says this only happens on auth failures and they are non-recoverable - other errors don't trigger this callback
		})

		this.client.on("connect", async () => {	
			this.logger.info("Connected " + this.client.connected)
//			this.client.subscribe('#') // for debugging or finding new messages - warning: breaks retained message handling
		})
		
		this.client.on('message', this._onMessage.bind(this))
		god.terminateListeners.push(this.onTerminate.bind(this))
	},
	
	onTerminate: async function() {
        this.logger.debug('Closing connection')
		await this.client.end()
	},
	
	_onMessage: async function(topic, message, packet) {
        let topic2 = topic
        let loop = true
        let found = false
this.logger.silly("MQTT raw packet: %o", packet)
        while(loop) {
            let trigger = this.triggers[topic2]
this.logger.silly("Known triggers for topic %s: \n%o", topic2, trigger)
            if (trigger) {
                found = true
                let keys = Object.keys(trigger)
                if (keys.length == 0) {
                    this.logger.info('Trigger found for %s, but no callbacks defined', topic2)
                } else {
                    for(let i=0; i < keys.length; i++) {
                        let t = trigger[keys[i]]
                        if (!t) {
                            this.logger.error("Known triggers for topic %s: \n%o\n%s keys: %o", topic2, trigger, keys.length, keys)
                            this.logger.error("Thinking of it, triggers are:\n%o\nwith %s keys: %o", this.triggers[topic2], Object.keys(this.triggers[topic2]).length, Object.keys(this.triggers[topic2]))
                            this.logger.error("Couldn't find trigger for keys[%s]=%s", i, keys[i])
                        } else {
                            this.logger.info(t.id + ": " + message.toString())
                            await t.callback(t, topic, message, packet)
                        }
                    }
                }
            }

            // go one level more generic
            if (topic2.indexOf('/') > 0) {
                topic2 = topic2.replace(/(^|\/)[^/#]+(\/#)?$/, '/#')
            } else {
                loop = false
            }
        }

		if (!found) {
			// unrecognized mqtt message
			this.logger.debug("unrecognized: " + topic + " -> " + message.toString().substr(0, 200))
			return
		}
	},
	
	/** adds a MQTT topic trigger
	 * topic: the MQTT topic.
	 * id: ID which will be passed to the callback (as trigger.id)
	 * callback: function(trigger, topic, message, packet)
	 * returns the trigger uuid, which can be used to remove the trigger again
	 */
	addTrigger: async function(topic, id, callback) {
        let subscribe = false
		if (!this.triggers[topic]) {
			this.triggers[topic] = {}
			this.logger.info("Subscribing to %s", topic)
            subscribe = true
        }
		let uuid = uuidv4()
		this.triggers[topic][uuid] = {
			uuid: uuid,
			id: id,
			callback: callback,
		}
		this.logger.debug("Adding trigger %s (%s) to subscription for %s", id, uuid, topic)
        if (subscribe) {
			await this.client.subscribe(topic)
		}
		return uuid
	},
	
	removeTrigger: async function(topic, uuid) {
		if (!this.triggers[topic]) {
			this.logger.warn("Trying to remove trigger %s, but no active subscription for topic %s", uuid, topic)
			return
		}
		if (!this.triggers[topic][uuid]) {
			this.logger.warn("Trying to remove trigger %s for %s, but trigger not found", uuid, topic)
			return
		}
		this.logger.debug("Removing trigger '%s' (%s) from subscription for %s", this.triggers[topic][uuid].id, uuid, topic)
		delete this.triggers[topic][uuid]
		if (!Object.keys(this.triggers[topic]).length) {
			this.logger.info("Unsubscribing from " + topic)
			await this.client.unsubscribe(topic)
			delete this.triggers[topic]
		}
	},
	
	publish: async(topic) => { // gets overwritten with this.client.publish(topic, message) in init()
		this.logger.error("Trying to publish to topic %s before mqtt was initialized", topic)
	},
	
}
    self.init()
    return self
}
