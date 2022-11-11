#!/usr//bin/node
const wtf = require('wtfnode')

const winston = require('winston')
const sleep = ms => new Promise(r => setTimeout(r, ms))

let config = {
	"mqtt": {
		"server": "mqtt://grag.fritz.box",
		"clientId": "misan.js",
	},
	"logger": {
		"main": "debug",
		"mqtt": "warn",
    },
    "led": {
        "topic": undefined,
    }
}

var isTerminated = false
async function terminate(errlevel) {
	if (isTerminated) {
		console.error("Quick kill")
		process.exit(errlevel)
	}
	isTerminated = true
	await Promise.all(god.terminateListeners.map(async listener => { 
		try { 
			await listener() 
		} catch (e) {
			if (this.logger) { this.logger.error("Exception during terminate callback: %o", e) } else { console.log("Exception during terminate callback: ", e) }
		}
	}))
    process.nextTick(function () { process.exit(errlevel) })
}

async function softTerminate() {
	await Promise.all(god.terminateListeners.map(async listener => { 
		try { 
			await listener() 
		} catch (e) {
			if (this.logger) { this.logger.error("Exception during terminate callback: %o", e) } else { console.log("Exception during terminate callback: ", e) }
		}
	}))
    // still here?
    wtf.dump()
}

var god = {
	terminateListeners: [],
	terminate: terminate,
}

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    console.log("Bye, Bye...")
	terminate(0)
})

process.on('error', (err) => {
	console.error("Grag: Unhandled error, terminating")
	console.error(err)
    terminate(0)
})

