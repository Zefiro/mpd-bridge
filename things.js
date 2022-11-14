// Class documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes

const winston = require('winston')


// TODO move into config json
let thingDefinitions = {
    'main-mpd': { 'name': 'Music', 'group': 'main', 'api': 'mpd', 'device': 'grag-mpd1', 'togglevalues': { 'play': 'pause', '': 'play' }, 'render': { 'icon': 'fa/music.svg', 'split': true } },

    'main-light': { 'name': 'Main Light', 'group': 'main', 'api': 'composite', 'togglevalues': { '': 'ON' }, 'things': [ { 'id': 'main-light-door', '': 'Door' }, { 'id': 'main-light-window', '': 'Window' } ], 'render': { 'split': true }, 'link': 'http://grag-main-light.fritz.box' },

    'main-light-door': { 'name': 'Light Door', 'group': 'main-light', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER1' },
    'main-light-window': { 'name': 'Light Window', 'group': 'main-light', 'api': 'tasmota', 'device': 'grag-main-light', 'power': 'POWER2', 'render': true },

    // TODO shutter firmware
//    'main-blinds': { 'name': 'Main Blinds', 'group': 'main-blinds', 'api': 'tasmota-shutter', 'device': 'grag-main-blinds', 'power-up': 'POWER1', 'power-down': 'POWER2' },

    'main-blinds': { 'name': 'Main Blinds', 'group': 'main', 'api': 'composite', 'togglevalues': { 'OFF': 'OFF', '': 'OFF' }, 'things': [ { 'id': 'main-blinds-up', '': 'Door' }, { 'id': 'main-blinds-down', '': 'Window' } ], 'render': { 'icon': 'fa/blinds.svg', 'split': true }, 'link': 'http://grag-main-blinds.fritz.box' },

    'main-blinds-up': { 'name': 'Up', 'group': 'main-blinds', 'api': 'tasmota', 'device': 'grag-main-blinds', 'power': 'POWER1', 'render': { 'icon': 'fa/arrow-alt-to-top.svg' } },
    'main-blinds-down': { 'name': 'Down', 'group': 'main-blinds', 'api': 'tasmota', 'device': 'grag-main-blinds', 'power': 'POWER2', 'render': { 'icon': 'fa/arrow-alt-to-bottom.svg' } },

    'main-blinds2': { 'name': 'Main Blinds2', 'group': 'main', 'api': 'composite', 'togglevalues': { 'OFF': 'OFF', '': 'OFF' }, 'things': [ { 'id': 'main-blinds2-up', '': 'Door' }, { 'id': 'main-blinds2-down', '': 'Window' } ], 'render': { 'icon': 'fa/blinds.svg', 'split': true }, 'link': 'http://grag-main-blinds2.fritz.box' },

    'main-blinds2-up': { 'name': 'Up', 'group': 'main-blinds2', 'api': 'tasmota', 'device': 'grag-main-blinds2', 'power': 'POWER1', 'render': { 'icon': 'fa/arrow-alt-to-top.svg' } },
    'main-blinds2-down': { 'name': 'Down', 'group': 'main-blinds2', 'api': 'tasmota', 'device': 'grag-main-blinds2', 'power': 'POWER2', 'render': { 'icon': 'fa/arrow-alt-to-bottom.svg' } },
    'main-blinds2-down-short': { 'name': 'Short Down', 'group': 'main-blinds2', 'api': 'button', 'type': 'mqtt', 'mqtt': 'cmnd/grag-main-blinds2/BACKLOG POWER2 ON; DELAY 10; POWER2 OFF', 'render': { 'icon': 'fa/arrow-alt-down.svg' } },
    'main-blinds2-down-medium': { 'name': 'Medium Down', 'group': 'main-blinds2', 'api': 'button', 'type': 'mqtt', 'mqtt': 'cmnd/grag-main-blinds2/BACKLOG POWER2 ON; DELAY 30; POWER2 OFF', 'render': { 'icon': 'fa/arrow-alt-down.svg' } },
    'main-blinds2-down-long': { 'name': 'Long Down', 'group': 'main-blinds2', 'api': 'button', 'type': 'mqtt', 'mqtt': 'cmnd/grag-main-blinds2/BACKLOG POWER2 ON; DELAY 70; POWER2 OFF', 'render': { 'icon': 'fa/arrow-alt-down.svg' } },

    // TODO: show scenario?

    'main-strip': { 'name': 'Main Strip', 'group': 'main', 'api': 'ledstrip.js', 'device': 'grag-main-strip', 'power': 'POWER', 'render': { 'icon': 'fa/lights-holiday.svg', 'autohide': true }, 'link': 'http://grag-main-strip.fritz.box' },
    'main-dancer': { 'name': 'Dancer', 'group': 'main', 'api': 'tasmota', 'device': 'grag-dancer', 'power': 'POWER1', 'render': { 'icon': 'fa/lights-holiday.svg', 'autohide': true } },
    
    'shortyspinner': { 'name': 'Shortyspinner', 'group': 'main', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER2', 'render': { 'icon': 'fa/fan-table.svg' } },
    
    'main-POS': { 'name': 'POS Display', 'group': 'main', 'api': 'tasmota', 'device': 'grag-usbsw1', 'power': 'POWER', 'render': { 'icon': 'fa/cash-register.svg', 'autohide': true } },

    'main-zapper': { 'name': 'Zapper', 'group': 'main', 'api': 'tasmota', 'device': 'grag-sonoff-p3', 'power': 'POWER', 'render': { 'icon': 'fa/bolt.svg', 'icon-on': 'fa/bolt-solid.svg', 'autohide': true } },

    // TODO special mqtt query
    // TODO volume slider
    'main-onkyo': { 'name': 'Onkyo', 'group': 'main', 'api': 'onkyo', 'device': 'onkyo', 'render': { 'icon': 'fa/speaker.svg' } },

    'hoard-mpd': { 'name': 'Music', 'group': 'hoard', 'api': 'mpd', 'device': 'grag-mpd2', 'render': { 'icon': 'fa/music.svg', split: true } },

    'hoard-light': { 'name': 'Main Light', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-light', 'power': 'POWER1' },

    'hoard-fan-in': { 'name': 'Fan In', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-fan', 'power': 'POWER2', 'render': { 'icon': 'fa/fan-table.svg' } },
    'hoard-fan-out': { 'name': 'Fan Out', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-fan', 'power': 'POWER1', 'render': { 'icon': 'fa/fan-table.svg' } },

    'hoard-zapper': { 'name': 'Zapper', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-hoard-light', 'power': 'POWER2', 'render': { 'icon': 'fa/bolt.svg', 'icon-on': 'fa/bolt-solid.svg', 'autohide': true } },

    'attic-light': { 'name': 'Attic Light', 'group': 'hoard', 'api': 'tasmota', 'device': 'grag-attic', 'power': 'POWER1' },

    'food-light': { 'name': 'Main Light', 'group': 'food', 'api': 'tasmota', 'device': 'grag-food-light', 'power': 'POWER1' },
    'food-strip': { 'name': 'Strip', 'group': 'food', 'api': 'tasmota', 'device': 'grag-food-strip', 'power': 'POWER1', 'render': { 'icon': 'fa/lights-holiday.svg' } },

    'bad-light': { 'name': 'Main Light', 'group': 'bad', 'api': 'tasmota', 'device': 'grag-bad-light', 'power': 'POWER1' },
    'bad-mirror': { 'name': 'Mirror', 'group': 'bad', 'api': 'tasmota', 'device': 'grag-bad-strip', 'power': 'POWER1' },
    'bad-strip': { 'name': 'Strip', 'group': 'bad', 'api': 'tasmota', 'device': 'grag-bad-strip', 'power': 'POWER2', 'render': { 'icon': 'fa/lights-holiday.svg', 'autohide': true } },

    'flur-light1': { 'name': 'Main Light', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-light', 'power': 'POWER1' },
    'flur-light2': { 'name': 'Lower Light', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-light', 'power': 'POWER2', 'render': { 'autohide': true } },

    'flur-strip': { 'name': 'Strip', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur-strip', 'power': 'POWER2', 'render': { 'icon': 'fa/lights-holiday.svg', 'autohide': true } },

    'flur2-light': { 'name': 'Storage Light', 'group': 'flur', 'api': 'tasmota', 'device': 'grag-flur2-light', 'power': 'POWER1' },

    'laden-coffee': { 'name': 'Coffee', 'group': 'laden', 'api': 'tasmota', 'device': 'grag-sonoff-p2', 'power': 'POWER', 'render': { 'autohide': true  } },
    'laden-camera': { 'name': 'Camera', 'group': 'laden', 'api': 'tasmota', 'device': 'grag-sonoff-p4', 'power': 'POWER', 'render': { 'autohide': true, 'hiddenIfDead': true } },

    'halle-main-light': { 'name': 'Main Light', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-main', 'power': 'POWER1' },
    'halle-door-light': { 'name': 'Door Light', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-door', 'power': 'POWER1' },
    'halle-compressor': { 'name': 'Compressor', 'group': 'halle', 'api': 'tasmota', 'device': 'grag-halle-door', 'power': 'POWER2', 'render': { 'icon': 'fa/tachometer-fast.svg' } },

    'outdoor-main-light': { 'name': 'Main Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-outdoor-light', 'power': 'POWER2' },
    'outdoor-door-light': { 'name': 'Door Light', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-outdoor-light', 'power': 'POWER1' },

    'door-buzzer': { 'name': 'Door Button', 'group': 'outdoor', 'api': 'tasmota', 'device': 'grag-flur-light2', 'power': 'POWER1', 'render': { 'icon': 'fa/dungeon.svg' } },

    'container2-lights': { 'name': 'Container Lights', 'group': 'outdoor', 'api': 'composite', 'togglevalues': { '': 'ON' }, 'things': [ { 'id': 'container2-stair-light', '': 'Stairs' }, { 'id': 'container2-light', '': 'Top' } ], 'render': { 'split': true }, 'link': 'http://grag-container2-light.fritz.box' },
    'container2-stair-light': { 'name': 'Container Stairs Light', 'group': 'container2-lights', 'api': 'tasmota', 'device': 'grag-container2-light', 'power': 'POWER1', 'render': { 'autohide': false, 'hiddenIfDead': true } },
    'container2-light': { 'name': 'Container Top Light', 'group': 'container2-lights', 'api': 'tasmota', 'device': 'grag-container2-light', 'power': 'POWER2', 'render': { 'autohide': false, 'hiddenIfDead': true } },


//    'broken': { 'name': 'Test', 'group': 'misc', 'api': 'tasmota', 'device': 'not-existing', 'power': 'POWER', 'render': { 'autohide': true } },

}

/*
    createModal({ id: 'main-light', title: 'Main Light'})
    createModal({ id: 'main-blinds', title: 'Main Blinds'})
    createModal({ id: 'main-blinds2', title: 'Main Blinds2'})
    createModal({ id: 'container2-lights', title: 'Container Lights'})
*/

const groupDefinitions = {
    'main': {
        name: 'Main',
        style: 'bg-cogs',
    },
    'main-light': {
        name: 'Main Light',
        style: 'bg-circuit',
        type: 'modal',
    },
    'main-blinds': {
        name: 'Main Blinds',
        style: 'bg-circuit',
        type: 'modal',
    },
    'main-blinds2': {
        name: 'Main Blinds2',
        style: 'bg-circuit',
        type: 'modal',
    },
    'hoard': {
        name: 'Hoard',
        style: 'bg-cogs',
    },
    'food': {
        name: 'Küche',
        style: 'bg-cogs',
    },
    'bad': {
        name: 'Bad',
        style: 'bg-cogs',
    },
    'flur': {
        name: 'Flur',
        style: 'bg-cogs',
    },
    'laden': {
        name: 'Laden',
        style: 'bg-circuit',
    },
    'halle': {
        name: 'Halle',
        style: 'bg-circuit',
    },
    'outdoor': {
        name: 'Outdoor',
        style: 'bg-cogs',
    },
    'container2-lights': {
        name: 'Container Lights',
        style: 'bg-topography',
        type: 'modal',
    },
    'misc': {
        name: 'Misc',
        style: 'bg-circuit',
    }
}


/* Scenario Definitions
 * TODO: might become actions what needs to be changed -> currently that's in prod.json
 * things: list of things with expected status. Things not listed here are ignored. can be either a string or a flat object to compare against thing value.
 * hide: list of things which should be hidden if they conform to the expected status for this scenario
 */
var scenarioDefinitions = {
    'day': {
        'name': 'Day',
        'things': {
            'main-strip': 'ON',
            'main-dancer': 'ON',
            'main-POS': 'ON',
            'main-zapper': 'OFF',
//            'main-onkyo': { 'power': 'ON' },
            'bad-strip': { 'power': 'ON', 'channel2': 75 },
            'flur-strip': { 'power': 'ON', 'channel2': 50 },
        },
        'hide': [
            'main-strip',
            'main-dancer',
            'main-POS',
            'hoard-zapper',
            'bad-strip',
            'flur-strip',
        ],
    },
    'night': {
        'name': 'Night',
        'things': {
            'main-mpd': { 'power': 'OFF' },
            'main-light': 'OFF',
            'main-blinds': 'OFF',
            'main-blinds2': 'OFF',
            'main-strip': 'OFF',
            'main-dancer': 'OFF',
            'shortyspinner': 'OFF',
            'main-POS': 'OFF',
            'main-zapper': 'ON',
            'main-onkyo': { 'power': 'OFF' },
            'hoard-mpd': { 'power': 'OFF' },
            'attic-light': 'OFF',
            'food-light': 'OFF',
            'food-strip': 'OFF',
            'bad-light': 'OFF',
            'bad-mirror': 'OFF',
            'bad-strip': { 'power': 'ON', 'channel2': 20 },
            'flur-light1': 'OFF',
            'flur-light2': 'OFF',
            'flur2-light': 'OFF',
            'flur-strip': { 'power': 'ON', 'channel2': 10 },
            'laden-coffee': 'OFF',
            'laden-camera': 'OFF',
            'halle-main-light': 'OFF',
            'halle-door-light': 'OFF',
            'halle-compressor': 'OFF',
            'outdoor-main-light': 'OFF',
            'outdoor-door-light': 'OFF',
            'door-buzzer': 'OFF',
            'container2-lights': 'OFF',
            'container2-stair-light': 'OFF',
            'container2-light': 'OFF',
        },
        'hide': [
            'main-strip',
            'main-dancer',
            'shortyspinner',
            'main-zapper',
            'main-POS',
            'main-onkyo',
            'hoard-fan-in',
            'hoard-fan-out',
            'hoard-zapper',
            'attic-light',
            'bad-strip',
            'flur-light2',
            'flur-strip',
        ],
    },
    'away': {
        'name': 'Away',
        'include': 'night',
        'things': {
            'hoard-light': 'OFF',
            'hoard-zapper': 'OFF',
            'hoard-fan-in': 'OFF',
            'hoard-fan-out': 'OFF',
            'bad-mirror': 'OFF',
            'bad-strip': 'OFF',
            'flur-strip': 'OFF',
            'main-zapper': 'OFF',
        },
        'hide': [
            'hoard-light',
            'hoard-zapper',
            'hoard-fan-in',
            'hoard-fan-out',
            'bad-mirror',
            'bad-strip',
            'flur-strip',
            'main-zapper',
        ]
    }
}

var god, logger

class ThingStatus {
    static ignored = new ThingStatus('ignored', 3)                 // this thing is ignored by the staleness-check
    static uninitialized = new ThingStatus('uninitialized', 2)     // we have no value yet (but might have asked for it already)
    static alive = new ThingStatus('alive', 4)                     // we have a value, and it's not stale
    static stale = new ThingStatus('stale', 1)                     // we have a value, but it hasn't been updated/confirmed for some time (but we poked it when setting this status, and will poke again)
    static dead = new ThingStatus('dead', 0)                       // we haven't heard back from the thing, even after poking (will poke again)
    
    constructor(name, order) {
        this.name = name
        this.order = order // used for composite things
    }
}

class Thing {
    static consideredStaleMs = 90 * 1000        // how long after the last update to consider a value stale and start poking
    static consideredDeadMs = 120 * 1000        // how long after the last update to consider thing dead (but continue poking)
    static pokeIntervalMs = 60 * 1000          // interval to poke stale/dead things
    static staleCheckIntervalMs = 15 * 1000     // interval to check for all of the above, used in setInterval()

    constructor(id, def) {
        this.def = def
        if (this.def.id != id) logger.error('Thing id doesn\'t match definition id, something will probably fail somewhere') // TODO
        this.logger = logger
        this.god = god
        this.status = ThingStatus.uninitialized
        this.lastUpdated = 0,
        this.lastpoked = 0
        // normalizing data
        if (this.def.render === false) this.def.render = { hidden: true }
        if (!(this.def.render instanceof Object)) this.def.render = {}
    }
    
    /** called after all things have been loaded, for initializing references */
    init() {
    }
    
    /** JSON representation of the current state (overwritten by subclasses) */
    get json() {
        return {
            id: this.def.id,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name
        }
    }
    
    /** JSON representation of the current state plus the thing definition */
    get fullJson() {
        let json = this.json
        json.def = this.def
        return json
    }

    get id() {
        return this.def.id
    }
    
    onAction(data) {
        this.logger.warn('Abstract base class for ' + this.id + ': action not supported')
    }
    
    setstatus(newStatus, propagateChange = true) {
        if (this.status != newStatus) {
            if (this.status == ThingStatus.dead) this.logger.info(this.def.id + ' is alive again')
            this.status = newStatus;
            if (propagateChange) god.onThingChanged.forEach(cb => cb(this))
        }
    }

    // called from timer - with a cached new Date() - to check if our value is stale. If yes, pokes the thing
    checkAlive(now) {
        switch (this.status) {
            case ThingStatus.ignored:
                // no updating, no poking
                break;
            case ThingStatus.alive:
                if (now - this.lastUpdated > Thing.consideredStaleMs) {
                    this.setstatus(ThingStatus.stale)
                    this.logger.info('Status for ' + this.def.id + ' has gone stale, poking it')
                    this.poke(now)
                }
                break;
            case ThingStatus.uninitialized:
            case ThingStatus.stale:
                if (now - this.lastUpdated > Thing.consideredDeadMs) {
                    this.setstatus(ThingStatus.dead)
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
                    this.setstatus(ThingStatus.ignored)
                break;
        }
    }
    
    poke(now) {
        this.logger.warn('Abstract base class for ' + this.id + ': poking not supported')
        this.lastpoked = now
    }

}

class MusicPlayer extends Thing {
    constructor(id, def) {
        super(id, def)
        this.lastState = {}
        this.onMqttStateUpdate = this.onMqttStateUpdate.bind(this)
        god.mqtt.addTrigger('tele/' + def.device + '/STATE', def.id, this.onMqttStateUpdate)

    }

    get json() {
        return {
            id: this.def.id,
            type: 'MPD',
            value: this.lastState,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name
        }
    }

    // Callback for MQTT messages for the MPD subsystem
    async onMqttStateUpdate(trigger, topic, message, packet) {
		let newState = message.toString()
		try {
			let json = JSON.parse(newState)
			newState = json
		} catch(e) {
            this.logger.error('MQTT: Failed to parse JSON: ' + newState)
        }
		this.lastState = newState
        
        // calculated values
        this.lastState.power = (this.lastState.status.state == 'play') ? 'ON' : 'OFF'
        
        this.lastUpdated = new Date() // update timestamp even if the value is unchanged
        this.setstatus(ThingStatus.alive, false)
        god.onThingChanged.forEach(cb => cb(this))
    }

    onAction(action) {
        this.logger.debug('Action for %s: %o', this.def.id, action)
        let translate = { 'play': 'play', 'pause': 'pause', 'toggle': 'toggle' }
        let mpdAction = translate[action]
        if (mpdAction) {
            god.mqtt.publish('cmnd/' + this.def.device + '/' + mpdAction, '1')
        }
    }

    poke(now) {
        god.mqtt.publish('cmnd/' + this.def.device + '/status', '')
        this.lastpoked = now
    }

}

class TasmotaThing extends Thing {
    constructor(id, def) {
        super(id, def)
    }
}

// TODO copy TasmotaSwitch to TasmotaStrip, with value { power, channel2 }
// how to best do this with re-using existing code?
// also, grag3.html needs to correctly parse this
class TasmotaSwitch extends TasmotaThing {
    constructor(id, def) {
        super(id, def)
        let mqttTopic = 'stat/' + def.device + '/' + def.power
        this.logger.debug('Registering TasmotaSwitch %s (%s)', def.id, mqttTopic)
        this.value = undefined,
        this.targetValue = undefined,
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
        this.lastpoked = now
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
                this.logger.silly('Tasmota %s sent RESULT which is uninteresting for thing %s which is looking for %s: %o', topic, def.id, def.power, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/STATUS11') { // generic status information, which might contain our power value, and which might be un/changed
            if (!newValue['StatusSTS']) {
                this.logger.error('Tasmota %s STATUS11 does not include expected "StatusSTS"', topic)
            } else if (newValue['StatusSTS'].hasOwnProperty(def.power)) {
                newValue = newValue['StatusSTS'][def.power]
                let oldValue = this.value
                this.lastUpdated = new Date() // update timestamp even if the value is unchanged
                this.setstatus(ThingStatus.alive, false)
                propagateChange = true
                if (oldValue != newValue) {
                    this.value = newValue
                    this.logger.debug('%s value changed (StatusSTS): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
                } else {
                    this.logger.silly('%s value unchanged (StatusSTS): %o (target: %o)', def.id, oldValue, this.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s StatusSTS does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'tele/' + def.device + '/STATE') { // state information
            if (newValue.hasOwnProperty(def.power)) {
                newValue = newValue[def.power]
                let oldValue = this.value
                this.lastUpdated = new Date() // update timestamp even if the value is unchanged
                this.setstatus(ThingStatus.alive, false)
                propagateChange = true
                if (oldValue != newValue) {
                    this.value = newValue
                    this.logger.debug('%s value changed (tele/STATE): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
                } else {
                    this.logger.silly('%s value unchanged (tele/STATE): %o (target: %o)', def.id, oldValue, this.targetValue)
                }
            } else {
                this.logger.debug('Tasmota %s tele/STATE does not include %s for thing %s: %o', topic, def.power, def.id, newValue)
            }
        } else if (topic == 'stat/' + def.device + '/' + def.power) { // state has been changed
            let oldValue = this.value
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.setstatus(ThingStatus.alive, false)
            propagateChange = true
            if (oldValue != newValue) {
                this.value = newValue
                this.logger.debug('%s value changed (stat): %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
            } else {
                this.logger.silly('%s value unchanged (stat): %o (target: %o)', def.id, oldValue, this.targetValue)
            }
        } else {
            this.logger.silly('Mqtt callback called for %s, but %s is not interested in this.', topic, def.id)
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
        this.lastpoked = now
    }
}

class Onkyo extends Thing {
    constructor(id, def) {
        super(id, def)
        let mqttTopic = def.device + '/status/#'
        this.logger.debug('Registering Onkyo device "%s" (%s)', def.id, mqttTopic)
        this.value = { 'power': undefined, 'volume': undefined }
        this.targetValue = undefined,
        // register to status changes
        this.onMqttOnkyo = this.onMqttOnkyo.bind(this)
        god.mqtt.addTrigger(mqttTopic, def.id, this.onMqttOnkyo)
        // trigger retrieval of current status
        this.poke(new Date())
    }
    
    poke(now) {
        let topic = this.def.device + '/set/system-power'
        let value = 'query'
        this.logger.debug('Poking ' + this.def.id + ' with: ' + topic + ' = ' + value)
        god.mqtt.publish(topic, value)
        god.mqtt.publish(this.def.device + '/set/master-volume', value)
        this.lastpoked = now
    }

    get json() {
        return {
            id: this.def.id,
            type: 'Onkyo',
            value: this.value,
            targetValue: this.targetValue,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name
        }
    }
        
    // Callback for MQTT messages for onkyo2mqtt script
    async onMqttOnkyo(trigger, topic, message, packet) {
        let def = thingDefinitions[trigger.id]
        let propagateChange = false
        let newValue = message.toString()
        try {
            let json = JSON.parse(newValue)
            newValue = json
        } catch(e) {}
        if (topic == def.device + '/status/system-power') {
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.setstatus(ThingStatus.alive, false)
            let oldValuePart = this.value.power
            let newValuePart = newValue.val == 'on' ? 'ON' : newValue.val == 'standby' ? 'OFF' : newValue.val
            propagateChange = true
            if (oldValuePart != newValuePart) {
                this.value.power = newValuePart
                this.logger.debug('%s value changed (power): %o -> %o (target: %o)', def.id, oldValuePart, newValuePart, this.targetValue)
            } else {
                this.logger.silly('%s value unchanged (power): %o (target: %o)', def.id, oldValuePart, this.targetValue)
            }
        } else if (topic == def.device + '/status/master-volume') {
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.setstatus(ThingStatus.alive, false)
            let oldValuePart = this.value.volume
            let newValuePart = newValue.val
            propagateChange = true
            if (oldValuePart != newValuePart) {
                this.value.volume = newValuePart
                this.logger.debug('%s value changed (volume): %o -> %o (target: %o)', def.id, oldValuePart, newValuePart, this.targetValue)
            } else {
                this.logger.silly('%s value unchanged (volume): %o (target: %o)', def.id, oldValuePart, this.targetValue)
            }
        } else {
            this.logger.silly('Mqtt callback called for %s, but %s is not interested in this.', topic, def.id)
        }

        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }
    
    onAction(action) {
        this.logger.debug('Action for %s: %o', this.def.id, action)
        if (['ON', 'OFF'].includes(action)) {
            this.targetValue = action
            god.mqtt.publish(this.def.device + '/set/system-power' , action == 'ON' ? 'on' : 'off')
        }
    }

}

class Button extends Thing {
    constructor(id, def) {
        super(id, def)
        this.status = ThingStatus.ignored
    }

    get json() {
        return {
            id: this.def.id,
            status: this.status.name,
            value: ''
        }
    }

    onAction(action) {
        let mqttString = this.def.mqtt
        let index = mqttString.indexOf(' ')
        let topic = mqttString.substr(0, index)
        let message = mqttString.substr(index + 1)
        this.logger.debug('Action for %s (%o): send "%s" "%s"', this.def.id, action, topic, message)
        god.mqtt.publish(topic, message)
    }

    poke(now) { 
        this.lastpoked = now
    }
}

class CompositeThing extends Thing {
    constructor(id, def) {
        super(id, def)
    }
    
    init() {
        for(let thingRef of this.def.things) {
            let thing = god.things[thingRef.id]
            if (!thing) {
                this.logger.error('Composite thing ' + thing.id + ': reference to thing ' + thingRef.id + ' not found')
                return // TODO be more resilient
            }
        }
        god.onThingChanged.push(this.onThingChanged.bind(this))
    }
    
    onThingChanged(thing) {
        // check if the changed thing is one of ours
        if (this.def.things.filter(thingRef => thingRef.id == thing.id).length == 0) return
        this.logger.debug('Composite thing %s: watched thing changed: %s', this.id, thing.id) 
        this.checkAlive()
        god.onThingChanged.forEach(cb => cb(this))
    }

    get json() {
        let values = this.def.things.map(thingRef => god.things[thingRef.id].json )
        let value = 'error'
        if (values.filter(v => v.value != 'ON').length == 0) value = 'ON'
        else if (values.filter(v => v.value != 'OFF').length == 0) value = 'OFF'
        else value = values.map(v => v.value).join(' / ')
        return {
            id: this.def.id,
            value: value,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name
        }
    }

    checkAlive(now) {
        let mergedStatus = ThingStatus.alive
        this.lastUpdated = null;
        for(let thingRef of this.def.things) {
            let thing = god.things[thingRef.id]
            thing.checkAlive()
            if (mergedStatus.order > thing.status.order) mergedStatus = thing.status
            if (this.lastUpdated == null || this.lastUpdated > thing.lastUpdated)  this.lastUpdated = thing.lastUpdated // take oldest value
        }
        let prevStatus = this.status
        this.setstatus(mergedStatus)
    }
    
    poke(now) {
        this.def.things.forEach(thingRef => god.things[thingRef.id].poke(now))
        this.lastpoked = now
    }

    onAction(action) {
        this.logger.debug('Action for composite %s: %o - propagating to %s', this.def.id, action, this.def.things.map(thingRef => thingRef.id).join(', '))
        this.def.things.forEach(thingRef => god.things[thingRef.id].onAction(action))
    }

}


module.exports = function(god2, loggerName = 'things') {
    var self = {

    init: function() {
        god = god2
        logger = winston.loggers.get(loggerName)
        this.logger = logger
        this.god = god
        this.currentScenario = Object.values(scenarioDefinitions)[0] // default = first one
        this.logger.info("Thing init")
        Object.keys(thingDefinitions).forEach(id => thingDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.keys(groupDefinitions).forEach(id => groupDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.keys(scenarioDefinitions).forEach(id => {
            scenarioDefinitions[id].id = id
            if (scenarioDefinitions[id].include) {
                let includedScenarioId = scenarioDefinitions[id].include
                let includedScenario = scenarioDefinitions[includedScenarioId]
                scenarioDefinitions[id].things = { ...includedScenario.things, ...scenarioDefinitions[id].things }
                scenarioDefinitions[id].hide = [ ...includedScenario.hide, ...scenarioDefinitions[id].hide ]
            }
        })
        Object.values(thingDefinitions).forEach(def => this.createThing(def)) // create all the things
        Object.values(god.things).forEach(thing => thing.init()) // initializes all the things
        this.timerid = setInterval(() => {
            let now = new Date()
            Object.values(god.things).forEach(thing => thing.checkAlive(now))
        }, Thing.staleCheckIntervalMs)
    },

    // Creates a 'thing' instance based on the 'def'inition from the configuration
    createThing: function(def) {
        if (def.api == 'tasmota') {
            god.things[def.id] = new TasmotaSwitch(def.id, def)
        } else if (def.api == 'tasmotaStrip') {
            god.things[def.id] = new TasmotaStrip(def.id, def)
        } else if (def.api == 'composite') {
            god.things[def.id] = new CompositeThing(def.id, def)
        } else if (def.api == 'ledstrip.js') {
            god.things[def.id] = new LedstripJs(def.id, def)
        } else if (def.api == 'mpd') {
            god.things[def.id] = new MusicPlayer(def.id, def)
        } else if (def.api == 'button') {
            god.things[def.id] = new Button(def.id, def)
        } else if (def.api == 'onkyo') {
            god.things[def.id] = new Onkyo(def.id, def)
        } else {
            this.logger.error('Thing %s has undefined api "%s"', def.id, def.api)
        }
    },
    
    getGroupDefinitions() {
        return groupDefinitions;
    },
    
    getScenario(id = null) {
        return (id === null ? scenarioDefinitions : scenarioDefinitions[id])
    },
    
    getCurrentScenario() {
        return this.currentScenario;
    },
    
    setCurrentScenario(id) {
        if (this.currentScenario.id == id) {
            this.logger.warn('ThingScenario is already "' + id + '", ignored')
            return
        }
        if (scenarioDefinitions[id]) {
            this.currentScenario = scenarioDefinitions[id]
            this.logger.info('Changed ThingScenario to ' + id)
            god.whiteboard.getCallbacks('thingScenario').forEach(cb => cb(this.currentScenario))
        } else {
            this.logger.warn('ThingScenario: unknown scenario id "' + id + '" ignored')
        }
    },
    
    /** Gets called from clients (websocket), expects the thing id and action with thing-specific commands */
    onAction: function(id, action) {
        let thing = god.things[id]
        this.logger.debug('action for %s (%s): %o', id, thing.def.name, action)
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
