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

socket.on('mpd1-update', function(msg) {
	updateMpdStatus(msg.status)
})

socket.on('mpd2-update', function(msg) {
	updateMpd2Status(msg.status)
})

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

// assumption: if oldState == undefined, then it's initialization
function updatePage(stateId, oldState, newState) {
	// when called without stateId, loop trough all known IDs
	if (!stateId) { Object.keys(state).forEach(id => updatePage(id, undefined, state[id])); return }
	let mapping = mappings[stateId]
	if (mapping) {
		mapping.onChange(stateId, oldState, newState)
		return
	}
	console.log("updatePage: stateId not found: " + stateId)
}

function toggle(stateId) {
	let mapping = mappings[stateId]
	if (mapping) {
		let currentState = state[stateId]
		console.log("Toggling state " + stateId + " from " + currentState);
		mapping.onCmdToggle(stateId, currentState)
		return
	}
	console.log("toggle: stateId not found: " + stateId)
}

function cmd(url) {
	let reqListener = function() {
		console.log(this.responseText)
		spanResult.innerHTML = this.responseText
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

	spanResult.innerHTML = 'sending request to ' + url
	let oReq = new XMLHttpRequest()
	oReq.addEventListener("load", reqListener)
	oReq.open("GET", url)
	oReq.send()
}
