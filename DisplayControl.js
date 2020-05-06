/*
 *
 */

const winston = require('winston')
const moment = require('moment')


 module.exports = function(god) { 
	var self = {
		
	table: {},
	recalculateMoment: moment(),
	currentEntry: 0,	
	fnUpdate: () => {},
	updateTimer: undefined,
		
	init: function() {
		this.logger = winston.loggers.get('DisplayControl')
	},
	
	addEntry: function(id, content) {
		this.logger.info('Added entry ' + id)
		let entry = {
			id: id,
			fnGetContent: content instanceof Function ? content : () => content,
			showDurationSec: 5,
		}
		this.table[entry.id] = entry
		this.update()
		return entry
	},
	
	removeEntry: function(id) {
		this.logger.info('Removed entry ' + id)
		delete this.table[id]
		// TODO ensure that currentEntryKeyId stays valid
	},
	
	periodicUpdate: async function() {
		if (moment().isBefore(this.recalculateMoment)) return
		return this.update()
	},

	currentEntryKeyId: 0,
	currentEntry: {
		showUntil: moment(),
	},
	update: async function() {
		this.updateTimer && clearTimeout(this.updateTimer)
		let entryKeys = Object.keys(this.table)
		if (entryKeys.length == 0) return
		// choose which entry to show next
		let entry = this.table[entryKeys[this.currentEntryKeyId]]
		if (moment().isSameOrAfter(this.currentEntry.showUntil)) {
			this.currentEntryKeyId = this.currentEntryKeyId >= entryKeys.length - 1 ? 0 : this.currentEntryKeyId + 1
			entry = this.table[entryKeys[this.currentEntryKeyId]]
			this.currentEntry.showUntil = moment().add(entry.showDurationSec, 's')
		}
		// update entry & get content
		let content = await entry.fnGetContent()
		
		// display content
		if (content != this.currentEntry.lastContent) {			
			await this.fnUpdate(content)
			this.currentEntry.lastContent = content
		}
		// reschedule
		let nextUpdateMs = 1000
		this.updateTimer = setTimeout(this.update.bind(this), nextUpdateMs)
	},
	
	
}
    self.init()
    return self
}
