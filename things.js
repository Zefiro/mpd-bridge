// Class documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes

const winston = require('winston')
const fs = require('fs')
const yaml = require('js-yaml')



/*
    createModal({ id: 'main-light', title: 'Main Light'})
    createModal({ id: 'main-blinds', title: 'Main Blinds'})
    createModal({ id: 'main-blinds2', title: 'Main Blinds2'})
    createModal({ id: 'container2-lights', title: 'Container Lights'})
*/

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
    
    /** This function is called when a thing-specific action should be triggered, e.g. "switch light on". For most things this sends the appropriate MQTT commands */
    onAction(data) {
        this.logger.warn('Abstract base class for ' + this.id + ': action not supported')
    }
    
    /** internally used to change this.status, propagates the new value to listeners (can be skipped if done manually anyway) */
    setstatus(newStatus, propagateChange = true) {
        if (this.status != newStatus) {
            if (this.status == ThingStatus.dead) this.logger.info(this.def.id + ' is alive again')
            this.status = newStatus;
            if (propagateChange) god.onThingChanged.forEach(cb => cb(this))
        }
    }

    // called from timer - with now = the current Date() - to check if our value is stale. If yes, pokes the thing
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
    
    /** Called from checkAlive() when a thing is considered stale/dead. Should try to provoke the thing to answer something. */
    poke(now) {
        this.logger.warn('Abstract base class for ' + this.id + ': poking not supported')
        this.lastpoked = now
    }

}

