/* Connects to ZWave2MQTT on topic zwave/#
 */

const winston = require('winston')

module.exports = function(god, loggerName = 'zwave') { 
	var self = {
        
    mqttTopic: 'zwave',
    nodes: {},
    onChangeListeners: [],

    init: function() {
        this.logger = winston.loggers.get(loggerName)
        god.mqtt.addTrigger(this.mqttTopic + '/#', 'zwave', this.onMqttMessage.bind(this))
    },
    
    addChangeListener: function(callback) {
        this.onChangeListeners.push(callback)
    },

    async onMqttMessage(trigger, topic, message, packet) {
		let value = message.toString()
        this.logger.debug('Received mqtt %s: %s', topic, value)
        let pathSegments = topic.split('/')
        if (pathSegments.length < 2 || pathSegments[0] != 'zwave') {
            this.logger.warn('Topic can\'t be parsed: %s', topic)
            return
        }
        let nodeId
        if (pathSegments[1].startsWith('nodeID_')) {
            relativeTopic = topic.substr(pathSegments[0].length + pathSegments[1].length + 2)
            pathSegments.shift() // 'zwave'
            nodeId = pathSegments[0]
        } else {
            relativeTopic = topic.substr(pathSegments[0].length + pathSegments[1].length + pathSegments[2].length + 3)
            pathSegments.shift() // 'zwave'
            nodeId = pathSegments[0] + '/' + pathSegments[1]
            pathSegments.shift() // location
        }
        pathSegments[0] = nodeId // use short form as array key
        let targetObj = this.nodes
        try {
            value = JSON.parse(value)
        } catch(e) {}
        while(pathSegments.length) {
            let segment = pathSegments.shift()
            if (pathSegments.length) {
                if (!targetObj[segment]) targetObj[segment] = {}
                targetObj = targetObj[segment]
            } else {
                targetObj[segment] = value
                this.logger.debug('on node %s, setting %s to %o', nodeId, relativeTopic, value)
                this.onChangeListeners.forEach(cb => cb(nodeId, this.nodes[nodeId], relativeTopic, value))
            }
        }
    },
    
    getNode(nodeId) {
        return this.nodes[nodeId] ?? {}
    },
    
    /** Retrieves a cached value for the given nodeId. If this node has not been seen yet on the requested path, returns undefined */
    getNodeValue(nodeId, path) {
        let value = this.nodes[nodeId]
        if (!value) return undefined
        let pathSegments = path.split('/')
        while(pathSegments.length) {
            let segment = pathSegments.shift()
            if (value[segment])
                value = value[segment]
            else
                return undefined
        }
        this.logger.debug('getNodeValue(%s, %s) = %o', nodeId, path, value)
        return value
    }

}
    self.init()
    return self
}
