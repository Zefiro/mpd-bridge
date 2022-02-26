// Class documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes

const winston = require('winston')


// TODO move into config json
let thingDefinitions = {
    'shortyspinner': { 'name': 'Shortyspinner', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2' },
    'main-light-left': { 'name': 'Main Light (left)', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER1' },
    'main-light-right': { 'name': 'Main Light (right)', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER2' },
    'main-light': { 'name': 'Main Light', 'api': 'composition', 'things': [ { 'thing': 'main-light-left', '': 'Left' }, { 'thing': 'main-light-right', '': 'Right' } ] },
    'main-strip': { 'name': 'Main Strip', 'api': 'tasmota', 'device': 'grag-main-strip', 'power': 'POWER' },
    'main-light-all': { 'name': 'Main: all Lights', 'api': 'composition', 'things': [ { 'thing': 'main-light', '': 'Light' }, { 'thing': 'main-strip', '': 'Ledstrip' } ] },
}

class Thing {
    constructor(id, definition) {
        this.def = definition
        this.def.id = id
    }
}

class TasmotaThing extends Thing {
    constructor(id, definition) {
        super(id, definition)
    }
}

module.exports = function(god, loggerName = 'things') {
    var self = {

    init: function() {
        this.logger = winston.loggers.get(loggerName)
        this.logger.info("Thing init")
        this.onMqttTasmotaSwitch = this.onMqttTasmotaSwitch.bind(this)
        Object.keys(thingDefinitions).forEach(id => thingDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.values(thingDefinitions).forEach(def => this.createThing(def))
    },

    // Creates a 'thing' instance based on the 'def'inition from the configuration
    createThing: function(def) {
        if (def.api == 'tasmota') {
            this.addTasmotaSwitchTrigger(def)
        } else {
            this.logger.error('Thing %s has undefined api "%s"', def.id, def.api)
        }
    },

    // Callback for MQTT messages for tasmota-based switches
    onMqttTasmotaSwitch: async function(trigger, topic, message, packet) {
        let thing = god.things[trigger.id]
        let def = thingDefinitions[trigger.id]
        let propagateChange = false
        let newValue = message.toString()
        try {
            let json = JSON.parse(newValue)
            newValue = json
        } catch(e) {}
        if (topic == 'stat/' + def.device + '/RESULT') { // an action has set a new target power value (unfortunately this is also sent on bootup, so can't be used for crash detection)
            if (newValue.hasOwnProperty(def.power)) {
                newValue = newValue[def.power]
                let oldTargetValue = thing.targetValue
                thing.targetValue = newValue
                this.logger.debug('%s target value changed (RESULT): %o -> %o', def.id, oldTargetValue, newValue)
                propagateChange = true
            } else {
                this.logger.debug('Tasmota %s sent RESULT which is uninteresting for thing %s which is looking for %s: %o', topic, def.id, def.power, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/STATUS11') { // generic status information, which might contain our power value, and which might be un/changed
            if (newValue['StatusSTS'].hasOwnProperty(def.power)) {
                newValue = newValue['StatusSTS'][def.power]
                let oldValue = thing.value
                thing.lastUpdated = new Date() // update timestamp even if the value is unchanged
                propagateChange = true
                if (oldValue != newValue) {
                    thing.value = newValue
                    this.logger.debug('%s value changed (StatusSTS): %o -> %o (target: %o)', def.id, oldValue, newValue, thing.targetValue)
                } else {
                    this.logger.debug('%s value unchanged (StatusSTS): %o (target: %o)', def.id, oldValue, thing.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s StatusSTS does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'tele/' + def.device + '/STATE') { // state information
            if (newValue.hasOwnProperty(def.power)) {
                newValue = newValue[def.power]
                let oldValue = thing.value
                thing.lastUpdated = new Date() // update timestamp even if the value is unchanged
                propagateChange = true
                if (oldValue != newValue) {
                    thing.value = newValue
                    this.logger.debug('%s value changed (tele/STATE): %o -> %o (target: %o)', def.id, oldValue, newValue, thing.targetValue)
                } else {
                    this.logger.debug('%s value unchanged (tele/STATE): %o (target: %o)', def.id, oldValue, thing.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s tele/STATE does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/' + def.power) { // state has been changed
            let oldValue = thing.value
            thing.lastUpdated = new Date() // update timestamp even if the value is unchanged
            propagateChange = true
            if (oldValue != newValue) {
                thing.value = newValue
                this.logger.debug('%s value changed (stat): %o -> %o (target: %o)', def.id, oldValue, newValue, thing.targetValue)
            } else {
                this.logger.debug('%s value unchanged (stat): %o (target: %o)', def.id, oldValue, thing.targetValue)
            }
        } else {
            this.logger.debug('Mqtt callback called for %s, but %s is not interested in this.', topic, def.id)
        }

        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(id, thing))
        }
    },

    // adds mqtt triggers for a Tasmota-based switches
    addTasmotaSwitchTrigger: function(def) {
        let mqttTopic = 'stat/' + def.device + '/' + def.power
        this.logger.debug('Registering Tasmota Thing %s (%s)', def.id, mqttTopic)
        god.things[def.id] = {
            value: undefined,
            targetValue: undefined,
            lastUpdated: undefined,
        }
        // register to status changes
        god.mqtt.addTrigger(mqttTopic, def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('tele/' + def.device + '/STATE', def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('stat/' + def.device + '/RESULT', def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('stat/' + def.device + '/STATUS11', def.id, this.onMqttTasmotaSwitch)
        // trigger retrieval of current status
        god.mqtt.publish('cmnd/' + def.device + '/status', '11')
    },

}
    self.init()
    return self
}

/*

grag-main-light SENSOR
IN: {
    'Time': '2021-10-16T17:07:06', 
    'Switch1': 'OFF', 
    'Switch2': 'OFF', 
    'ANALOG': {'Temperature': 60.1}, 
    'ENERGY': {'TotalStartTime': '2020-03-08T22:04:14', 'Total': 35.847, 'Yesterday': 1.143, 'Today': 0.574, 'Period': 1, 'Power': [37, 36], 'ApparentPower': [47, 46], 'ReactivePower': [8, 8], 'Factor': [0.78, 0.78], 'Frequency': 50, 'Voltage': 232, 'Current': [0.201, 0.195]},
    'TempUnit': 'C'
}
OUT [
    {
        'measurement': 'SENSOR', 
        'tags': {
            'location': 'grag-main-light',
            'sensor': 'ANALOG'
        }, 
        'fields': {
            'Temperature': 60.1
        }
    }, {
        'measurement': 'SENSOR', 
        'tags': {
            'location': 'grag-main-light', 
            'sensor': 'ENERGY'
        }, 
        'fields': {
            'TotalStartTime': '2020-03-08T22:04:14', 
            'Total': 35.847, 
            'Yesterday': 1.143, 
            'Today': 0.574, 
            'Period': 1, 
            'Power': 37, 
            'ApparentPower': 47, 
            'ReactivePower': 8, 
            'Factor': 0.78, 
            'Frequency': 50, 
            'Voltage': 232, 
            'Current': 0.201
        }
    }, {
        'measurement': 'SENSOR',
        'tags': {
            'location': 'grag-main-light',
            'sensor': 'ENERGY1'
        }, 
        'fields': {
            'Power': 36, 
            'ApparentPower': 46, 
            'ReactivePower': 8, 
            'Factor': 0.78, 
            'Current': 0.195
        }
    }
]
   

-----------------------

Topic: tele/grag-main-light/STATE
{
    "Time": "2021-10-16T17:13:06",
    "Uptime": "0T04:39:14",
    "UptimeSec": 16754,
    "Heap": 25,
    "SleepMode": "Dynamic",
    "Sleep": 50,
    "LoadAvg": 19,
    "MqttCount": 1,
    "POWER1": "ON",
    "POWER2": "ON",
    "Wifi": {
        "AP": 1,
        "SSId": "Clawtec_D",
        "BSSId": "FC:EC:DA:35:41:37",
        "Channel": 6,
        "RSSI": 76,
        "Signal": -62,
        "LinkCount": 1,
        "Downtime": "0T00:00:08"
    }
}
OUT [
    {
        'measurement': 'Tasmota', 
        'tags': {
            'location': 'grag-main-light',
            'sensor': 'Tasmota'
        }, 
        'fields': {
            'UptimeSec': 16754,
            'POWER1': 1,
            'POWER2': 1,
        }
    }
]
   

SELECT median("Power") FROM "SENSOR" WHERE ("sensor" = 'ENERGY') AND $timeFilter GROUP BY time($__interval), "location" fill(previous)

*/