class MusicPlayer extends Thing {
    constructor(id, def) {
        super(id, def)
        this.lastState = {}
        this.onMpdMqttStateUpdate = this.onMpdMqttStateUpdate.bind(this)
        god.mqtt.addTrigger('tele/' + def.device + '/STATE', def.id, this.onMpdMqttStateUpdate)

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
    async onMpdMqttStateUpdate(trigger, topic, message, packet) {
		let newState = message.toString()
		try {
			let json = JSON.parse(newState)
			newState = json
		} catch(e) {
            this.logger.error('MQTT: Failed to parse JSON: ' + newState)
        }

        if (newState.status == 'offline') {
            // mpd.js responds, but actual mpd connection is down - treat as 'no answer'
            return
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
        let def = this.thingController.thingDefinitions[trigger.id]
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
        let def = this.thingController.thingDefinitions[trigger.id]
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

/** Represents a simple, stateless button on the UI which triggers a specific MQTT message */
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

    /** Buttons can't be poked */
    poke(now) { 
    }
}

class ZWave extends Thing {
    constructor(id, def) {
        super(id, def)
        this.status = ThingStatus.ignored
        god.zwave.addChangeListener(this.onZWaveUpdate.bind(this))
    }

    get json() {
        return {
            id: this.def.id,
            lastUpdated: this.lastUpdated,
            status: this.status.name,
            value: god.zwave.getNodeValue(this.def.nodeId, '37/' + (this.def.nodeSubId ?? 0) + '/currentValue/value') ? 'ON' : 'OFF'
        }
    }
    
    /** called from zwave.js when an MQTT update is received */
    onZWaveUpdate(nodeId, nodeData, relativeTopic, value) {
        if (nodeId != this.def.nodeId) return
        let propagateChange = false
        if (relativeTopic == '37/' + (this.def.nodeSubId ?? 0) + '/currentValue') propagateChange = true
        if (relativeTopic == 'status/status') {
            let newStatus = ThingStatus.dead
            if (nodeData?.status?.status == 'Alive') newStatus = ThingStatus.alive
            if (this.status != newStatus) {
                this.setstatus(newStatus, false)
                propagateChange = true
            }
        }
        this.logger.warn('ZWave update on node %s: %s = %s (propagate=%s)', nodeId, relativeTopic, value, propagateChange)
        this.lastUpdated = new Date() // update timestamp even if the value is unchanged
        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }

    onAction(action) {
        let topic = 'zwave/' + this.def.nodeId + '/37/' + (this.def.nodeSubId ?? 0) + '/targetValue/set'
        let message = action == 'ON' ? "true" : "false"
        this.logger.info('Action for %s (%o): send "%s" "%s"', this.def.id, action, topic, message)
        god.mqtt.publish(topic, message)
    }

// TODO alive check not working: neither stale nor lastUpdate updating nor check for 'Dead'
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
                } else {
                    let nodeData = god.zwave.getNode(this.def.nodeId)
                    if (nodeData?.status?.status != 'Alive') this.setstatus(ThingStatus.dead)
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

    // does nothing - don't know how to poke ZWave things, or zwave-js
    poke(now) { 
//        this.lastpoked = now
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
        
    mqttTopic: 'cmnd/things/scenario',

    init: function() {
        god = god2
        logger = winston.loggers.get(loggerName)
        this.logger = logger
        this.god = god
        this.logger.info("Thing init")
        this.thingDefinitions = yaml.load(fs.readFileSync('config/thingDefinitions.yaml', 'utf8'))
        this.groupDefinitions = yaml.load(fs.readFileSync('config/thingGroupDefinitions.yaml', 'utf8'))
        this.scenarioDefinitions = yaml.load(fs.readFileSync('config/thingScenarioDefinitions.yaml', 'utf8'))
        this.currentScenario = Object.values(this.scenarioDefinitions)[0] // default = first one
        Object.keys(this.thingDefinitions).forEach(id => this.thingDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.keys(this.groupDefinitions).forEach(id => this.groupDefinitions[id].id = id) // add key as 'id' inside the definition
        Object.keys(this.scenarioDefinitions).forEach(id => {
            this.scenarioDefinitions[id].id = id
            if (this.scenarioDefinitions[id].include) {
                let includedScenarioId = this.scenarioDefinitions[id].include
                let includedScenario = this.scenarioDefinitions[includedScenarioId]
                this.scenarioDefinitions[id].things = { ...includedScenario.things, ...this.scenarioDefinitions[id].things }
                this.scenarioDefinitions[id].hide = [ ...includedScenario.hide, ...this.scenarioDefinitions[id].hide ]
            }
        })
        Object.values(this.thingDefinitions).forEach(def => this.createThing(def)) // create all the things
        Object.values(god.things).forEach(thing => thing.init()) // initializes all the things
        this.timerid = setInterval(() => {
            let now = new Date()
            Object.values(god.things).forEach(thing => thing.checkAlive(now))
        }, Thing.staleCheckIntervalMs)
        god.mqtt.addTrigger(this.mqttTopic, 'thingScenario', this.onMqttMessage.bind(this))
    },

    async onMqttMessage(trigger, topic, message, packet) {
		let msg = message.toString()
        this.logger.info('Received mqtt thingscenario "' + msg + '"')
        let result = await this.setCurrentScenario(msg)
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
        } else if (def.api == 'zwave') {
            god.things[def.id] = new ZWave(def.id, def)
        } else {
            this.logger.error('Thing %s has undefined api "%s"', def.id, def.api)
        }
        if (god.things[def.id]) god.things[def.id].thingController = this
    },
    
    getGroupDefinitions() {
        return this.groupDefinitions;
    },
    
    getScenario(id = null) {
        return (id === null ? this.scenarioDefinitions : this.scenarioDefinitions[id])
    },
    
    getCurrentScenario() {
        return this.currentScenario;
    },
    
    async setCurrentScenario(id) {
        if (this.currentScenario.id == id) {
            this.logger.info('ThingScenario is already "' + id + '", ignored')
            return 'ThingScenario is already "' + id + '", ignored'
        }
        if (this.scenarioDefinitions[id]) {
            this.currentScenario = this.scenarioDefinitions[id]
            this.logger.info('Changed ThingScenario to ' + id)
            god.whiteboard.getCallbacks('thingScenario').forEach(cb => cb(this.currentScenario))
            return 'ThingScenario set to "' + id + '"'
        } else {
            this.logger.warn('ThingScenario: unknown scenario id "' + id + '" ignored')
            return 'ThingScenario: unknown scenario id "' + id + '" ignored'
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
