// Class documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes

const winston = require('winston')


// TODO move into config json
let thingDefinitions = {
    // TODO MPD
    'Music': { 'name': 'Music', 'group': 'main', 'api': 'mpd', 'device': 'grag-mpd1', 'render': { 'icon': 'fa/music.svg' } },

    // TODO composite thing
    'main-light': { 'name': 'Main Light', 'group': 'main', 'api': 'composition', 'things': [ { 'thing': 'main-light-left', '': 'Left' }, { 'thing': 'main-light-right', '': 'Right' } ] },
    'main-light-all': { 'name': 'Main: all Lights', 'group': 'main', 'api': 'composition', 'things': [ { 'thing': 'main-light', '': 'Light' }, { 'thing': 'main-strip', '': 'Ledstrip' } ] },

    // TODO render:false once composite works
    'main-light-left': { 'name': 'Main Light (left)', 'group': 'main', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER1' },
    'main-light-right': { 'name': 'Main Light (right)', 'group': 'main', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER2', 'render': true },

    // TODO shutter
    'main-blinds': { 'name': 'Main Blinds', 'group': 'main', 'api': 'tasmota-shutter', 'device': 'grag-main-light', 'power-up': 'POWER1', 'power-down': 'POWER2' },

    
    // TODO: show scenario?
    'main-strip': { 'name': 'Main Strip', 'group': 'main', 'api': 'ledstrip.js', 'device': 'grag-main-strip', 'power': 'POWER', 'render': { 'icon': 'fa/lights-holiday.svg' } },
    
    'shortyspinner': { 'name': 'Shortyspinner', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2', 'render': { 'icon': 'fa/fan-table.svg' } },
    
    'main-POS': { 'name': 'POS Display', 'group': 'main', 'api': 'tasmota', 'device': 'grag-usbsw1', 'power': 'POWER', 'render': { 'icon': 'fa/cash-register.svg' } },

    'main-zapper': { 'name': 'Zapper', 'group': 'main', 'api': 'tasmota', 'device': 'grag-sonoff-p3', 'power': 'POWER', 'render': { 'icon': 'fa/bolt.svg', 'icon-on': 'fa/bolt-solid.svg' } },

    // TODO special mqtt query
    // TODO volume slider
    'main-onkyo': { 'name': 'Onkyo', 'group': 'main', 'api': 'onkyo', 'device': 'onkyo' },

    'hoard-light': { 'name': 'Main Light', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-light', 'power': 'POWER1' },

    'hoard-fan-in': { 'name': 'Fan In', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-fan', 'power': 'POWER2', 'render': { 'icon': 'fa/fan-table.svg' } },
    'hoard-fan-out': { 'name': 'Fan Out', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-fan', 'power': 'POWER1', 'render': { 'icon': 'fa/fan-table.svg' } },

    'hoard-zapper': { 'name': 'Zapper', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-light', 'power': 'POWER2', 'render': { 'icon': 'fa/bolt.svg', 'icon-on': 'fa/bolt-solid.svg' } },

    'attic-light': { 'name': 'Attic Light', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER1' },

    'food-light': { 'name': 'Main Light', 'group': 'food', 'api': 'tasmota', 'device': 'grag-food-light', 'power': 'POWER1' },
    'food-strip': { 'name': 'Strip', 'group': 'food', 'api': 'tasmota', 'device': 'grag-food-strip', 'power': 'POWER1', 'render': { 'icon': 'fa/lights-holiday.svg' } },

    'bad-light': { 'name': 'Main Light', 'group': 'bad', 'api': 'tasmota', 'device': 'grag-bad-light', 'power': 'POWER1' },
    'bad-strip': { 'name': 'Strip', 'group': 'bad', 'api': 'tasmota', 'device': 'grag-bad', 'power': 'POWER1', 'render': { 'icon': 'fa/lights-holiday.svg' } },

    'flur-light1': { 'name': 'Main Light', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-light', 'power': 'POWER1' },
    'flur-light2': { 'name': 'Lower Light', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-light', 'power': 'POWER2' },

    // TODO Strip
    'flur-strip': { 'name': 'Strip', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-strip', 'power': 'POWER2', 'render': { 'icon': 'fa/lights-holiday.svg' } },

    'halle-main-light': { 'name': 'Main Light', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-main', 'power': 'POWER1' },
    'halle-door-light': { 'name': 'Door Light', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-door', 'power': 'POWER1' },
    'halle-compressor': { 'name': 'Compressor', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-door', 'power': 'POWER2', 'render': { 'icon': 'fa/tachometer-fast.svg' } },

    'outdoor-main-light': { 'name': 'Main Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-outdoor-light', 'power': 'POWER2' },
    'outdoor-door-light': { 'name': 'Door Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-outdoor-light', 'power': 'POWER1' },

    'door-buzzer': { 'name': 'Door Button', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-flur-light2', 'power': 'POWER1', 'render': { 'icon': 'fa/dungeon.svg' } },

    'container2-light': { 'name': 'Container2 Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-container2-light', 'power': 'POWER2' },
    'container2-stair-light': { 'name': 'Container Stair Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-container2-light', 'power': 'POWER1' },

    'filler1': { 'name': 'Filler1', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2' },
    'filler2': { 'name': 'Filler2', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2' },
    'filler3': { 'name': 'Filler3', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2' },
    'filler4': { 'name': 'Filler4', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic2', 'power': 'POWER2' },

}

var god, logger

class ThingStatus {
    static ignored = new ThingStatus('ignored')                 // this thing is ignored by the staleness-check
    static uninitialized = new ThingStatus('uninitialized')     // we have no value yet (but might have asked for it already)
    static alive = new ThingStatus('alive')                     // we have a value, and it's not stale
    static stale = new ThingStatus('stale')                     // we have a value, but it hasn't been updated/confirmed for some time (but we poked it when setting this status, and will poke again)
    static dead = new ThingStatus('dead')                       // we haven't heard back from the thing, even after poking (will poke again)
    
    constructor(name) {
        this.name = name
    }
}

class Thing {
    static consideredStaleMs = 90 * 1000        // how long after the last update to consider a value stale and start poking
    static consideredDeadMs = 300 * 1000        // how long after the last update to consider thing dead (but continue poking)
    static pokeIntervalMs = 300 * 1000          // interval to poke stale/dead things
    static staleCheckIntervalMs = 15 * 1000     // interval to check for all of the above, used in setInterval()

    constructor(id, def) {
        this.def = def
        if (this.def.id != id) logger.error('Thing id doesn\'t match definition id, something will probably fail somewhere') // TODO
        this.logger = logger
        this.god = god
        this.status = ThingStatus.uninitialized
    }
    
    get json() {
        return {
            id: this.def.id
        }
    }
    
    get id() {
        return this.def.id
    }
    
    onAction(data) {
        this.logger.warn('Abstract base class for ' + this.id + ': action not supported')
    }
}

class TasmotaThing extends Thing {
    constructor(id, def) {
        super(id, def)
    }
}

class TasmotaSwitch extends TasmotaThing {
    constructor(id, def) {
        super(id, def)
        let mqttTopic = 'stat/' + def.device + '/' + def.power
        this.logger.debug('Registering TasmotaSwitch %s (%s)', def.id, mqttTopic)
        this.value = undefined,
        this.targetValue = undefined,
        this.lastUpdated = 0,
        this.lastpoked = 0
        // register to status changes
        this.onMqttTasmotaSwitch = this.onMqttTasmotaSwitch.bind(this)
        god.mqtt.addTrigger(mqttTopic, def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('tele/' + def.device + '/STATE', def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('stat/' + def.device + '/RESULT', def.id, this.onMqttTasmotaSwitch)
        god.mqtt.addTrigger('stat/' + def.device + '/STATUS11', def.id, this.onMqttTasmotaSwitch)
        // trigger retrieval of current status
        this.poke(new Date())
    }
    
    poke(now) {
        let topic = 'cmnd/' + this.def.device + '/status'
        let value = '11'
        this.logger.debug('Poking ' + this.def.id + ' with: ' + topic + ' = ' + value)
        god.mqtt.publish(topic, value)
        this.lastpoked = new Date()
    }

    get json() {
        return {
            id: this.def.id,
            type: 'TasmotaSwitch',
            value: this.value,
            targetValue: this.targetValue,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name
        }
    }
        
    get fullJson() {
        let json = this.json
        json.def = this.def
        return json
    }

    // Callback for MQTT messages for tasmota-based switches
    async onMqttTasmotaSwitch(trigger, topic, message, packet) {
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
                let oldTargetValue = this.targetValue
                this.targetValue = newValue
                this.logger.debug('%s target value changed (RESULT): %o -> %o', def.id, oldTargetValue, newValue)
                propagateChange = true
            } else {
                this.logger.debug('Tasmota %s sent RESULT which is uninteresting for thing %s which is looking for %s: %o', topic, def.id, def.power, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/STATUS11') { // generic status information, which might contain our power value, and which might be un/changed
            if (newValue['StatusSTS'].hasOwnProperty(def.power)) {
                newValue = newValue['StatusSTS'][def.power]
                let oldValue = this.value
                this.lastUpdated = new Date() // update timestamp even if the value is unchanged
                this.status = ThingStatus.alive
                propagateChange = true
                if (oldValue != newValue) {
                    this.value = newValue
                    this.logger.debug('%s value changed (StatusSTS): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
                } else {
                    this.logger.debug('%s value unchanged (StatusSTS): %o (target: %o)', def.id, oldValue, this.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s StatusSTS does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'tele/' + def.device + '/STATE') { // state information
            if (newValue.hasOwnProperty(def.power)) {
                newValue = newValue[def.power]
                let oldValue = this.value
                this.lastUpdated = new Date() // update timestamp even if the value is unchanged
                this.status = ThingStatus.alive
                propagateChange = true
                if (oldValue != newValue) {
                    this.value = newValue
                    this.logger.debug('%s value changed (tele/STATE): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
                } else {
                    this.logger.debug('%s value unchanged (tele/STATE): %o (target: %o)', def.id, oldValue, this.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s tele/STATE does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/' + def.power) { // state has been changed
            let oldValue = this.value
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.status = ThingStatus.alive
            propagateChange = true
            if (oldValue != newValue) {
                this.value = newValue
                this.logger.debug('%s value changed (stat): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
            } else {
                this.logger.debug('%s value unchanged (stat): %o (target: %o)', def.id, oldValue, this.targetValue)
            }
        } else {
            this.logger.debug('Mqtt callback called for %s, but %s is not interested in this.', topic, def.id)
        }

        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }
    
    // called from timer - with a cached new Date() - to check if our value is stale. If yes, pokes the thing
    checkAlive(now) {
        let propagateChange = false
        switch (this.status) {
            case ThingStatus.ignored:
                // no updating, no poking
                break;
            case ThingStatus.alive:
                if (now - this.lastUpdated > Thing.consideredStaleMs) {
                    this.status = ThingStatus.stale
                    propagateChange = true
                    this.logger.info('Status for ' + this.def.id + ' has gone stale, poking it')
                    this.poke(now)
                }
                break;
            case ThingStatus.uninitialized:
            case ThingStatus.stale:
                if (now - this.lastUpdated > Thing.consideredDeadMs) {
                    this.status = ThingStatus.dead
                    propagateChange = true
                    this.logger.info(this.def.id + ' appears to be dead :(')
                    this.poke(now)
                }
                if (now - this.lastpoked > Thing.pokeIntervalMs) {
                    this.poke(now)
                }
                break;
            case ThingStatus.dead:
                if (now - this.lastpoked > Thing.pokeIntervalMs) {
                    this.poke(now)
                }
                break;
            default:
                this.logger.error('ThingStatus for ' + this.id + ' is invalid: ' + this.status)
                this.status = ThingStatus.ignored
                propagateChange = true
                break;
        }
        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }
    
    onAction(action) {
        this.logger.debug('Action for %s: %o', this.def.id, action)
        if (['ON', 'OFF', 'TOGGLE'].includes(action)) {
            this.targetValue = action
            god.mqtt.publish('cmnd/' + this.def.device + '/' + this.def.power, action)
        }
    }

}

class LedstripJs extends TasmotaSwitch {
    constructor(id, def) {
        super(id, def)
    }

    poke(now) {
        let topic = 'cmnd/' + this.def.device + '/POWER'
        let value = ''
        this.logger.debug('Poking ' + this.def.id + ' with: ' + topic + ' = ' + value)
        god.mqtt.publish(topic, value)
        this.lastpoked = new Date()
    }
}

module.exports = function(god2, loggerName = 'things') {
    var self = {

    init: function() {
        god = god2
        logger = winston.loggers.get(loggerName)
        this.logger = logger
        this.god = god
        this.logger.info("Thing init")
        Object.keys(thingDefinitions).forEach(id => thingDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.values(thingDefinitions).forEach(def => this.createThing(def)) // create all the things
        this.timerid = setInterval(() => {
            let now = new Date()
            Object.values(god.things).forEach(thing => thing.checkAlive(now))
        }, Thing.staleCheckIntervalMs)
    },

    // Creates a 'thing' instance based on the 'def'inition from the configuration
    createThing: function(def) {
        if (def.api == 'tasmota') {
            god.things[def.id] = new TasmotaSwitch(def.id, def)
        } else if (def.api == 'ledstrip.js') {
            god.things[def.id] = new LedstripJs(def.id, def)
        } else {
            this.logger.error('Thing %s has undefined api "%s"', def.id, def.api)
        }
    },
    
    /** Gets called from clients (websocket), expects the thing id and action with thing-specific commands */
    onAction: function(id, action) {
        let thing = god.things[id]
        this.logger.debug('action for %s: %o %o', id, thing.def.name, action)
        if (thing) thing.onAction(action)
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
