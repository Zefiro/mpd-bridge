/**
  Thing Configurations
  - in file config/thingDefinitions.yaml
  - each entry defined one entity
  - Entry Prototype:
id-of-entry:                       <- id of entity
  disabled: false                  <- optional. If true, entry is ignored. Defaults to false.
  name: Entry Name                 <- Display Name
  group: MyLivingRoom              <- group ID, as defined in /config/thingGroupDefinitions.yaml
  api: [see below]
  render:    <- optional
    icon: fa/bolt.svg              <- optional, which icon to use on the UI. Defaults to a lightbulb
    icon-on: fa/bolt-solid.svg     <- optional, which icon to use on the UI for the 'on' state. Defaults to whatever is set with 'icon'
    autohide: true                 <- optional, if true, will by default only be shown when in unexpected state (according to the scenario). Default: false
    hiddenIfDead: true             <- optional. If the device does not react, it will not be shown at all. Defaults to be shown as unreachable.

  - Several API providers exist:
    - api: tasmota                 <- default Tasmota controlled device, connected via mqtt
      Additional config lines:
      - device: grag-main-light    <- the device name, will be used to construct mqtt topics
      - power: POWER               <- for switches, the Tasmota command which output is used (e.g. "POWER", "POWER1", "POWER2")
    - api: button                       <- button on the UI with a special function (not directly associated to a single entity)
      Additional config lines:
      - type: mqtt                 <- currently only supports 'mqtt'
      - mqtt: my/topic cmd         <- mqtt topic [space] mqtt command to send (can include spaces)
        Examples:
        - cmnd/grag-main-blinds2/BACKLOG POWER2 ON; DELAY 100; POWER2 OFF
        - cmnd/scenario goodmorning
    - api: mpd                     <- Music Player Daemon
      Additional config lines:
      - device: grag-mpd1
      - togglevalues:              <- when clicking on the icon, what action should be send depending on the current mpd state (allowed actions are 'play', 'pause', 'toggle')
          play: pause
          '': play
    - api: composite               <- combines multiple entities, uses a popup to control
      Additional config lines:
      - togglevalues:              <- when clicking on the icon, what action should be send depending on the current entity state
          '': 'ON'
      - things:                    <- entity ids which are part of this composite. Will be acted upon when clicking the icon, will be individually shown in a popup when clicking on the text
        - id: main-light-door
          '': Door
        - id: main-light-window
          '': Window
    - api: onkyo                   <- used mqtt to control a script which communicates with Onkyo audio via eth
      Additional config lines:
      - device: onkyo
    - api: ledstrip.js             <- my original Raspberry Pi based ledstrip controller
      Additional config lines:
      - device: grag-main-strip
      - power: POWER
    - api: tasmotaSensor
      todo
    - api: AIonEdge
      todo
    - api: zigbee2mqtt             <- for Zigbee devices reachable via MQTT bridge
      Additional config lines:
      - topic: main-fridge         <- will be used to construct the mqtt topic

*/


// Class documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes

const winston = require('winston')
const fs = require('fs')
const yaml = require('js-yaml')
const WebSocket = require('ws')

