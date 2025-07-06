#!/usr//bin/node

/* This is oldgrag - only used for the POS
*/


const app = require('express')()
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const Q = require('q')
const {promisify} = require('util')
const base64 = require('base-64')
const dict = require("dict")
const to = require('await-to-js').default
const winston = require('winston')
const { exec } = require("child_process")
const socketIo = require('socket.io')
const dns = require('dns')
const moment = require('moment')
const yaml = require('js-yaml')
const util = require('util')
const exec2 = util.promisify(require('child_process').exec);

// Warning: async loading
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))

console.log('Press <ctrl>+C to exit.')

let sConfigFile = 'prod.yaml'
console.log("Loading config " + sConfigFile)
let config = yaml.load(fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf8'))

var isTerminated = false
async function terminate(errlevel) {
	if (isTerminated) {
		console.error("Quick kill")
		process.exit(errlevel)
	}
	isTerminated = true
	await Promise.all(god.preterminateListeners.map(async listener => { 
		try { 
			await listener() 
		} catch (e) {
			if (this.logger) { this.logger.error("Exception during pre-terminate callback: %o", e) } else { console.log("Exception during pre-terminate callback: ", e) }
		}
	}))
	await Promise.all(god.terminateListeners.map(async listener => { 
		try { 
			await listener() 
		} catch (e) {
			if (this.logger) { this.logger.error("Exception during terminate callback: %o", e) } else { console.log("Exception during terminate callback: ", e) }
		}
	}))
    process.nextTick(function () { process.exit(errlevel) })
}

var god = {
	preterminateListeners: [],
	terminateListeners: [],
	terminate: terminate,
	ioSocketList: {},
	ioBase: {}, // io,
	io: {}, // io.of('/browser'),
	ioOnConnected: [],
	state: {},
    things: {},
    thingController: undefined,
	sensors: {},
	historicValueCache: {},
	onStateChanged: [],
	onThingChanged: [],
	onSensorUpdated: [],
	onHistoricValueUpdated: [],
	config: config,
	app: app,
	serverRunningSince: new Date(),
}

god.whiteboard = {
    _callbacks: {},
    addCallback: function(name, cb) {
        if (!this._callbacks[name]) this._callbacks[name] = []
        this._callbacks[name].push(cb)
    },
    getCallbacks: function(name) {
        return this._callbacks[name] ? this._callbacks[name] : []
    },
}

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    console.log("Bye, Bye...")
	terminate(0)
})

process.on('error', (err) => {
	console.error(config.name + ": Unhandled error, terminating")
	console.error(err)
    terminate(0)
})

process.on('unhandledRejection', (reason, promise) => {
	if (logger) logger.error(config.name + ": Unhandled Async Rejection at %o, reason %o", promise, reason)
    else console.error(config.name + ": Unhandled Async Rejection at", promise, "reason", reason)
    terminate(0)
})


function addNamedLogger(name, level = 'debug', label = name) {
    let { format } = require('logform');
	let prettyJson = format.printf(info => {
	  if (info.message.constructor === Object) {
		info.message = JSON.stringify(info.message, null, 4)
	  }
	  return `${info.timestamp} [${info.level}]\t[${info.label}]\t${info.message}`
	})
	let getFormat = (label, colorize = false) => {
		let nop = format((info, opts) => { return info })
		return format.combine(
			colorize ? format.colorize() : nop(),
			format.timestamp({
				format: 'YYYY-MM-DD HH:mm:ss',
			}),
			format.label({ label: label }),
			format.splat(),
			prettyJson
			)
	}
	winston.loggers.add(name, {
	  level: level,
	  transports: [
		new winston.transports.Console({
			format: getFormat(label, true),
		}),
		new winston.transports.File({ 
			format: getFormat(label, false),
			filename: 'winston.log'
		})
	  ]
	})
}

// prepareNamedLoggers
(()=>{
	Object.keys(config.logger).forEach(name => {
		let level = config.logger[name]
		addNamedLogger(name, level)
	})
})()


const logger = winston.loggers.get('main')
logger.info(config.name + ' waking up and ready for service')

const mqtt = require('./mqtt')(config.mqtt, god)
god.mqtt = mqtt

const displayPos = require('./POS-receiver')(god, 'POS', 'grag-POS/')

