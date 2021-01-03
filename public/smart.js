socket.on('toast', function(msg) {
	console.log("Got toast: " + msg)
	$.toast({
		text: msg,
		icon: 'info',
		showHideTransition: 'slide', // fade, slide or plain
		allowToastClose: false,
		hideAfter: 3000,
		stack: 5,
		position: 'bottom-center',
		textAlign: 'center',
		loader: false,
	})
})

lastMpdStatus = {}
socket.on('mpd1-update', function(msg) {
	updateMpdStatus(msg.status)
	lastMpdStatus.mpd1 = msg.status
})

socket.on('mpd2-update', function(msg) {
	updateMpd2Status(msg.status)
	lastMpdStatus.mpd2 = msg.status
})

socket.on('mpd1-queue', function(msg) {
	let queue = processMpdQueue(msg, 'mpd1')
	updateMpdQueue('mpd1', queue)
})

socket.on('mpd2-queue', function(msg) {
	let queue = processMpdQueue(msg, 'mpd2')
	updateMpdQueue('mpd2', queue)
})

function processMpdQueue(queue, mpd) {
	queue = queue.map(item => { item.selected = item.Id == lastMpdStatus[mpd].Id; return item })
	return queue
}


socket.on('state', function(data) {
	console.log("Full state received")
	console.log(data)
	state = data
	updatePage()
})

socket.on('state-changed', function(data) {
	// TODO should we check if our own state[id] equals data.oldState? or perhaps do nothing if our own state is already data.newState?
	console.log("State changed: " + data.id + ": " + data.oldState + " -> " + data.newState)
	$.toast({
		text: "State changed: " + data.id + ": " + data.oldState + " -> " + data.newState,
		icon: 'info',
		showHideTransition: 'slide', // fade, slide or plain
		allowToastClose: false,
		hideAfter: 3000,
		stack: 5,
		position: 'bottom-center',
		textAlign: 'center',
		loader: false,
	})
	state[data.id] = data.newState
	updatePage(data.id, data.oldState, data.newState)
})

socket.on('POS-config-update', function(data) {
	console.log("Got Config Data for POS")
	console.log(data)
	data.active = false
	socket.emit('POS-config-set', data)
})

// create onChange triggers for aggregated stateIds
function parseMappings() {
	Object.keys(mappings).forEach(aggregationStateId => {
		let mapping = mappings[aggregationStateId]
		if (!mapping.aggregation) return
		let getAggregationFunc = (aggregation, prevCallback) => (stateId, oldState, newState) => {
			if (prevCallback) prevCallback(stateId, oldState, newState)
			let oldAggregationState = state[aggregationStateId]
			let newAggregationState = 'OFF' // we can start with 'OFF' since we check all states, including ourselves, in the loop
			aggregation.forEach(stateId2 => {
	//			console.log("Aggregation check: " + stateId2 + " for " + aggregationStateId + ": " + state[stateId2])
				if (state[stateId2] == 'ON') newAggregationState = 'ON'
			})
			state[aggregationStateId] = newAggregationState
			console.log("Aggretation changed: " + oldAggregationState + " -> " + newAggregationState)
			updatePage(aggregationStateId, oldAggregationState, newAggregationState)
		}
		mapping.aggregation.forEach(stateId => { 
			if (!mappings[stateId]) { mappings[stateId] = {} }
			mappings[stateId].onChange = getAggregationFunc(mapping.aggregation, mappings[stateId].onChange)
		})
		// just to be on the safe side, if it would be called again later
		delete mapping.aggregation
	})
}
parseMappings()

// assumption: if oldState == undefined, then it's initialization
function updatePage(stateId, oldState, newState) {
	// when called without stateId, loop trough all known IDs
	if (!stateId) { Object.keys(state).forEach(id => updatePage(id, undefined, state[id])); return }
	let mapping = mappings[stateId]
	if (!mapping) { console.log("updatePage: stateId not found: " + stateId); return }
	if (mapping.onChange) { mapping.onChange(stateId, oldState, newState) }
}

function toggle(stateId) {
	let mapping = mappings[stateId]
	if (!mapping) { console.log("toggle: stateId not found: " + stateId); return }
	if (mapping.onCmdToggle) {
		let currentState = state[stateId]
		console.log("Toggling state " + stateId + " from " + currentState);
		mapping.onCmdToggle(stateId, currentState)
	}
}

function cmd(url) {
	let reqListener = function() {
		console.log('Command result: ' + this.responseText)
		spanResult.innerHTML = this.responseText
		if (this.responseText) {
			$.toast({
				text: this.responseText,
				icon: 'info',
				showHideTransition: 'slide', // fade, slide or plain
				allowToastClose: false,
				hideAfter: 3000,
				stack: 5,
				position: 'bottom-center',
				textAlign: 'center',
				loader: false,
			});
		}
	}

	spanResult.innerHTML = 'sending request to ' + url
	let oReq = new XMLHttpRequest()
	oReq.addEventListener("load", reqListener)
	oReq.open("GET", url)
	oReq.send()
}