// https://stackoverflow.com/a/16608045/131146
var isObject = function(a) {
    return (!!a) && (a.constructor === Object);
}
var isArray = function(a) {
    return (!!a) && (a.constructor === Array);
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
    static pokeIntervalMs = 60 * 1000           // interval to poke stale/dead things
    static staleCheckIntervalMs = 15 * 1000     // interval to check for all of the above, used in setInterval()
    thingController = undefined                  // is injected after construction

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
    
    /** JSON representation of the current state (extended by subclasses) */
    get json() {
        return {
            id: this.def.id,
            lastUpdated: this.lastUpdated,
            lastpoked: this.lastpoked,
            status: this.status.name,
            scenarioStatus: this.getScenarioStatus(),
            value: this.getValue(),
        }
    }
    
    getValue() { return '<abstract>' }
    
    /** JSON representation of the current state plus the thing definition */
    get fullJson() {
        let json = this.json
        json.def = this.def
        return json
    }

    get id() {
        return this.def.id
    }
    
    // WIP - bring the status calculation from the frontend to the backend. Currently not finished and not used.
    getScenarioStatus() {
        let currentScenario = this.thingController.getCurrentScenario()
        if (!currentScenario) return { isPartOfScenario: false, isAsExpected: true }
        let expected = currentScenario.things[this.def.id]
        if (!expected) return { isPartOfScenario: false, isAsExpected: true }
        let isAsExpected = false
        let expectedValues = []
        let value = this.getValue()
        if (isObject(expected)) {
            if (!isObject(value)) {
                // expected is an object, but value isn't - assume it's "power"
                value = { power: value }
            }
// TODO
// define intermediate result - and if it makes sense to have it at all?
return { isWIP: true }

        } else {
            isAsExpected = (value == expected)
            expectedValues = [ expected ]
        }
        return { isPartOfScenario: true, isAsExpected: isAsExpected, expectedValues: expectedValues }
    }
    
    /** This function is called when a thing-specific action should be triggered, e.g. "switch light on". For most things this sends the appropriate MQTT commands */
    onAction(action) {
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
                    this.logger.debug('Status for ' + this.def.id + ' has gone stale, poking it')
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
        return { ...super.json,
            type: 'MPD',
        }
    }

    getValue() { return this.lastState }

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
        this.value = undefined
        this.targetValue = undefined
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
        return { ...super.json,
            type: 'TasmotaSwitch',
            targetValue: this.targetValue,
        }
    }
    
    getValue() { return this.value }
       
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

// TODO WIP
class TasmotaSensor extends TasmotaThing {
    constructor(id, def) {
        super(id, def)
        let mqttTopic = 'stat/' + def.device + '/' + def.power
        this.logger.debug('Registering TasmotaSensor %s (%s)', def.id, mqttTopic)
        this.value = undefined
        this.targetValue = undefined
        // register to status changes
        this.onMqttTasmotaSensor = this.onMqttTasmotaSensor.bind(this)
        god.mqtt.addTrigger(mqttTopic, def.id, this.onMqttTasmotaSensor)
        god.mqtt.addTrigger('tele/' + def.device + '/STATE', def.id, this.onMqttTasmotaSensor)
        god.mqtt.addTrigger('stat/' + def.device + '/SENSOR', def.id, this.onMqttTasmotaSensor)
        god.mqtt.addTrigger('stat/' + def.device + '/STATUS11', def.id, this.onMqttTasmotaSensor)
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
        return { ...super.json,
            type: 'TasmotaSensor',
            targetValue: this.targetValue,
        }
    }
    
    getValue() { return this.value }
       
    // Callback for MQTT messages for tasmota-based sensors
    // TODO WIP copied from TasmotaSwitch
    async onMqttTasmotaSensor(trigger, topic, message, packet) {
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
                this.lastUpdated = new Date() // update timestamp even if the value is unchanged
                this.setstatus(ThingStatus.alive, false)
                propagateChange = true
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
        // Sensors have nothing. Or do they?
    }

}

class AIonEdge extends Thing {
    constructor(id, def) {
        super(id, def)
        let mqttTopic = def.device + '/main/json'
        this.logger.debug('Registering AIonEdge %s (%s)', def.id, mqttTopic)
        this.value = undefined
        // register to status changes
        god.mqtt.addTrigger(mqttTopic + '/#', def.id, this.onMqtt.bind(this))
        // trigger retrieval of current status
        this.poke(new Date())
    }
    
    poke(now) {
        // TODO don't know how to poke
        this.lastpoked = now
    }

    get json() {
        return { ...super.json,
            type: 'AIonEdge',
        }
    }
    
    getValue() { return this.value }
       
    // { "value": "183.7062", "raw": "00183.7062", "pre": "183.7062", "error": "no error", "rate": "0.000000", "timestamp": "2023-11-11T18:37:39+0100" } 
    async onMqtt(trigger, topic, message, packet) {
        let def = this.thingController.thingDefinitions[trigger.id]
        let propagateChange = false
        let newValue = message.toString()
        try {
            let json = JSON.parse(newValue)
            newValue = json
        } catch(e) {}
        if (topic == mqttTopic) {
            newValue = newValue['value']
            let oldValue = this.value
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.setstatus(ThingStatus.alive, false)
            propagateChange = true
            if (oldValue != newValue) {
                this.value = newValue
                this.logger.debug('%s value changed: %o -> %o', def.id, oldValue, newValue)
            } else {
                this.logger.debug('%s value unchanged: %o -> %o', def.id, oldValue, newValue)
            }
        } else {
            this.logger.silly('Mqtt callback called for %s, but %s is not interested in this.', topic, def.id)
        }

        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }
    
