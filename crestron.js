/* Crestron Room Controller
 */

const winston = require('winston')
const net = require('net');

function hexStringToBuffer(hex) {
    return Buffer.from(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
}

class Crestron {
    god = undefined
    logger = undefined
    isConnected = false
    client = undefined
    state = undefined
    scenario = undefined
    
    constructor(god, logger) {
        this.god = god
        this.logger = logger
        this.client = new net.Socket()
        this.client.on('data', this.c_received.bind(this))
        this.client.on('close', this.c_closed.bind(this))
        this.client.on('error', this.c_error.bind(this))
    }
    
    connect() {
        this.logger.info("Connecting to %s:%s", this.god.config.crestron.host, this.god.config.crestron.port)
        this.isConnected = false
        this.state = 0
        this.client.connect(this.god.config.crestron.port, this.god.config.crestron.host, this.c_connected.bind(this))
    }
    
    c_connected() {
        this.isConnected = true
        this.logger.debug("Connected")
    }
    
    c_closed() {
        this.isConnected = false
        this.logger.debug("Connection closed")
    }
    
    c_error(err) {
        this.isConnected = false
        this.logger.debug("Connection error: %s", err)
    }
    
    enable_grag() {
        this.scenario = 'grag'
        this.connect()
    }

    disable_grag() {
        this.scenario = 'nograg'
        this.connect()
    }

    c_received(data_bytes) {
        let data = data_bytes.toString('hex')
        this.logger.debug("Received: %s", data);

        this.state++;
        let hexString = ""
        let notExpect = ""
        let expect = '0f000102' // initial server welcome message. '0f000101' during bootup

        if (this.state == 1) {
            hexString = '01000b00000000000140fffff101'; // say hello
            expect =    '0200040000001f'
            notExpect = '040004ffff0002' // during bootup
        } else if (this.state == 0) {
            hexString = '0500050000020300'; // get config
        } else if (this.state == 0) {
            hexString = '050006000003279c13'; // switch off Grag
        } else if (this.state == 0) {
            hexString = '050006000003275c12'; // switch Relais 1 off
            expect = '050006000003008492'
        } else if (this.state == 0) {
            hexString = '050006000003277012'; // switch Relais 1 on
            expect = '050006000003008412'
        } else if (this.state == 2) {
            if (this.scenario == 'grag') {
                hexString = '05000600000327a313'; // switch dm3 to AirMedia
                hexString += '050006000003279d13'; // switch dm3 to Grag
                expect = '050006000003009d93'
            } else {
                hexString = '050006000003279d13'; // switch dm3 to Grag
                hexString += '05000600000327a313'; // switch dm3 to AirMedia
            }
        } else if (this.state == 3) {
            hexString = '050006000003279402'; // Audio menu
            expect = '05000600000300a313'
        } else if (this.state == 4) {
            hexString = '050006000003275009'; // Digital Audio menu
            expect = '050006000003009d13'
        } else if (this.state == 5) {
            hexString = '050006000003272413'; // Dropdown  Input Digital1
            expect = '05000600000300a393'
        } else if (this.state == 6) {
            if (this.scenario == 'grag') {
                hexString = '05000e00000b3800000027051400000004'; // Audio3 auf mixer1
                expect =    '050006000003003987'
//                          '050006000003002707' + '050006000003002787' (...004)
            } else {
                hexString = '05000e00000b3800000027051400000005'; // (something else?)
//                          '050006000003003987' + '050006000003003d83' (...005)
            }
        } else if (this.state == 7) {
            hexString = '050006000003273b13'; // Dropdown  Input DM3
            expect = '050006000003003d83'
        } else if (this.state == 8) {
            hexString = '05000e00000b3800000028051400030002'; // Mixer 1 auf DM3 legen
            expect = '12004a00000046340062037b687265662075726c3d222e2f48656c702f696e6465782e68746d23417564696f2f416e616c6f675f496e7075745f436f6e66696775726174696f6e2e68746d227d'
        } else if (this.state == 9) {
            hexString = '050006000003273d03'; // back to mainscreen
            expect = '050006000003002707' +
                     '050006000003002787'
        } else {
            this.client.resetAndDestroy()
        }


        if (hexString) {
            const buffer = hexStringToBuffer(hexString);
            this.client.write(buffer, () => {
                this.logger.debug("Sent %s: %s", this.state, hexString)
            });
        }

    }
}

module.exports = function(god, loggerName = 'Crestron') { 
	var self = {
        
    /** Class Attributes */
    mqttTopic: 'crestron',
    client: new net.Socket(),
    crestron: undefined,


    /** init function, called (explicitely at the end of this file) when this object is required from the main file
     * No parameters here - put those in the module.exports function instead.
     */
    init: function() {
        this.logger = winston.loggers.get(loggerName)
        this.crestron = new Crestron(god, this.logger)
        god.mqtt.addTrigger(this.mqttTopic + '/#', 'crestron', this.onMqttMessage.bind(this))
    },
    
    async onMqttMessage(trigger, topic, message, packet) {
		let value = message.toString()
        this.logger.debug('Received mqtt %s: %s', topic, value)
        let pathSegments = topic.split('/')
        if (pathSegments[0] != 'crestron') return
        
        if (pathSegments[1] == 'scenario') {
            if (value == 'grag') {
                this.logger.info("MQTT: Scenario 'grag' started")
                this.crestron.enable_grag()
            } else if (value == 'nograg') {
                this.logger.info("MQTT: Scenario 'nograg' started")
                this.crestron.disable_grag()
            } else {
                this.logger.warning("MQTT: Scenario '%s' unknown", value)
            }
        } else {
            this.logger.warning("MQTT: commend unrecognized: %s", topic)
        }
    },
    
}
    self.init()
    return self
}