process.on('unhandledRejection', (reason, promise) => {
	logger.error("Grag: Unhandled Async Rejection at %o, reason %o", promise, reason)
	console.error("Grag: Unhandled Async Rejection at", promise, "reason", reason)
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
const mqtt = require('./mqtt')(config.mqtt, god)
god.mqtt = mqtt

let MISAN = []
const MISAN_MAX_SIZE = 500
const UNKNOWN_FX_ERROR_MARKER = -1

const seg_defaults = {
    start: 0,
    length: 0,
    type: 0,
    power_selector: 0,
    dimm_channel: 0,
    disabled: false,
    blackout: true,
    linear: {
        speed: 0,
        px_offset: 0,
        px_dimm: 128,
        circle_speed: 0,
        circle_offset: 0,
        color_table_idx: 0,
        color_offset: 0,
    },
    copy: {
        boundary_mode: 0,
        start: 0,
        length: 0,
        type: 0,
        param: 0,
    },
    singlecolor: {
        r: 0,
        g: 0,
        b: 0,
    },
    white: {
        active_selector: 0,
        balance_channel: 0,
    },
}


let sendByte = (idx, value) => { mqtt.client.publish('cmnd/' + config.led.topic + '/dragon15', '' + ((idx << 16) + (value & 0xFF))) }
let sendWord = (idx, value) => { mqtt.client.publish('cmnd/' + config.led.topic + '/dragon15', '' + (((8192 + idx) << 16) + (value & 0xFFFF))) }
let sendCmd = (cmdIdx, value) => { mqtt.client.publish('cmnd/' + config.led.topic + '/' + cmdIdx, value) }

var addDataNextIdx = 0
let setByte = (idx, value) => { MISAN[idx] = value & 0xFF }
let setWord = (idx, value) => { MISAN[idx] = value & 0xFF; MISAN[idx+1] = (value >> 8) & 0xFF; }
let setStartIdx = (idx) => addDataNextIdx = idx
let addByte = (value) => { setByte(addDataNextIdx, value); addDataNextIdx++; }
let addWord = (value) => { setWord(addDataNextIdx, value); addDataNextIdx+=2; }

// Always keep in sync with drgn_misan_segSizeByType in Tasmota xlgt_01_ws2812.ino
let drgn_misan_segSizeByType = [ 1, 6, 14, 17, 14, 9, 8 ];

let setSegment = (idx, seg) => {
    setStartIdx(idx)
    let endSegment = (seg.type == 0)
    addByte(seg.type)
    if (endSegment) {
        logger.debug('setSegment: END MARKER')
        // last segment is cut short
    } else {
        logger.debug('setSegment: segment type %d (start %d, length %d -> %d) at index %d', seg.type, seg.start, seg.length, seg.start + seg.length, idx)
        addWord(seg.start)
        addWord(seg.length)
        let control = (seg.power_selector & 0b111) + ((seg.dimm_channel & 0b11) << 3) + ((seg.disabled ? 1 : 0) << 5) + ((seg.blackout ? 1 : 0) << 6)
        addByte(control)
    }
    
    if (endSegment) {
        // end segment is cut short
    } else if (seg.type == 1) { // Black
    } else if (seg.type == 2 || seg.type == 3) { // Linear & Circle
        addWord(seg.linear.speed)
        addByte(seg.linear.px_offset)
        addByte(seg.linear.px_dimm)
        addWord(seg.linear.color_table_idx)
        addWord(seg.linear.color_offset)
        if (seg.type == 3) {
            addWord(seg.linear.circle_speed)
            addByte(seg.linear.circle_offset)
        }
    } else if (seg.type == 4) { // Copy
        addByte(seg.copy.boundary_mode)
        addWord(seg.copy.start)
        addWord(seg.copy.length)
        addByte(seg.copy.type)
        addWord(seg.copy.param)
    } else if (seg.type == 5) { // single color
        addByte(seg.singlecolor.r)
        addByte(seg.singlecolor.g)
        addByte(seg.singlecolor.b)
    } else if (seg.type == 6) { // white
        addByte(seg.white.active_selector)
        addByte(seg.white.balance_channel)
    } else { // unknown
        logger.error("WARNING: unknown segment type %d, can't estimate size needed", seg.type)
        return UNKNOWN_FX_ERROR_MARKER
    }
    let expectLength = drgn_misan_segSizeByType[seg.type]
    if (idx + expectLength != addDataNextIdx) {
        logger.error("Internal Error: length calculation seems wrong -> idx + expectLength = addDataNextIdx evaluates to %d + %d = %d", idx, expectLength, addDataNextIdx)
        return UNKNOWN_FX_ERROR_MARKER
    }
    return true
}

function addSegment(seg) {
    let result = setSegment(addDataNextIdx, seg)
    if (result != UNKNOWN_FX_ERROR_MARKER && addDataNextIdx > MISAN_MAX_SIZE) { // equal would be ok
        logger.error("WARNING: too much data - %d available, %d used", MISAN_MAX_SIZE, addDataNextIdx)
    }
}

function endSegment () {    
    addSegment({ start: 0, length: 0, type: 0 })
}

let setColorTable = (idx, colortable) => {
    if (idx < addDataNextIdx) {
        logger.error("setColorTable: Colortable overwrites segment data: %d < %d", idx, addDataNextIdx)
    }
    if (idx > addDataNextIdx) {
        logger.info("setColorTable: Colortable leaves %d bytes unused space after segment data: %d > %d", idx - addDataNextIdx, idx, addDataNextIdx)
    }
    lensum_total = colortable.map(entry => entry.len).reduce((lensum, len) => lensum + len, 0)
    logger.debug('setColorTable: idx=%d, length=%d (lensum %d)', idx, colortable.length, lensum_total)
    setStartIdx(idx)
    addByte(colortable.length)
    addWord(lensum_total)
    let lensum = 0
    for(let i=0; i<colortable.length; i++) {
        let entry = colortable[i]
        addByte(entry.r)
        addByte(entry.g)
        addByte(entry.b)
        addWord(entry.len)
        addWord(lensum)
        lensum += entry.len
    }
}

function addColorTable(colortable) {
    setColorTable(addDataNextIdx, colortable)
    if (addDataNextIdx > MISAN_MAX_SIZE) { // equal would be ok
        logger.error("WARNING: too much data - %d available, %d used", MISAN_MAX_SIZE, addDataNextIdx)
    }
}

let sendMISAN = async () => {
    for(let idx=0; idx<MISAN.length; idx+=2) {
        sendWord(idx, MISAN[idx] + (MISAN[idx+1] << 8))
        await sleep(10) // not sure if necessary
    }
}

let printfMISAN_Code = (misan = MISAN) => {
    return '{ ' + misan.map(val => '0x' + (val < 16 ? '0' : '') + val.toString(16)).join(', ') + ' };'
}

function printTemplateString(misan) {
    let str = 'uint8_t new_misan[] = ' + printfMISAN_Code(misan)
    console.log(str)
}

let sendMISAN_Base64 = async () => {
    // TODO use a Buffer or something
}

function readMISANFromCode(code) {
    code = code.trim()
    MISAN = []
    if (code.slice(-1) == ';') code = code.slice(0, -1).trim()
    if (code == "") return
    if (code[0] != '{') { logger.error("Failed to parse MISAN code: no opening parantheses"); return }
    if (code.slice(-1) != '}') { logger.error("Failed to parse MISAN code: no closing parantheses"); return }
    code = code.slice(1, -1).trim()
    MISAN = code.split(',').map(x => parseInt(x))
}

function parseMISAN(misan, version = 3) {
    // version 1: old
    // version 2: added "control" byte
    // version 3: dynamic length, seg.type++, field reordering
    logger.debug("Parsing MISAN protocol version %d", version)
    
    let getByte = (idx) => misan[idx]
    let getWord = (idx) => misan[idx] + (misan[idx+1] << 8)
    let nextReadIdx = 0
    let getNextByte = () => { let res = getByte(nextReadIdx); nextReadIdx++; return res }
    let getNextWord = () => { let res = getWord(nextReadIdx); nextReadIdx+=2; return res }
    
    let parseSegment = (idx) => {
        nextReadIdx = idx
        let colorTableIdx = undefined
        let nextIdx = undefined
        let seg = {}
        if (version == 3) {
            seg.type = getNextByte()
            if (seg.type != 0) {
                seg.start = getNextWord()
                seg.length = getNextWord()
            }
        } else {
            seg = {
                start: getNextWord(),
                length: getNextWord(),
                type: getNextByte(),
            }
            seg.type++
        }
        if (version < 2 || seg.type == 0) {
        } else {
            let control = getNextByte()
            seg.power_selector = control & 0b111
            seg.dimm_channel = (control >> 3) & 0b11
            seg.disabled = (control >> 5) == 1
            seg.blackout = (control >> 6) == 1
        }
        if (seg.type == 2 || seg.type == 3) {
            if (version <= 2) {
                seg.linear = {
                    speed: getNextWord(),
                    px_offset: getNextByte(),
                    px_dimm: getNextByte(),
                    circle_speed: getNextWord(),
                    circle_offset: getNextByte(),
                    color_table_idx: getNextWord(), 
                    color_offset: getNextWord(),
                }
            } else {
                seg.linear = {
                    speed: getNextWord(),
                    px_offset: getNextByte(),
                    px_dimm: getNextByte(),
                    color_table_idx: getNextWord(), 
                    color_offset: getNextWord(),
                }
                if (seg.type == 3) {
                    seg.linear.circle_speed = getNextWord()
                    seg.linear.circle_offset = getNextByte()
                }
            }
            colorTableIdx = seg.linear.color_table_idx
            nextIdx = idx + (version == 1 ? 16 : version == 2 ? 17 : seg.type == 2 ? 14 : 17)
        } else if (seg.type == 4) {
            seg.copy = {
                boundary_mode: getNextByte(),
                start: getNextWord(),
                length: getNextWord(),
                type: getNextByte(),
                param: getNextWord(),
            }
            if (version == 1) { getNextWord(); getNextByte() }
            nextIdx = idx + (version == 1 ? 16 : 14)
        } else if (seg.type == 5) {
            seg.singlecolor = {
                r: getNextByte(),
                g: getNextByte(),
                b: getNextByte(),
            }
            nextIdx = idx + (version == 1 ? 16 : 9)
        } else if (seg.type == 6) {
            seg.white = {
                active_selector: getNextByte(),
                balance_channel: getNextByte(),
            }
            nextIdx = idx + (version == 1 ? 16 : 8)
        } else {
            if (seg.type == 0 && version == 3) {
                // last one, content is ignored
                nextIdx = idx + 1
            } else if (version < 3 && seg.start == 0 && seg.length == 0) {
                // last one, content is ignored
                seg.type = 0
                nextIdx = idx + 5
            } else {
                logger.error('Failed to parse MISAN: effect ' + seg.type + ' unknown')
                seg.error = 'Failed to parse MISAN: effect ' + seg.type + ' unknown'
                nextIdx = undefined
            }
        }
        if (seg.type == 0) {
            logger.debug('parseMISAN: at index %d, END MARKER', idx)
        } else {
            let c = (typeof colorTableIdx === 'undefined') ? '' : ' - expecting color table at index ' + colorTableIdx
            logger.debug('parseMISAN: at index %d, segment type %d (start %d, length %d -> %d)%s', idx, seg.type, seg.start, seg.length, seg.start + seg.length, c)
        }
        if (nextIdx != nextReadIdx) {
            logger.error("Failed to parse MISAN (internal error): for segment type %d, starting at %d, calculated nextIdx != counted nextReadIdx -> %d != %d", seg.type, seg.start, nextIdx, nextReadIdx)
        }
        if (version >= 3)
            if (nextReadIdx != idx + drgn_misan_segSizeByType[seg.type]) {
                logger.error("Failed to parse MISAN (internal error): for segment type %d, starting at %d, calculated id of segment size != counted nextReadIdx -> %d + %d != %d", seg.type, seg.start, idx, drgn_misan_segSizeByType[seg.type], nextReadIdx)
            }
        return { seg: seg, nextIdx: nextIdx, colorTableIdx: colorTableIdx } 
    }
    let parseColorTable = (idx) => {
        nextReadIdx = idx
        let table_length = getNextByte()
        let claimed_lensum_total = getNextWord()
        let lensum = 0
        colortable = []
        idx += 3
        for(let i=0; i<table_length; i++) {
            let entry = {
                r: getNextByte(),
                g: getNextByte(),
                b: getNextByte(),
                len: getNextWord(),
            }
            let claimed_lensum = getNextWord()
            if (lensum != claimed_lensum) {
                entry.error = 'Lensum wrong, given: ' + claimed_lensum + ', calculated: ' + lensum
            }
            idx += 7
            lensum += entry.len
            colortable.push(entry)
        }
        if (lensum != claimed_lensum_total) {
            if (colortable.length == 0) colortable = [{}]
            colortable[0].error = 'total Lensum wrong, given: ' + claimed_lensum_total + ', calculated: ' + lensum
        }
        if (idx != nextReadIdx) {
            logger.error("Failed to parse MISAN colortable: idx != nextReadIdx -> %d != %d", idx, nextReadIdx)
        }
        return colortable
    }
    
    let segments = []
    let cTableIdxs = {}
    let currentIdx = 0
    do {
        let {seg, nextIdx, colorTableIdx} = parseSegment(currentIdx)
//        logger.debug(seg, nextIdx, colorTableIdx)
        segments.push(seg)
        if (colorTableIdx) cTableIdxs[colorTableIdx] = colorTableIdx
        if (!nextIdx) break
        currentIdx = nextIdx
        if (seg.type == 0) break
    } while (true)
    let cTables = Object.values(cTableIdxs).map(idx => ({ idx: idx, table: parseColorTable(idx) })).reduce((a, b) => { let c = Object.keys(a).length; a[String.fromCharCode(65+c)] = b; return a }, {})

    for(let i=0; i<segments.length; i++) {
        seg = segments[i]
        if (seg.type == 2 || seg.type == 3) {
            if (Number.isInteger(seg.linear.color_table_idx)) {
                let candidates = Object.keys(cTables).filter(key => cTables[key].idx == seg.linear.color_table_idx)
                if (candidates.length == 1) {
                    seg.linear.color_table_idx = candidates[0]
                } else {
                    logger.error('Failed to parse MISAN: segment %d (type %d) expects colortable at index %d, but we don\'t have them', i, seg.type, seg.linear.color_table_idx)
                }
            }
        }
    }
    
    return { segments: segments, cTables: cTables, lastSegmentIdx: currentIdx }
}

function setMISAN(segments, cTables) {
    logger.info('Compiling JSON with %d segments, %d color tables to MISAN', segments.length, Object.keys(cTables).length)
    // add end segment if not present
    if (segments.length == 0 || segments[segments.length-1].type != 0) {
        segments.push( { type: 0 } )
    }
    
    // no entry in the length table -> invalid segment type
    let invalidSegments = segments.filter(seg => !drgn_misan_segSizeByType[seg.type])
    if (invalidSegments.length) {
        logger.error("Invalid segment types: %o", invalidSegments)
        return
    }
    // calculate the combined length of the segments
    let totalLength = segments.map(seg => drgn_misan_segSizeByType[seg.type]).reduce((a, b) => a + b, 0)
    // calculate and set idx for the color tables
    Object.keys(cTables).forEach(key => {
        let len = 3 + cTables[key].table.length * 7
        cTables[key].idx = totalLength
        totalLength += len
    })
    
    // insert color tabe index into effects
    for(let i=0; i<segments.length; i++) {
        let seg = segments[i]
        if (seg.type == 2 || seg.type == 3) {
            let a = seg.linear.color_table_idx
            if (!Number.isInteger(a)) {
                if (!cTables[a]) {
                    logger.error('Effect %d of type %d references color table "%s", but it\'s unknown', i, seg.type, a)
                    return
                }
                seg.linear.color_table_idx = cTables[a].idx
            }
        }
    }
    
    // Finally, set everything
    MISAN = []
    setStartIdx(0)
    segments.forEach(seg => addSegment(seg))
    Object.values(cTables).forEach(table => setColorTable(table.idx, table.table))
}

function test() {
    logger.warn('test pattern activated')
    
    let seg = {
        start: 0,
        length: 12,
        type: 5,
        singlecolor: {
            r: 0,
            g: 20,
            b: 0,
        },
/* acceptable values?
        linear: {
            speed: 500,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: 250,
            circle_offset: 0,
            color_table_idx: 'A',
            color_offset: 0,
        },
*/
        linear: {
            speed: 100,
            px_offset: 50,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_idx: 'A',
            color_offset: 0,
        },
    }

    let seg_copy = {
            start: 12,
            length: 4,
            type: 4,
            copy: {
                boundary_mode: 12,
                start: 0,
                length: 12,
                type: 2,
                param: 128,
        }
    }

    let segments = [ seg, seg_copy ]

    let cTables = { 'A': { table: [
/*
        { r: 0x80, g: 0x00, b: 0x00, len: 200 },
        { r: 0x80, g: 0x80, b: 0x00, len: 200 },
        { r: 0x00, g: 0x80, b: 0x00, len: 200 },
        { r: 0x00, g: 0x80, b: 0x80, len: 200 },
        { r: 0x00, g: 0x00, b: 0x80, len: 200 },
        { r: 0x80, g: 0x00, b: 0x80, len: 200 },
/**/
        { r: 0x40, g: 0x00, b: 0x00, len: 50 },
        { r: 0x40, g: 0x00, b: 0x00, len: 0 },
        { r: 0x20, g: 0x00, b: 0x00, len: 50 },
        { r: 0x20, g: 0x00, b: 0x00, len: 0 },
        { r: 0x00, g: 0x10, b: 0x00, len: 50 },
        { r: 0x00, g: 0x10, b: 0x00, len: 0 },
        { r: 0x00, g: 0x20, b: 0x00, len: 50 },
        { r: 0x00, g: 0x20, b: 0x00, len: 0 },
        { r: 0x00, g: 0x40, b: 0x00, len: 50 },
        { r: 0x00, g: 0x40, b: 0x00, len: 0 },
        { r: 0x00, g: 0x20, b: 0x00, len: 50 },
        { r: 0x00, g: 0x20, b: 0x00, len: 0 },
        { r: 0x00, g: 0x00, b: 0x10, len: 50 },
        { r: 0x00, g: 0x00, b: 0x10, len: 0 },
        { r: 0x00, g: 0x00, b: 0x20, len: 50 },
        { r: 0x00, g: 0x00, b: 0x20, len: 0 },
        { r: 0x00, g: 0x00, b: 0x40, len: 50 },
        { r: 0x00, g: 0x00, b: 0x40, len: 0 },
        { r: 0x00, g: 0x00, b: 0x20, len: 50 },
        { r: 0x00, g: 0x00, b: 0x20, len: 0 },
        { r: 0x10, g: 0x00, b: 0x00, len: 50 },
        { r: 0x10, g: 0x00, b: 0x00, len: 0 },
        { r: 0x20, g: 0x00, b: 0x00, len: 50 },
        { r: 0x20, g: 0x00, b: 0x00, len: 0 },
//*/
    ]}}

    setMISAN(segments, cTables)
}

// how many leds offset we need to get from led index 0 to the "led on the upper side of the circle" (based on measurement of Dancer hardware)
var DANCER_OFFSET = [4, 5, 3, 10, 9, 10]

function dancer() {
    logger.warn('Dancer activated')
    
    let color_table_idx = 13*17 -34 // just after all segments
    
    let seg_outer = (idx, offset) => ({
        start: idx * 16,
        length: 12,
        type: 3,
        linear: {
            speed: 10,
            px_offset: 20,
            px_dimm: 128,
            circle_speed: 250,
            circle_offset: DANCER_OFFSET[idx],
            color_table_idx: color_table_idx,
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        start: idx * 16 + 12,
        length: 4,
        type: 4,
        copy: {
            boundary_mode: 12,
            start: idx * 16,
            length: 12,
            type: 1,
            param: 128,
        }
     })

    setStartIdx(0)
    addSegment(seg_outer(0, 0))
    addSegment(seg_inner(0))
    addSegment(seg_outer(1, 200))
    addSegment(seg_inner(1))
    addSegment(seg_outer(2, 400))
    addSegment(seg_inner(2))
    addSegment(seg_outer(3, 600))
    addSegment(seg_inner(3))
    addSegment(seg_outer(4, 800))
    addSegment(seg_inner(4))
    addSegment(seg_outer(5, 1000))
    addSegment(seg_inner(5))
    endSegment()

    setColorTable(color_table_idx, [
        { r: 0xFF, g: 0x00, b: 0x00, len: 200 },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 200 },
        { r: 0x00, g: 0xFF, b: 0x00, len: 200 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 200 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 200 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 200 },
        ])
}

function dancer_test() {
    logger.warn('Dancer Test activated')
    
    let color_table_idx = 13*17 // just after all segments
    
    let seg_outer = (idx, offset, circle_offset) => ({
        start: idx * 16,
        length: 12,
        type: 2,
        linear: {
            speed: 0,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: idx & 1 ? 250 : -250,
            circle_offset: DANCER_OFFSET[idx],
            color_table_idx: color_table_idx,
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        start: idx * 16 + 12,
        length: 4,
        type: 4,
        copy: {
            boundary_mode: 12,
            start: idx * 16,
            length: 12,
            type: 1,
            param: 128,
        }
     })

    setStartIdx(0)
    addSegment(seg_outer(0,   0, 4))
    addSegment(seg_inner(0))
    addSegment(seg_outer(1, 120, 5))
    addSegment(seg_inner(1))
    addSegment(seg_outer(2, 240, 3))
    addSegment(seg_inner(2))
    addSegment(seg_outer(3, 360, 10))
    addSegment(seg_inner(3))
    addSegment(seg_outer(4, 480, 9))
    addSegment(seg_inner(4))
    addSegment(seg_outer(5, 600, 10))
    addSegment(seg_inner(5))
    endSegment()

    setColorTable(color_table_idx, [
        { r: 0xFF, g: 0x00, b: 0x00, len:  10 },
        { r: 0xFF, g: 0x00, b: 0x00, len:   0 },
        { r: 0x00, g: 0x00, b: 0x00, len: 110 },
        { r: 0x00, g: 0x00, b: 0x00, len:   0 },

        { r: 0x00, g: 0xFF, b: 0x00, len:  10 },
        { r: 0x00, g: 0xFF, b: 0x00, len:   0 },
        { r: 0x00, g: 0x00, b: 0x00, len: 110 },
        { r: 0x00, g: 0x00, b: 0x00, len:   0 },

        { r: 0x00, g: 0x00, b: 0xFF, len:  10 },
        { r: 0x00, g: 0x00, b: 0xFF, len:   0 },
        { r: 0x00, g: 0x00, b: 0x00, len: 110 },
        { r: 0x00, g: 0x00, b: 0x00, len:   0 },
        ])
}

function dancer_variant2() {
    logger.warn('Dancer activated')
    
    let seg_outer = (idx, offset) => ({
        start: idx * 16,
        length: 12,
        type: 3,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 200,
            px_offset: 0,
            px_dimm: 111,//116,
            circle_speed: idx & 1 ? 250 : -250,
            circle_offset: DANCER_OFFSET[idx],
            color_table_idx: 'A',
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        start: idx * 16 + 12,
        length: 4,
        type: 4,
        power_selector: 2,
        dimm_channel: 2,
        copy: {
            boundary_mode: 12,
            start: idx * 16,
            length: 12,
            type: 3,
            param: 128,
        }
     })

    let segments = [
        seg_outer(0,    0), seg_inner(0),
        seg_outer(1,  200), seg_inner(1),
        seg_outer(2,  400), seg_inner(2),
        seg_outer(3,  600), seg_inner(3),
        seg_outer(4,  800), seg_inner(4),
        seg_outer(5, 1000), seg_inner(5)
    ]

    let cTables = { 'A': { table: [
        { r: 0xFF, g: 0x00, b: 0x00, len: 150 }, //    0: red
        { r: 0xFF, g: 0x00, b: 0x00, len:  50 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 150 }, //  600: cyan
        { r: 0x00, g: 0xFF, b: 0xFF, len:  50 },
        { r: 0x00, g: 0xFF, b: 0x00, len: 150 }, //  400: green
        { r: 0x00, g: 0xFF, b: 0x00, len:  50 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 150 }, // 1000: violet
        { r: 0xFF, g: 0x00, b: 0xFF, len:  50 },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 150 }, //  200: yellow
        { r: 0xFF, g: 0xFF, b: 0x00, len:  50 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 150 }, //  800: blue
        { r: 0x00, g: 0x00, b: 0xFF, len:  50 },
    ]}}

    setMISAN(segments, cTables)
}

function doorknob_green() {
    logger.warn('Doorknob activated')
    
    let seg = {
        start: 0,
        length: 32,
        type: 3,
        linear: {
            speed: 10,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_idx: 20,
            color_offset: 0,
        },
    }

    setStartIdx(0)
    addSegment(seg)
    enddegment()

    setColorTable(20, [
        { r: 0x00, g: 0x40, b: 0x00, len: 100 },
        { r: 0x00, g: 0x80, b: 0x00, len: 100 },
        { r: 0x00, g: 0x20, b: 0x00, len: 100 },
        { r: 0x00, g: 0x60, b: 0x00, len: 100 },
        { r: 0x00, g: 0x80, b: 0x00, len: 100 },
        { r: 0x00, g: 0x60, b: 0x00, len: 100 },
        ])
}

function doorknob_orange() {
    logger.warn('Doorknob (orange) activated')
    
    let seg = {
        start: 0,
        length: 32,
        type: 3,
        linear: {
            speed: 10,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_idx: 20,
            color_offset: 0,
        },
    }

    setStartIdx(0)
    addSegment(seg)
    endSegment()

    setColorTable(20, [
        { r: 0x40, g: 0x02, b: 0x00, len: 100 },
        { r: 0x80, g: 0x04, b: 0x00, len: 100 },
        { r: 0x20, g: 0x01, b: 0x00, len: 100 },
        { r: 0x60, g: 0x03, b: 0x00, len: 100 },
        { r: 0x80, g: 0x04, b: 0x00, len: 100 },
        { r: 0x60, g: 0x03, b: 0x00, len: 100 },
    ])
}

function badstrip() {
    logger.warn('Bad-Strip activated')
    
    let seg_white = { ...seg_defaults,
        start: 0,
        length: 112,
        power_selector: 1,
        dimm_channel: 1,
        type: 6,
        white: {
            active_selector: 3,
            balance_channel: 3,
        }
    }

    let seg_color_right = { ...seg_defaults,
        start: 112,
        length: 73,
        type: 2,
        power_selector: 2,
        dimm_channel: 2,
        linear: { ...seg_defaults.linear,
            speed: 555 *0+ 30,
            px_offset: 5 *0+30,
            color_table_idx: 'A',
            color_offset: 0,
        },
    }

    let seg_color_left = { ...seg_color_right,
        start: 112 + 73,
        length: 61,
        linear: { ...seg_color_right.linear,
            px_offset: -seg_color_right.linear.px_offset,
            color_offset: seg_color_right.length * seg_color_right.linear.px_offset + seg_color_right.linear.color_offset,
        }
    }
    
    let seg_disconnected = { ...seg_defaults,
        start: 55,
        length: 2,
        power_selector: 4,
        dimm_channel: 2,
        blackout: false,
        type: 5,
        singlecolor: { ...seg_defaults.singlecolor,
            r: 255,
            g: 128,
            b: 0,
        }
    }

/* DEBUG - map 'Bad strip' to 'Dancer' lengths
    seg_white.length = 12
    seg_color_right.start = 16
    seg_color_right.length = 12
    seg_color_left.start = 32
    seg_color_left.length = 12
    seg_disconnected.start = 8
    seg_disconnected.length = 4
//*/

    let segments = [ seg_white, seg_color_right, seg_color_left, seg_disconnected ]
    
    let dragon_flex_a = 5
    let dragon_flex_b = 170
    let dragon_flex_c = 50

    let cTables = { 'A': { table: [
        { r: 0x00, g: 0xFF, b: 0x00, len: 600 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 600 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 600 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 600 - dragon_flex_b },
        { r: 0xFF, g: 0x00, b: dragon_flex_a, len: dragon_flex_b },
        { r: 0xFF, g: 0x00, b: 0x00, len: dragon_flex_c },
        { r: 0xFF, g: 0x00, b: 0x00, len: dragon_flex_b },
        { r: 0xFF, g: dragon_flex_a, b: 0x00, len: 600 - dragon_flex_b },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 600 },
    ]}}

    setMISAN(segments, cTables)
}

function foodstrip() {
    logger.warn('Food-Strip activated')
    // TODO: white for 112 pixel on POWER1
}

function flurstrip() {
    logger.warn('Flur-Strip activated')
    // TODO: 32px MISAN on POWER1, 43px colorlist reverse on POWER2, 43px colorlist on POWER2
    // TODO first segment change should not reset other segments
    // TODO select segment 1 mode differently than full DRAGON18 overwrite
}

// internal smoke test: converts from MISAN array to code and back to MISAN
function verify() {
    let origMisan = [...MISAN]
    let asCode = printfMISAN_Code()
    MISAN = []
    readMISANFromCode(asCode)
    if (origMisan.length === MISAN.length && origMisan.every((value, index) => value === MISAN[index])) {
        logger.info("to/from code verification OK")
    } else {
        logger.error("To/From code verification failed. Original:")
        logger.error(origMisan)
        logger.error("New version:")
        logger.error(MISAN)
    }
    
    let { segments, cTables, lastSegmentIdx } = parseMISAN(MISAN)
    MISAN = []
    setMISAN(segments, cTables)
    if (origMisan.length === MISAN.length && origMisan.every((value, index) => value === MISAN[index])) {
        logger.info("to/from JSON verification OK")
    } else {
        logger.error("To/From JSON verification failed. Original:")
        logger.error(asCode)
        logger.error("New version:")
        let asCodeNew = printfMISAN_Code()
        logger.error(asCodeNew)
    }
    
    
/*
    logger.info("Last Idx: " + lastSegmentIdx)
    logger.info(segments)
    logger.info(cTables)
//*/    
}

var receivedValues = 0
var expectedValues = 200
var REMOTE_MISAN = []
async function readValuesFromTasmota(tasmotaTopic) {
    let bagOfHolding = {
        resolve: null,
        reject: null,
        triggerTopic: 'stat/' + tasmotaTopic + '/#',
        triggerUuid: null,
        timeout: null,
    }
    let cb = function(trigger, topic, message, packet) {
//        logger.error("MISAN %s: %s", topic, message)
        let json
        try {
            json = JSON.parse(message)
        } catch(e) { return }
//        logger.error(json)
        if (!json || json.Dragon16 === undefined) return
        let m = json.Dragon16
        let a = m & 0xFF
        let b = (m >> 8) & 0xFF
        let c = m >> 16
        let d = c >= 8192
        if (d) c -= 8192
        REMOTE_MISAN[c] = a
        if (d) REMOTE_MISAN[c+1] = b
        logger.debug("MISAN %s: %s", c, a)
        if (d) logger.debug("MISAN %s: %s", c+1, b)
        receivedValues += d ? 2 : 1
        if (receivedValues < expectedValues) {
            mqtt.client.publish('cmnd/' + tasmotaTopic + '/dragon16', '' + ((8192 + receivedValues) << 16))
        } else {
            printTemplateString(REMOTE_MISAN)
            let { segments, cTables, lastSegmentIdx } = parseMISAN(REMOTE_MISAN)
            console.log("Last Idx: " + lastSegmentIdx)
            console.log(segments)
            console.log(cTables)
            bagOfHolding.resolve(REMOTE_MISAN)
            if (bagOfHolding.timeout) clearTimeout(bagOfHolding.timeout)
        }
    }.bind(this)
    logger.info("Reading MISAN values from %s", tasmotaTopic)
    bagOfHolding.triggerUuid = await mqtt.addTrigger(bagOfHolding.triggerTopic, '', cb)
    receivedValues = 0
    REMOTE_MISAN = []
// TODO enable read for unknown length
//    expectedValues = MISAN.length
    mqtt.client.publish('cmnd/' + tasmotaTopic + '/dragon16', '' + ((8192 + 0) << 16))
    bagOfHolding.timeout = setTimeout(() => {
        console.log("readValuesFromTasmota: Timeout reached, aborting")
        mqtt.removeTrigger(bagOfHolding.triggerTopic, bagOfHolding.triggerUuid)
        bagOfHolding.reject('Timeout')
    }, 30 * 1000)
    return new Promise((_resolve, _reject) => { bagOfHolding.resolve = _resolve; bagOfHolding.reject = _reject })
}

async function sendViaMqtt(tasmotaTopic) {
    config.led.topic = tasmotaTopic
    setTimeout(async () => { // wait a bit, so that MQTT has had a chance to connect
        logger.info('Sending data via MQTT (%d bytes)', MISAN.length)
        sendCmd('scheme', '1') // ensure no incomplete / illegal data (race condition) gets processed during update
        await sendMISAN()
        sendCmd('dragon8', '0') // sync
        sendCmd('scheme', '13')
        logger.info('Sent data via MQTT')
        await readValuesFromTasmota(tasmotaTopic)
    }, 200)
}

async function main() {

//*
//badstrip()
dancer_variant2()

console.log(printfMISAN_Code())
verify()
await sendViaMqtt('grag-dancer')
//*/

/*
REMOTE_MISAN = await readValuesFromTasmota('grag-bad-strip')

badstrip()
printTemplateString(MISAN)
printTemplateString(REMOTE_MISAN)
//*/
console.log('done')
//softTerminate()

/*
readMISANFromCode('{ 0x03, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0x00, 0x00, 0xfa, 0x00, 0x04, 0x04, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x03, 0x10, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0xc8, 0x00, 0xfa, 0x00, 0x05, 0x04, 0x1c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x10, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x03, 0x20, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0x90, 0x01, 0xfa, 0x00, 0x03, 0x04, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x20, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x03, 0x30, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0x58, 0x02, 0xfa, 0x00, 0x0a, 0x04, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x30, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x03, 0x40, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0x20, 0x03, 0xfa, 0x00, 0x09, 0x04, 0x4c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x40, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x03, 0x50, 0x00, 0x0c, 0x00, 0x00, 0x64, 0x00, 0x00, 0x74, 0xbb, 0x00, 0xe8, 0x03, 0xfa, 0x00, 0x0a, 0x04, 0x5c, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x50, 0x00, 0x0c, 0x00, 0x01, 0x80, 0x00, 0x00, 0x0c, 0xb0, 0x04, 0xff, 0x00, 0x00, 0x96, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x32, 0x00, 0x96, 0x00, 0xff, 0xff, 0x00, 0x96, 0x00, 0xc8, 0x00, 0xff, 0xff, 0x00, 0x32, 0x00, 0x5e, 0x01, 0x00, 0xff, 0x00, 0x96, 0x00, 0x90, 0x01, 0x00, 0xff, 0x00, 0x32, 0x00, 0x26, 0x02, 0x00, 0xff, 0xff, 0x96, 0x00, 0x58, 0x02, 0x00, 0xff, 0xff, 0x32, 0x00, 0xee, 0x02, 0x00, 0x00, 0xff, 0x96, 0x00, 0x20, 0x03, 0x00, 0x00, 0xff, 0x32, 0x00, 0xb6, 0x03, 0xff, 0x00, 0xff, 0x96, 0x00, 0xe8, 0x03, 0xff, 0x00, 0xff, 0x32, 0x00, 0x7e, 0x04 };')
//*/
/*
    let { segments, cTables, lastSegmentIdx } = parseMISAN(MISAN, 2)
    console.log("Last Idx: " + lastSegmentIdx)
    console.log(segments)
    console.log(cTables)

setMISAN(segments, cTables)
    console.log(printfMISAN_Code())
//sendViaMqtt('grag-dancer')
//*/
}

setTimeout(main, 1)
console.log("Started")