    onAction(action) {
        // Sensors have nothing. Or do they?
    }

}

// Raspberry-based proprietary Ledstrip
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

class WLED extends Thing {
    socket = null
    state = {}
    closedRetry = 0
    
    constructor(id, def) {
        super(id, def)
        this.connectWs()
    }
    
    connectWs() {
        this.socket = new WebSocket('ws://' + this.def.device + '/ws')
        this.logger.debug('Connecting to %s via websocket', this.def.name);
        this.socket.on('open', () => {
            this.logger.info('Connected to %s via websocket', this.def.name);
            this.closedRetry = 0
        })

        this.socket.on('message', this.onMessage.bind(this))

        this.socket.on('close', (code, reason) => {
            this.closedRetry++
            if (this.closedRetry < 5) {
                this.logger.error('Websocket to %s closed: %s %s (retrying)', this.def.name, code, reason);
                this.connectWs()
            } else {
                this.logger.error('Websocket to %s closed: %s %s (retry limit reached)', this.def.name, code, reason);
            }
        })

        this.socket.on('error', error => {
            this.logger.error('Websocket to %s error: %s', this.def.name, error);
            // TODO what now?
        })
    }
    
    getValue() {
        return this.state.on ? "ON" : "OFF"
    }
    
    async onMessage(data, isBinary) {
        let propagateChange = false
        try {
            let wled = JSON.parse(data)
            this.setstatus(ThingStatus.alive, false)
            if (wled.success === true) return // response if we poke it with "v:false"
            if (this.state.on != wled.state.on) propagateChange = true // only update UI for relevant state changes
            this.state = wled.state
            this.logger.debug('%s websocket received: %o', this.def.name, wled);
        } catch(e) {
            this.logger.error('%s websocket parsing error (isBinary=%s): %s', this.def.name, isBinary, e);
        } 
        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }

    poke(now) {
        // TODO if offline, re-establish connection?
        switch (this.socket.readyState) {
            case WebSocket.CONNECTING: break // we'll get called soon enough
            case WebSocket.OPEN:
                this.logger.debug('Poking %s', this.def.id)
                this.socket.send(JSON.stringify({"v":true}))
                this.lastpoked = now
                break;
            case WebSocket.CLOSING: break // just wait for the next round...
            case WebSocket.CLOSED:
                this.connectWs()
                break;
            default:
                this.logger.warn('%s websocket readyState=%s unrecognized', this.def.name, this.socket.readyState)
        }
    }

    onAction(action) {
        if (action instanceof Object) {
            this.logger.info("%s: custom WLED command: %o", this.def.name, action)
            this.socket.send(JSON.stringify(action))
        } else switch (action) {
            case "ON":
                this.socket.send(JSON.stringify({"on":true,"bri":50}))
                this.logger.info("%s: switched on (default brightness)", this.def.name)
                break;
            case "OFF":
                this.socket.send(JSON.stringify({"on":false}))
                this.logger.info("%s: switched off", this.def.name)
                break;
            default:
                this.logger.error("%s: action '%s' unrecognized", this.def.name, action)
        }
    }
}

class Zigbee2Mqtt extends Thing {
    constructor(id, def) {
        super(id, def)
        this.mqttTopic = 'zigbee2mqtt/' + def.topic
        /* %topic/availability: {"state":"online"}
           %topic: {"child_lock":"UNLOCK","current":0,"energy":1.92,"indicator_mode":"off","linkquality":102,"power":0,"power_outage_memory":"off","state":"ON","update":{"installed_version":-1,"latest_version":-1,"state":null},"update_available":null,"voltage":233}
           %topic/set <- "ON"
        */
        this.logger.debug('Registering Zigbee2MQTT device "%s" (%s)', def.id, this.mqttTopic)
        this.value = undefined
        this.targetValue = undefined,
        // register to status changes
        this.onMqttZigbee = this.onMqttZigbee.bind(this)
        god.mqtt.addTrigger(this.mqttTopic, def.id, this.onMqttZigbee)
        god.mqtt.addTrigger(this.mqttTopic + '/#', def.id, this.onMqttZigbee)
        // trigger retrieval of current status
        this.poke(new Date())
    }
    
