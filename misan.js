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
    led: {
        topic: '', // will be set in main()
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
    process.nextTick(function () { wtf.dump() })
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
        color_table_id: 0,
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


let sendByte = async (idx, value) => { await mqtt.client.publish('cmnd/' + config.led.topic + '/dragon15', '' + ((idx << 16) + (value & 0xFF))) }
let sendWord = async (idx, value) => { await mqtt.client.publish('cmnd/' + config.led.topic + '/dragon15', '' + (((8192 + idx) << 16) + (value & 0xFFFF))) }
let sendCmd = async (cmdIdx, value) => { await mqtt.client.publish('cmnd/' + config.led.topic + '/' + cmdIdx, value) }

var addDataNextIdx = 0
let setByte = (idx, value) => { MISAN[idx] = value & 0xFF }
let setWord = (idx, value) => { MISAN[idx] = value & 0xFF; MISAN[idx+1] = (value >> 8) & 0xFF; }
let setStartIdx = (idx) => addDataNextIdx = idx
let addByte = (value) => { setByte(addDataNextIdx, value); addDataNextIdx++; }
let addWord = (value) => { setWord(addDataNextIdx, value); addDataNextIdx+=2; }

// Always keep in sync with drgn_misan_segSizeByType in Tasmota xlgt_01_ws2812.ino
let drgn_misan_segSizeByType = [ 1, 3, 10, 13, 8, 6, 5 ];

function setPartlist(partlist) {
    setStartIdx(0)
    if (!partlist) {
        addByte(0)
        return
    }
    addByte(partlist.length)
    for(let i=0; i<partlist.length; i++) {
        addWord(partlist[i].start)
        addWord(partlist[i].length)
    }
}

let setSegment = (idx, seg, partlist = undefined) => {
    setStartIdx(idx)
    let endSegment = (seg.type == 0)
    addByte(seg.type)
    if (endSegment) {
        logger.debug('setSegment: END MARKER')
        // end segment consists of only the end marker
    } else {
        if (partlist) {
            let part = partlist[seg.partId]
            logger.debug('setSegment: segment type %d (partId %d: start %d, length %d -> %d) at index %d', seg.type, seg.partId, part.start, part.length, part.start + part.length, idx)
        } else {
            logger.debug('setSegment: segment type %d (partId %d) at index %d', seg.type, seg.partId, idx)
        }
        addByte(seg.partId)
        let control = (seg.power_selector & 0b111) + ((seg.dimm_channel & 0b11) << 3) + ((seg.disabled ? 1 : 0) << 5) + ((seg.blackout ? 1 : 0) << 6)
        addByte(control)
    }
    
    if (endSegment) {
        // end segment consists of only the type=0 as end marker
    } else if (seg.type == 1) { // Black
    } else if (seg.type == 2 || seg.type == 3) { // Linear & Circle
        addWord(seg.linear.speed)
        addByte(seg.linear.px_offset)
        addByte(seg.linear.px_dimm)
//        addWord(seg.linear.color_table_idx)
        addByte(seg.linear.color_table_id)
        addWord(seg.linear.color_offset)
        if (seg.type == 3) {
            addWord(seg.linear.circle_speed)
            addByte(seg.linear.circle_offset)
        }
    } else if (seg.type == 4) { // Copy
        addByte(seg.copy.boundary_mode)
        addByte(seg.copy.srcPartId)
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
        logger.error("Internal Error: length calculation seems wrong -> idx + expectLength = addDataNextIdx evaluates to %d + %d != %d", idx, expectLength, addDataNextIdx)
        return UNKNOWN_FX_ERROR_MARKER
    }
    return true
}

function addSegment(seg, partlist = undefined) {
    let result = setSegment(addDataNextIdx, seg, partlist)
    if (result != UNKNOWN_FX_ERROR_MARKER && addDataNextIdx > MISAN_MAX_SIZE) { // equal would be ok
        logger.error("WARNING: too much data - %d available, %d used", MISAN_MAX_SIZE, addDataNextIdx)
    }
}

function endSegment () {    
    addSegment({ type: 0 })
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

let sendMISAN = async () => {
    for(let idx=0; idx<MISAN.length; idx+=2) {
        await sendWord(idx, MISAN[idx] + (MISAN[idx+1] << 8))
    }
}

let printfMISAN_Code = (misan = MISAN) => {
    return '{ ' + misan.map(val => '0x' + (val < 16 ? '0' : '') + val.toString(16)).join(', ') + ' };'
}

function printTemplateString(misan = MISAN) {
    let partcount = misan[0]
    let partlistLength = 1 + partcount * 4
    let misanOnlyParts = misan.slice(0, partlistLength)
    let misanNoParts = misan.slice(partlistLength)
    let str = 'uint8_t new_parts[] = ' + printfMISAN_Code(misanOnlyParts)
    console.log(str)
    let str2 = 'uint8_t new_segment[] = ' + printfMISAN_Code(misanNoParts)
    console.log(str2)
}

let sendMISAN_Base64 = async () => {
    // TODO use a Buffer or something
    // TODO also define a max length, and thus a start index
}

// TODO not yet updated to take Partlist into account
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

function parseMISAN(misan, version = 5, partlistIncluded = true) {
    // version 1: old
    // version 2: added "control" byte
    // version 3: dynamic length, seg.type++, field reordering
    // version 4: start/length replaced with partId
    // version 5: colortable idx changed
    logger.debug("Parsing MISAN protocol version %d", version)
    
    let getByte = (idx) => misan[idx]
    let getWord = (idx) => misan[idx] + (misan[idx+1] << 8)
    let nextReadIdx = 0
    let getNextByte = () => { let res = getByte(nextReadIdx); nextReadIdx++; return res }
    let getNextWord = () => { let res = getWord(nextReadIdx); nextReadIdx+=2; return res }
    let getNextByteSigned = () => { let res = getNextByte(); return res >= 0x80 ? res - 0x100 : res}
    let getNextWordSigned = () => { let res = getNextWord(); return res >= 0x8000 ? res - 0x10000 : res}
    
    let parseSegment = (idx) => {
        logger.silly('parse segment at idx=%d, next bytes: %d %d %d %d %d %d %d %d %d %d', idx, misan[idx], misan[idx+1], misan[idx+2], misan[idx+3], misan[idx+4], misan[idx+5], misan[idx+6], misan[idx+7], misan[idx+8], misan[idx+9])
        nextReadIdx = idx
        let colorTableIdx = undefined
        let colorTableId = -1
        let nextIdx = undefined
        let seg = {}
        if (version >= 3) {
            seg.type = getNextByte()
            if (seg.type != 0) {
                if (version <= 3) {
                    seg.start = getNextWord()
                    seg.length = getNextWord()
                } else {
                    seg.partId = getNextByte()
                }
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
        if (seg.type == 0) {
            nextIdx = idx + 1
        } else if (seg.type == 1) {
            nextIdx = idx + 3
        } else if (seg.type == 2 || seg.type == 3) {
            if (version <= 2) {
                seg.linear = {
                    speed: getNextWordSigned(),
                    px_offset: getNextByteSigned(),
                    px_dimm: getNextByte(),
                    circle_speed: getNextWordSigned(),
                    circle_offset: getNextByteSigned(),
                    color_table_idx: getNextWord(), 
                    color_offset: getNextWord(),
                }
                colorTableIdx = seg.linear.color_table_idx
            } else {
                seg.linear = {}
                seg.linear.speed = getNextWordSigned()
                seg.linear.px_offset = getNextByteSigned()
                seg.linear.px_dimm = getNextByte()
                if (version < 5) {
                    seg.linear.color_table_idx = getNextWord(),
                    colorTableIdx = seg.linear.color_table_idx
                } else {
                    seg.linear.color_table_id = getNextByte(),
                    colorTableId = seg.linear.color_table_id
                }
                seg.linear.color_offset = getNextWord()
                if (seg.type == 3) {
                    seg.linear.circle_speed = getNextWordSigned()
                    seg.linear.circle_offset = getNextByteSigned()
                }
            }
            nextIdx = idx + (version == 1 ? 16 : version == 2 ? 17 : version == 3 ? (seg.type == 2 ? 14 : 17) : version == 4 ? (seg.type == 2 ? 11 : 14) : (seg.type == 2 ? 10 : 13))
        } else if (seg.type == 4) {
            seg.copy = {}
            seg.copy.boundary_mode = getNextByte()
            if (version <= 3) {
                seg.copy.start = getNextWord()
                seg.copy.length = getNextWord()
            } else {
                seg.copy.srcPartId = getNextByte()
            }
            seg.copy.type = getNextByte()
            seg.copy.param = getNextWord()
            if (version == 1) { getNextWord(); getNextByte() }
            nextIdx = idx + (version == 1 ? 16 : version < 4 ? 14 : 8)
        } else if (seg.type == 5) {
            seg.singlecolor = {
                r: getNextByte(),
                g: getNextByte(),
                b: getNextByte(),
            }
            nextIdx = idx + (version == 1 ? 16 : version < 4 ? 9 : 6)
        } else if (seg.type == 6) {
            seg.white = {
                active_selector: getNextByte(),
                balance_channel: getNextByte(),
            }
            nextIdx = idx + (version == 1 ? 16 : version < 4 ? 8 : 5)
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
            let c = (version >= 5 || (typeof colorTableIdx === 'undefined')) ? '' : ' - expecting color table at index ' + colorTableIdx
            if (version >= 4)
                logger.debug('parseMISAN: at index %d, segment type %d (partId %d)%s', idx, seg.type, seg.partId, c)
            else
                logger.debug('parseMISAN: at index %d, segment type %d (start %d, length %d -> %d)%s', idx, seg.type, seg.start, seg.length, seg.start + seg.length, c)
        }
        if (nextIdx != nextReadIdx) {
            if (version >= 4)
                logger.error("Failed to parse MISAN (internal error): for segment type %d, using partId %d, calculated nextIdx != counted nextReadIdx -> %d != %d", seg.type, seg.partId, nextIdx, nextReadIdx)
            else
                logger.error("Failed to parse MISAN (internal error): for segment type %d, starting at %d, calculated nextIdx != counted nextReadIdx -> %d != %d", seg.type, seg.start, nextIdx, nextReadIdx)
        }
        if (version >= 3)
            if (nextReadIdx != idx + drgn_misan_segSizeByType[seg.type]) {
                if (version >= 4)
                    logger.error("Failed to parse MISAN (internal error): for segment type %d, using partId %d, calculated id of segment size != counted nextReadIdx -> %d + %d != %d", seg.type, seg.partId, idx, drgn_misan_segSizeByType[seg.type], nextReadIdx)
                else
                    logger.error("Failed to parse MISAN (internal error): for segment type %d, starting at %d, calculated id of segment size != counted nextReadIdx -> %d + %d != %d", seg.type, seg.start, idx, drgn_misan_segSizeByType[seg.type], nextReadIdx)
            }
        return { seg: seg, nextIdx: nextIdx, colorTableIdx: colorTableIdx, colorTableId: colorTableId } 
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
    
    let partlist = undefined
    if (version >= 4 && partlistIncluded) {
        partlist = []
        let partcount = getNextByte()
        currentIdx++;
        for(let idx=0; idx<partcount; idx++) {
            partlist.push({ start: getNextWord(), length: getNextWord() })
            currentIdx += 4;
        }
        logger.debug('Parsing Partlist: %d entries -> %s', partcount, partlist.map(part => part.start + '/' + part.length).join(', '))
    }
    
    let highestColorTableId = -1
    do {
        let {seg, nextIdx, colorTableIdx, colorTableId} = parseSegment(currentIdx)
//        logger.debug(seg, nextIdx, colorTableIdx)
        segments.push(seg)
        if (colorTableId > highestColorTableId) highestColorTableId = colorTableId
        if (colorTableIdx) cTableIdxs[colorTableIdx] = colorTableIdx
        if (!nextIdx) break
        currentIdx = nextIdx
        if (seg.type == 0) break
    } while (true)
    let cTables = {}
    if (version < 5)
        cTables = Object.values(cTableIdxs).map(idx => ({ idx: idx, table: parseColorTable(idx) })).reduce((a, b) => { let c = Object.keys(a).length; a[String.fromCharCode(65+c)] = b; return a }, {})
    logger.debug('Expecting %d color tables', highestColorTableId+1)
    if (version >= 5 && highestColorTableId >= 0)
        for(let i=0; i<=highestColorTableId; i++) {
            cTables[String.fromCharCode(65+i)] = { id: i, table: parseColorTable(nextReadIdx) }
        }

    for(let i=0; i<segments.length; i++) {
        seg = segments[i]
        if (seg.type == 2 || seg.type == 3) {
            if (Number.isInteger(seg.linear.color_table_idx)) {
                let candidates
                if (version < 5) candidates = Object.keys(cTables).filter(key => cTables[key].idx == seg.linear.color_table_idx)
                if (version >= 5) candidates = Object.keys(cTables).filter(key => cTables[key].id == seg.linear.color_table_id)
                if (candidates.length == 1) {
                    seg.linear.color_table_idx = candidates[0]
                } else {
                    logger.error('Failed to parse MISAN: segment %d (type %d) expects colortable at index %d, but we don\'t have them', i, seg.type, seg.linear.color_table_idx)
                }
            }
        }
    }
    
    return { partlist: partlist, segments: segments, cTables: cTables, lastSegmentIdx: currentIdx }
}

// https://stackoverflow.com/a/70511311/131146
const trueTypeOf = (obj) => Object.prototype.toString.call(obj).slice(8, -1).toLowerCase()

function setMISAN(partlist, segments, cTables) {
    logger.info('Compiling JSON with %d parts, %d segments, %d color tables to MISAN', partlist.length, segments.length, Object.keys(cTables).length)
    // add end segment if not present
    if (segments.length == 0 || segments[segments.length-1].type != 0) {
        segments.push( { type: 0 } )
    }
    
    // set defaults
    let fillInDefaults = (target, defaults) => {
        for (const [key, value] of Object.entries(defaults)) {
            if (trueTypeOf(value) != 'object' && !target.hasOwnProperty(key)) target[key] = value
            if (trueTypeOf(value) == 'object' && target.hasOwnProperty(key) && trueTypeOf(target[key]) == 'object') fillInDefaults(target[key], value)
        }
    }
    segments.forEach(seg => fillInDefaults(seg, seg_defaults))
    
    // no entry in the length table means it's an invalid segment type
    let invalidSegments = segments.filter(seg => !drgn_misan_segSizeByType[seg.type])
    if (invalidSegments.length) {
        logger.error("Invalid segment types: %o", invalidSegments)
        return
    }
    // calculate the combined length of the segments
    let partlistLength = partlist ? 1 + partlist.length * 4 : 1
    let totalLength = partlistLength + segments.map(seg => drgn_misan_segSizeByType[seg.type]).reduce((a, b) => a + b, 0)
    let colorTableId = 0
    // calculate and set idx for the color tables
    Object.keys(cTables).forEach(key => {
        let len = 3 + cTables[key].table.length * 7
        cTables[key].id = colorTableId
        cTables[key].idx = totalLength
        totalLength += len
        colorTableId++
    })
    
    // insert color table index into effects
    // TODO would be better if this is relative to the segments, as currently it's fixed to the length of partlist :(
    // TODO it's relative now, we could simplify this whole stuff here...
    for(let i=0; i<segments.length; i++) {
        let seg = segments[i]
        if (seg.type == 2 || seg.type == 3) {
            let a = seg.linear.color_table_id
            if (!Number.isInteger(a)) {
                if (!cTables[a]) {
                    logger.error('Effect %d of type %d references color table "%s", but it\'s unknown', i, seg.type, a)
                    return
                }
                seg.linear.color_table_idx = cTables[a].idx
                seg.linear.color_table_id = cTables[a].id
            }
        }
    }
    
    // Finally, set everything
    MISAN = []
    setPartlist(partlist)
    segments.forEach(seg => addSegment(seg, partlist))
    Object.values(cTables).forEach(table => setColorTable(table.idx, table.table))
}

function test() {
    logger.warn('test pattern activated')
    
    let partlist = [{ start: 0, length: 12}, { start: 12, length: 4}]
    
    let seg = {
        partId: 0,
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
            color_table_id: 'A',
            color_offset: 0,
        },
//*/
        linear: {
            speed: 100,
            px_offset: 50,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_id: 'A',
            color_offset: 0,
        },
    }

    let seg_copy = {
        partId: 1,
        type: 4,
        copy: {
            boundary_mode: 12,
            srcPartId: 0,
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

    setMISAN(partlist, segments, cTables)
}

// how many leds offset we need to get from led index 0 to the "led on the upper side of the circle" (based on measurement of Dancer hardware)
var DANCER_OFFSET = [4, 5, 3, 10, 9, 10]

// 0-11: the 6 spheres, outer ring of 12 & inner block of 4
// 11: everything
function dancerPartlist() {
    let partlist = []
    for(idx=0; idx<6; idx++) {
        partlist.push({ start: idx * 16, length: 12 })
        partlist.push({ start: idx * 16 + 12, length: 4 })
    }
    partlist.push({ start: idx * 0, length: 7 * 16 })
    return partlist
}

function dancer() {
    logger.warn('Dancer activated')
    
    let seg_outer = (idx, offset) => ({
        partId: idx * 2,
        type: 3,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 10,
            px_offset: 20,
            px_dimm: 128,
            circle_speed: 250,
            circle_offset: DANCER_OFFSET[idx],
            color_table_id: 'A',
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        partId: idx * 2 + 1,
        length: 4,
        type: 4,
        power_selector: 2,
        dimm_channel: 2,
        copy: {
            boundary_mode: 12,
            srcPartId: idx * 2,
            type: 1,
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
        { r: 0xFF, g: 0x00, b: 0x00, len: 200 },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 200 },
        { r: 0x00, g: 0xFF, b: 0x00, len: 200 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 200 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 200 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 200 },
    ]}}

    setMISAN(dancerPartlist(), segments, cTables)
}

function dancer_test() {
    logger.warn('Dancer Test activated')
    
    let seg_outer = (idx, offset, circle_offset) => ({
        partId: idx * 2,
        type: 3,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 0,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: idx & 1 ? 7500 : -7500,
//            circle_speed: 0,
            circle_offset: circle_offset,
            color_table_id: 'A',
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        partId: idx * 2 + 1,
        length: 4,
        type: 4,
        power_selector: 2,
        dimm_channel: 2,
        copy: {
            boundary_mode: 12,
            srcPartId: idx * 2,
            type: 1,
            param: 128,
        }
     })

    let segments = [
        seg_outer(0,   0,  4), seg_inner(0),
        seg_outer(1, 120,  5), seg_inner(1),
        seg_outer(2, 240,  3), seg_inner(2),
        seg_outer(3, 360, 10), seg_inner(3),
        seg_outer(4, 480,  9), seg_inner(4),
        seg_outer(5, 600, 10), seg_inner(5)
    ]

    let cTables = { 'A': { table: [
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
    ]}}

    setMISAN(dancerPartlist(), segments, cTables)
}

function dancer_variant2() {
    logger.warn('Dancer activated')
    
    let seg_outer = (idx, offset) => ({
        partId: idx * 2,
        type: 3,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 200,
            px_offset: 0,
            px_dimm: 111,//116,
            circle_speed: idx & 1 ? 250 : -250,
            circle_offset: DANCER_OFFSET[idx],
            color_table_id: 'A',
            color_offset: offset,
        },
    })
    let seg_inner = (idx) => ({
        partId: idx * 2 + 1,
        type: 4,
        power_selector: 2,
        dimm_channel: 2,
        copy: {
            boundary_mode: 12,
            srcPartId: idx * 2,
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
        { r: 0xFF, g: 0x00, b: 0x00, len:  25 },
        { r: 0xFF, g: 0xFF, b: 0x00, len:  25 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 150 }, //  600: cyan
        { r: 0x00, g: 0xFF, b: 0xFF, len:  25 },
        { r: 0x00, g: 0xFF, b: 0x00, len: 150 }, //  400: green
        { r: 0x00, g: 0xFF, b: 0x00, len:  25 },
        { r: 0xFF, g: 0xFF, b: 0x00, len:  25 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 150 }, // 1000: violet
        { r: 0xFF, g: 0x00, b: 0xFF, len:  25 },
        { r: 0xFF, g: 0x00, b: 0x00, len:  25 },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 150 }, //  200: yellow
        { r: 0xFF, g: 0xFF, b: 0x00, len:  25 },
        { r: 0x00, g: 0xFF, b: 0x00, len:  25 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 150 }, //  800: blue
        { r: 0x00, g: 0x00, b: 0xFF, len:  50 },
    ]}}

    setMISAN(dancerPartlist(), segments, cTables)
}

function flurPartlist() {
    return [
        { start:  0, length:  32 }, // 0: window dressing
        { start: 32, length:  43 }, // 1: right part
        { start: 75, length:  43 }, // 2: left part
        { start: 32, length:  86 }, // 3: full upper strip
        { start:  0, length: 118 }, // 4: everything
    ]
}

function flurstrip() {
    logger.warn('Flur-Strip activated')
    
    let partlist = flurPartlist()

    let blackout = {
        type: 1,
        partId: 4,
    }

    let indicator_green = {
        partId: 0,
        type: 3,
        disabled: true,
        blackout: false,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 10,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_id: 'A',
            color_offset: 0,
        },
    }

    let indicator_orange = {
        partId: 0,
        type: 3,
        disabled: true,
        blackout: false,
        power_selector: 1,
        dimm_channel: 1,
        linear: {
            speed: 10,
            px_offset: 10,
            px_dimm: 128,
            circle_speed: 0,
            circle_offset: 0,
            color_table_id: 'B',
            color_offset: 0,
        },
    }

    let rainbow_right = { ...seg_defaults,
        partId: 1,
        type: 2,
        power_selector: 2,
        dimm_channel: 2,
        linear: { ...seg_defaults.linear,
            speed: 555,
            px_offset: 4,
            color_table_id: 'C',
            color_offset: 0,
        },
    }

    let rainbow_left = { ...rainbow_right,
        partId: 2,
        linear: { ...rainbow_right.linear,
            px_offset: -rainbow_right.linear.px_offset,
            color_offset: partlist[rainbow_right.partId].length * rainbow_right.linear.px_offset + rainbow_right.linear.color_offset,
        }
    }
    
    let segments = [blackout, indicator_green, indicator_orange, rainbow_right, rainbow_left]    

    let cTables = { 
        'A': { table: [
            { r: 0x00, g: 0x40, b: 0x00, len: 100 },
            { r: 0x00, g: 0x80, b: 0x00, len: 100 },
            { r: 0x00, g: 0x20, b: 0x00, len: 100 },
            { r: 0x00, g: 0x60, b: 0x00, len: 100 },
            { r: 0x00, g: 0x80, b: 0x00, len: 100 },
            { r: 0x00, g: 0x60, b: 0x00, len: 100 },
        ]},
        'B': { table: [
            { r: 0x40, g: 0x02, b: 0x00, len: 100 },
            { r: 0x80, g: 0x04, b: 0x00, len: 100 },
            { r: 0x20, g: 0x01, b: 0x00, len: 100 },
            { r: 0x60, g: 0x03, b: 0x00, len: 100 },
            { r: 0x80, g: 0x04, b: 0x00, len: 100 },
            { r: 0x60, g: 0x03, b: 0x00, len: 100 },
        ]},
        'C': getRedSkewedRainbow(),
    }

    setMISAN(partlist, segments, cTables)
}

// returns a red-skewed rainbow color table (as the strip tends to not look red when it's mixed)
function getRedSkewedRainbow() {
    let dragon_flex_a = 5    // skew linear: value to set at specified position
    let dragon_flex_b = 170  // skew linear: position where to set the specified value
    let dragon_flex_c = 50   // time (in ticks) to show pure red

    return { table: [
        { r: 0x00, g: 0xFF, b: 0x00, len: 600 },
        { r: 0x00, g: 0xFF, b: 0xFF, len: 600 },
        { r: 0x00, g: 0x00, b: 0xFF, len: 600 },
        { r: 0xFF, g: 0x00, b: 0xFF, len: 600 - dragon_flex_b },
        { r: 0xFF, g: 0x00, b: dragon_flex_a, len: dragon_flex_b },
        { r: 0xFF, g: 0x00, b: 0x00, len: dragon_flex_c },
        { r: 0xFF, g: 0x00, b: 0x00, len: dragon_flex_b },
        { r: 0xFF, g: dragon_flex_a, b: 0x00, len: 600 - dragon_flex_b },
        { r: 0xFF, g: 0xFF, b: 0x00, len: 600 },
    ]}
}

function badPartlist() {
    return [
        { start:   0, length: 112 }, // 0: mirror strip
        { start: 112, length:  73 }, // 1: right part
        { start: 185, length:  61 }, // 2: left part
        { start: 112, length: 134 }, // 3: full wall strip
        { start:   0, length: 246 }, // 4: everything
        { start:  54, length:   4 }, // 5: 'disconnected' indicator (part of mirror strip)
    ]
}

function badstrip() {
    logger.warn('Bad-Strip activated')
    
    let partlist = badPartlist()
    
    let seg_white = { ...seg_defaults,
        partId: 0,
        power_selector: 1,
        blackout: true,
        dimm_channel: 1,
        type: 6,
        white: {
            active_selector: 3,
            balance_channel: 3,
        }
    }

    let seg_color_right = { ...seg_defaults,
        partId: 1,
        type: 2,
        power_selector: 2,
        dimm_channel: 2,
        linear: { ...seg_defaults.linear,
            speed: 555,
            px_offset: 4,
            color_table_id: 'A',
            color_offset: 0,
        },
    }

    let seg_color_left = { ...seg_color_right,
        partId: 2,
        linear: { ...seg_color_right.linear,
            px_offset: -seg_color_right.linear.px_offset,
            color_offset: partlist[seg_color_right.partId].length * seg_color_right.linear.px_offset + seg_color_right.linear.color_offset,
        }
    }

    let seg_disconnected = { ...seg_defaults,
        partId: 5,
        dimm_channel: 2,
        disabled: true,
        blackout: false,
        type: 5,
        singlecolor: { ...seg_defaults.singlecolor,
            r: 128,
            g: 255,
            b: 0,
        }
    }

    let segments = [ seg_white, seg_color_right, seg_color_left, seg_disconnected ]
    let cTables = { 'A': getRedSkewedRainbow() }

    setMISAN(partlist, segments, cTables)
}

function foodPartlist() {
    return [
        { start:   0, length: 112 }, // 0: full strip
    ]
}

function foodstrip() {
    logger.warn('Food-Strip activated')
    
    let segments = [ {
        partId: 0,
        power_selector: 2,
        dimm_channel: 2,
        type: 6,
        white: {
            active_selector: 3,
            balance_channel: 3,
        }
    }, {
        partId: 0,
        blackout: false,
        power_selector: 1,
        dimm_channel: 1,
        type: 6,
        white: {
            active_selector: 3,
            balance_channel: 3,
        }
    },
    ]

    let cTables = {}
    setMISAN(foodPartlist(), segments, cTables)
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
    
    let { partlist, segments, cTables, lastSegmentIdx } = parseMISAN(MISAN)
    MISAN = []
    setMISAN(partlist, segments, cTables)
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
var expectedValues = 300
var REMOTE_MISAN = []
async function readValuesFromTasmota(tasmotaTopic) {
    let bagOfHolding = {
        resolve: null,
        reject: null,
        triggerTopic: 'stat/' + tasmotaTopic + '/#',
        triggerUuid: null,
        timeout: null,
    }
    let cb = async function(trigger, topic, message, packet) {
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
            let { partlist, segments, cTables, lastSegmentIdx } = parseMISAN(REMOTE_MISAN)
            console.log("Last Segment Idx: " + lastSegmentIdx)
            console.log(partlist)
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
    let bagOfHolding = {
        resolve: null,
        reject: null,
        triggerTopic: 'stat/' + tasmotaTopic + '/#',
        triggerUuid: null,
        timeout: null,
    }
    config.led.topic = tasmotaTopic
    setTimeout(async () => { // wait a bit, so that MQTT has had a chance to connect
        logger.info('Sending data via MQTT (%d bytes)', MISAN.length)
        await sendCmd('scheme', '2') // switch scheme (to 'breathing') ensure no incomplete / illegal data (race condition) gets processed during update
        await sendMISAN()
        await sendCmd('dragon8', '0') // sync
        await sendCmd('scheme', '13')
        logger.info('Sent data via MQTT')
        bagOfHolding.resolve()
    }, 200)
    return new Promise((_resolve, _reject) => { bagOfHolding.resolve = _resolve; bagOfHolding.reject = _reject })
}

async function main() {

//stripname = 'grag-dancer'
//stripname = 'grag-flur-strip'
//stripname = 'grag-bad-strip'
stripname = 'grag-food-strip'

//*
//badstrip()
//dancer()
//dancer_test()
//dancer_variant2()
//flurstrip()
foodstrip()

console.log(printfMISAN_Code())
verify()
printTemplateString()
await sendViaMqtt(stripname)


/*
REMOTE_MISAN = await readValuesFromTasmota(stripname)
printTemplateString(REMOTE_MISAN)
//*/
console.log('done')
softTerminate()

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