    poke(now) {
/* WIP - don't know how to poke */
        this.lastpoked = now
    }

    get json() {
        return { ...super.json,
            type: 'Zigbee2Mqtt',
            targetValue: this.targetValue,
        }
    }
        
    getValue() { return this.value }

    // Callback for MQTT messages for Zigbee2Mqtt devices
    async onMqttZigbee(trigger, topic, message, packet) {
        let def = this.thingController.thingDefinitions[trigger.id]
        let propagateChange = false
        let newValue = message.toString()
        try {
            let json = JSON.parse(newValue)
            newValue = json
        } catch(e) {}
        if (topic == this.mqttTopic) { // base topic
            this.lastUpdated = new Date() // update timestamp even if the value is unchanged
            this.setstatus(ThingStatus.alive, false)
            propagateChange = true
            if (newValue.hasOwnProperty('state')) {
                newValue = newValue.state
                let oldValue = this.value
                if (oldValue != newValue) {
                    this.value = newValue
                    this.logger.debug('%s value changed: %o -> %o (target: %o)', def.id, oldValue, newValue, this.targetValue)
                } else {
                    this.logger.silly('%s value unchanged: %o (target: %o)', def.id, oldValue, this.targetValue)
                }
            } else {
                this.logger.warn('%s update doesn\'t contain field "state": %o', def.id, newValue)
            }
        } else if (topic == this.mqttTopic + '/availability') {
            this.setstatus(newValue.state == 'ONLINE' ? ThingStatus.alive : ThingStatus.dead, false)
            propagateChange = true
        } else if (topic == this.mqttTopic + '/set') {
            this.targetValue = newValue
            propagateChange = true
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
            god.mqtt.publish(this.mqttTopic + '/set', action)
        }
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
        return { ...super.json,
            type: 'Onkyo',
            targetValue: this.targetValue,
        }
    }
        
    getValue() { return this.value }

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
        return { ...super.json,
        }
    }

    getValue() { return '' }

    onAction(action) {
        let mqttList = isArray(this.def.mqtt) ? this.def.mqtt : [ this.def.mqtt ]
        for(let mqttString of mqttList) {
            let index = mqttString.indexOf(' ')
            let topic = mqttString.substr(0, index)
            let message = mqttString.substr(index + 1)
            this.logger.debug('Action for Button %s (%o): send "%s" "%s"', this.def.id, action, topic, message)
            god.mqtt.publish(topic, message)
        }
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
        return { ...super.json,
        }
    }
    
    getValue() { return god.zwave.getNodeValue(this.def.nodeId, '37/' + (this.def.nodeSubId ?? 0) + '/currentValue/value') ? 'ON' : 'OFF' }

// TODO
//   Received mqtt zwave/Main/Test/status: {"time":1691449136917,"value":true,"status":"Alive","nodeId":19}
//   on node Main/Test, setting status to { time: 1691448998563, value: false, status: 'Dead', nodeId: 19 }
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
        this.logger.debug('ZWave update on node %s: %s = %s (propagate=%s)', nodeId, relativeTopic, value, propagateChange)
        this.lastUpdated = new Date() // update timestamp even if the value is unchanged
        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }

    onAction(action) {
        let topic = 'zwave/' + this.def.nodeId + '/37/' + (this.def.nodeSubId ?? 0) + '/targetValue/set'
        if (action == "TOGGLE") action = this.getValue() == "ON" ? "OFF" : "ON";
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
                    this.logger.debug('Status for ' + this.def.id + ' has gone stale, poking it')
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

class Extender extends Thing {
    constructor(id, def) {
        super(id, def)
        this.status = ThingStatus.ignored
        this.lastValue = undefined
        god.whiteboard.addCallback('extender.output', this.onExtenderUpdate.bind(this))
    }

    get json() {
        return { ...super.json,
        }
    }
    
    getValue() { return this.lastValue }
    
    /** called from extender.js when an output is changed */
    onExtenderUpdate(extIdx, extValue) {
        if (extIdx != this.def.extenderOutputId) return
        let translatedValue = extValue == 1 ? 'ON' : 'OFF'
        let propagateChange = this.lastValue != translatedValue
        this.lastValue = translatedValue
        this.lastUpdated = new Date() // update timestamp even if the value is unchanged
        this.setstatus(ThingStatus.alive, !propagateChange)
        if (propagateChange) {
            god.onThingChanged.forEach(cb => cb(this))
        }
    }

    onAction(action) {
        let value = action == 'ON' ? 1 : 0
        this.logger.info('Action for %s (%o): set output idx %s to "%s"', this.def.id, action, this.def.extenderOutputId, value)
        god.whiteboard.getCallbacks('extender.setOutput').forEach(cb => cb(this.def.extenderOutputId, value))
    }

// TODO
    checkAlive(now) {
    }

    poke(now) { 
    }
}

class CompositeThing extends Thing {
    constructor(id, def) {
        super(id, def)
    }
    
    init() {
        this.def.things.filter(thingRef => !god.things[thingRef.id]).forEach(thingRef => this.logger.error('Composite thing ' + this.id + ': reference to thing ' + thingRef.id + ' not found. Ignoring.'))
        this.def.things = this.def.things.filter(thingRef => god.things[thingRef.id])
        god.onThingChanged.push(this.onThingChanged.bind(this))
    }
    
    onThingChanged(thing) {
        // check if the changed thing is one of ours
        if (this.def.things.filter(thingRef => thingRef.id == thing.id).length == 0) return
        this.logger.debug('Composite thing %s: watched thing changed: %s', this.id, thing.id) 
        this.checkAlive()
        god.onThingChanged.forEach(cb => cb(this))
    }

    getValue() {
        let displayText = [ ]
        for(let ref of this.def.things) {
            let refThing = god.things[ref.id].json
            if (ref.display) {
                for(let d of ref.display) {
                    if (d.value != refThing.value) continue
                    let condition = true
                    if (d.condition == 'single') {
                        condition = this.def.things.filter(thingRef => thingRef.id != ref.id).map(thingRef => god.things[thingRef.id].json ).every(thing => thing.value != d.value)
                    }
                    if (condition) displayText.push(d.text)
                }
            } else { // no display condition defined
                displayText.push(refThing.value)
            }
        }
        // deduplication: if all values are the same
        if (displayText.length > 0 && displayText.every(text => text == displayText[0])) displayText = [ displayText[0] ]
        if (displayText.length == 0) displayText.push('OFF')
        return displayText.join(' / ')
        
/*        
        let values = this.def.things.map(thingRef => god.things[thingRef.id].json )
        let value = values[0]
        if (values.filter(v => v.value != value).length == 0) value = values[0]
        else if (values.filter(v => v.value != 'OFF').length == 0) value = 'OFF'
        else value = values.map(v => v.value).join(' / ')
        return value
*/
    }

    get json() {
        return { ...super.json,
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

class ThingInfoBox {
    constructor(id, def) {
        this.logger = logger
        this.def = def
        if (this.def.id != id) logger.error('Thing id doesn\'t match definition id, something will probably fail somewhere') // TODO
        god.onSensorUpdated.push(this.onSensorUpdated.bind(this))
        this.updateInfobox()
    }
    
    onSensorUpdated(id, oldValue, newValue) {
        if (id) {
            this.updateInfobox()
        }
    }
    
    updateInfobox() {
        let co2 = god.sensors?.['sensor1']?.value?.['SCD30']?.CarbonDioxide ?? '?'
        let hum = god.sensors?.['sensor1']?.value?.['BME280-77']?.Humidity ?? '?'
        let temp = god.sensors?.['sensor2']?.value?.['DS18B20-8']?.Temperature ?? '?'
        let sunsetText = god.sensors?.['sun-sunfilter']?.value?.value ?? '?'
        let sunsetTitle = god.sensors?.['sun-sunfilter']?.value?.precise ?? '?'
        let infobox = { id: 'main', data: [ 'Temp: ' + temp + '°C', 'Hum: ' + hum + '%H', 'CO2: ' + co2 + ' ppm', '<span title="' + sunsetTitle + '">' + sunsetText + '</span>' ] }
        god.whiteboard.getCallbacks('thingInfobox').forEach(cb => cb(infobox))
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
        // set defaults
        Object.keys(this.scenarioDefinitions).forEach(id => {
            this.scenarioDefinitions[id].id = id
            if (!this.scenarioDefinitions[id].hide) this.scenarioDefinitions[id].hide = []
            if (!this.scenarioDefinitions[id].unhide) this.scenarioDefinitions[id].unhide = []
        })
        // merge included scenarios together
        Object.keys(this.scenarioDefinitions).forEach(id => {
            if (this.scenarioDefinitions[id].include) {
                let includedScenarioId = this.scenarioDefinitions[id].include
                let includedScenario = this.scenarioDefinitions[includedScenarioId]
                this.scenarioDefinitions[id].things = { ...includedScenario.things, ...this.scenarioDefinitions[id].things }
                this.scenarioDefinitions[id].hide = [ ...includedScenario.hide, ...this.scenarioDefinitions[id].hide ]
                this.scenarioDefinitions[id].unhide = [ ...includedScenario?.unhide, ...this.scenarioDefinitions[id]?.unhide ]
                this.scenarioDefinitions[id].hide = this.scenarioDefinitions[id].hide.filter(name => this.scenarioDefinitions[id].unhide.indexOf(name) == -1)
            }
        })
        Object.values(this.thingDefinitions).forEach(def => this.createThing(def)) // create all the things
        Object.values(god.things).forEach(thing => thing.init()) // initializes all the things
        this.timerid = setInterval(() => {
            let now = new Date()
            Object.values(god.things).forEach(thing => thing.checkAlive(now))
        }, Thing.staleCheckIntervalMs)
        god.mqtt.addTrigger(this.mqttTopic, 'thingCurrentScenario', this.onMqttMessage.bind(this))
        
        let infobox = new ThingInfoBox('main', {
            id: 'main'
        })
    },

    async onMqttMessage(trigger, topic, message, packet) {
		let msg = message.toString()
        this.logger.info('Received mqtt thingCurrentScenario "' + msg + '"')
        let result = await this.setCurrentScenario(msg)
    },

    // Creates a 'thing' instance based on the 'def'inition from the configuration
    createThing: function(def) {
        if (def.disabled) {
            this.logger.error('Thing %s is disabled', def.id)
            return
        }
        if (def.api == 'tasmota') {
            god.things[def.id] = new TasmotaSwitch(def.id, def)
        } else if (def.api == 'tasmotaStrip') {
            god.things[def.id] = new TasmotaStrip(def.id, def)
        } else if (def.api == 'tasmotaSensor') {
            god.things[def.id] = new TasmotaSensor(def.id, def)
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
        } else if (def.api == 'extender') {
            god.things[def.id] = new Extender(def.id, def)
        } else if (def.api == 'zigbee2mqtt') {
            god.things[def.id] = new Zigbee2Mqtt(def.id, def)
        } else if (def.api == 'AIonEdge') {
            god.things[def.id] = new AIonEdge(def.id, def)            
        } else if (def.api == 'WLED') {
            god.things[def.id] = new WLED(def.id, def)            
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
            this.logger.info('thingCurrentScenario is already "' + id + '", ignored')
            return 'thingCurrentScenario is already "' + id + '", ignored'
        }
        if (this.scenarioDefinitions[id]) {
            this.currentScenario = this.scenarioDefinitions[id]
            this.logger.info('Changed thingCurrentScenario to ' + id)
            // update all things, as their scenario expecation might be changed
            Object.values(god.things).forEach(thing => god.onThingChanged.forEach(cb => cb(thing)))
            god.whiteboard.getCallbacks('thingCurrentScenario').forEach(cb => cb(this.currentScenario))
            return 'thingCurrentScenario set to "' + id + '"'
        } else {
            this.logger.warn('thingCurrentScenario: unknown scenario id "' + id + '" ignored')
            return 'thingCurrentScenario: unknown scenario id "' + id + '" ignored'
        }
    },
    
    /** Gets called from clients (websocket), expects the thing id and action with thing-specific commands */
    onAction: function(id, action) {
        let thing = god.things[id]
        if (!thing) {
            this.logger.error("onAction: thing id '%s' not found", id)
            return
        }
        this.logger.debug('onAction for %s (%s): %o', id, thing.def.name, action)
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
