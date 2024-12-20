// https://stackoverflow.com/a/16608045/131146
var isObject = function(a) {
    return (!!a) && (a.constructor === Object);
}
var isArray = function(a) {
    return (!!a) && (a.constructor === Array);
}

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

var serverRunningSince = null
socket.on('welcome', function(msg) {
	console.log("Server said welcome, and is running since " + msg)
	if (serverRunningSince && serverRunningSince != msg) {
		console.log('Server has restarted - reloading page')
		location.reload()
	}
	serverRunningSince = msg
})

if (typeof updateMpdStatus !== 'undefined') {
    lastMpdStatus = {}
    socket.on('mpd1-update', function(msg) {
        updateMpdStatus(msg.status, 'mpd')
        lastMpdStatus.mpd = msg.status
    })

    socket.on('mpd2-update', function(msg) {
        updateMpdStatus(msg.status, 'mpd2')
        lastMpdStatus.mpd2 = msg.status
    })

    socket.on('mpd1-queue', function(msg) {
        let queue = processMpdQueue(msg, 'mpd')
        updateMpdQueue('mpd1', queue)
    })

    socket.on('mpd2-queue', function(msg) {
        let queue = processMpdQueue(msg, 'mpd2')
        updateMpdQueue('mpd2', queue)
    })
}

function processMpdQueue(queue, mpd) {
	console.log('got ' + mpd + ' queue', queue)
	queue = queue.map(item => { item.selected = (item.Id == lastMpdStatus[mpd].Id); return item })
	return queue
}

if ("mappings" in window) {
    parseMappings()

    socket.on('state', function(data) {
        console.log("Full state received")
        console.log(data)
        state = data
        updatePage()
    })

    socket.on('sensors', function(data) {
        console.log("Full sensor data received")
        console.log(data)
        sensors = data
    //	updatePage()
    })
    
}

if ("state" in window) {
    socket.on('state-changed', function(data) {
        // TODO should we check if our own state[id] equals data.oldState? or perhaps do nothing if our own state is already data.newState?
        console.log("State changed: " + data.id + ": " + data.oldState + " -> " + data.newState)
        let toast = true
        if (data.id == 'mpd1' || data.id == 'mpd2') toast = false // too many updates during fades
        if (toast) {
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
        }
        state[data.id] = data.newState
        updatePage(data.id, data.oldState, data.newState)
    })
}

if ("sensors" in window) {
    socket.on('sensor-updated', function(data) {
    //	console.log("Sensor " + data.id + " updated: ")
    //	console.log(data.oldState)
    //	console.log(data.newState)
        sensors[data.id] = data.newState
    })
}

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
			if (oldAggregationState != newAggregationState) {
				state[aggregationStateId] = newAggregationState
				console.log("Aggretation changed: " + oldAggregationState + " -> " + newAggregationState)
				updatePage(aggregationStateId, oldAggregationState, newAggregationState)
			}
		}
		mapping.aggregation.forEach(stateId => { 
			if (!mappings[stateId]) { mappings[stateId] = {} }
			mappings[stateId].onChange = getAggregationFunc(mapping.aggregation, mappings[stateId].onChange)
		})
		// just to be on the safe side, if it would be called again later
		delete mapping.aggregation
	})
}

// assumption: if oldState == undefined, then it's initialization
function updatePage(stateId, oldState, newState) {
	// when called without stateId, loop trough all known IDs
	if (!stateId) { Object.keys(state).forEach(id => updatePage(id, undefined, state[id])); return }
	let mapping = mappings[stateId]
	if (!mapping) { 
//        console.log("updatePage: stateId not found: " + stateId)
        return
    }
	if (!mapping.onChange) { console.log("updatePage: no onChange() handler found for stateId: " + stateId); return }
	if (mapping.onChange) { mapping.onChange(stateId, oldState, newState) }
}

function toggle(stateId) {
	let mapping = mappings[stateId]
	if (!mapping) { 
        console.log("toggle: stateId not found: " + stateId)
        return
    }
	if (!mapping.onCmdToggle) { console.log("toggle: no onCmdToggle() defined for stateId: " + stateId); return }
	let currentState = state[stateId]
	console.log("Toggling state " + stateId + " from " + currentState);
	mapping.onCmdToggle(stateId, currentState)
}

function setTo(stateId, state) {
	let mapping = mappings[stateId]
	if (!mapping) { console.log("setTo: stateId not found: " + stateId); return }
	if (!mapping.onSetTo) { console.log("toggle: no onSetTo() defined for stateId: " + stateId); return }
	console.log("Setting state " + stateId + " to " + state);
	mapping.onSetTo(stateId, state)
}

function cmd(url) {
	let reqListener = function() {
		console.log('Command result: ' + this.responseText)
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

	let oReq = new XMLHttpRequest()
	oReq.addEventListener("load", reqListener)
	oReq.open("GET", url)
	oReq.send()
}

// TODO improve with https://css-tricks.com/using-css-transitions-auto-dimensions/
// and set scrollIntoView() after the transitioning delay, and only when uncollapsing
function toggleHide(id, scrollIntoViewElement = null) {
	let element = document.getElementById(id)
	element.classList.toggle("hidden")
	if (!element.classList.contains("hidden") && scrollIntoViewElement) {
		element.addEventListener('transitionend', function(e) {
		if (e.target != element) return
			element.removeEventListener('transitionend', arguments.callee)
			let element2 = document.getElementById(scrollIntoViewElement)
			element2.scrollIntoView({behavior: "smooth"})
		})
	}
}

if ("things" in window) {
    socket.on('things', function(data) {
//        console.log('whiteboard things:', data)
        if (!Array.isArray(data)) { data = [ data ] }
        data.forEach(thing => {
            var oldThing = things[thing.id]
            if (thing.currentValue !== null && typeof thing.currentValue === 'object') {
                // TODO supporting JSON everywhere would be cool - but for now, coerce it into a string
                thing.currentValue = JSON.stringify(thing.currentValue)
                console.log('Thing %s received, currentvalue is an object -> converting to string', thing.id)
            }
            if (oldThing) {
                // thing updated
                var newThing = { ...oldThing, ...thing }
                var diff = compareThing(oldThing, newThing)
                things[thing.id] = newThing
                if (diff) {
                    console.log('thing changed: ' + thing.id, diff)
                    if (diff && oldThing.onChanged) oldThing.onChanged(newThing, diff)
                    // TODO
                } else {
                    console.log('thing didn\'t change: ' + thing.id)
                }
            } else if (thing) {
                // new thing
                things[thing.id] = thing
                console.log('Creating new thing: ', thing.id)
                if (createThingCb) createThingCb(thing)
            } else {
                console.error('Update for unknown thing in data', data)
            }
        })
    })
    socket.on('scenarios', function(data) {
        scenarios = data
        console.log('Retrieved ' + Object.keys(scenarios).length + ' scenarios: ' + Object.keys(scenarios).join(', '))
    })
    socket.on('thingStyling', function(data) {
        thingStyling = data
        console.log('Retrieved thingStyling:', thingStyling)
        if (onThingStylingChanged) onThingStylingChanged()
    })
    socket.on('thingQuicklinks', function(data) {
        thingQuicklinks = data
        console.log('Retrieved thingQuicklinks:', thingQuicklinks)
        if (onThingQuicklinksChanged) onThingQuicklinksChanged()
    })
    socket.on('thingGroups', function(data) {
        groupDefinitions = data
        console.log('Retrieved ' + Object.keys(groupDefinitions).length + ' thingGroups: ' + Object.keys(groupDefinitions).join(', '))
        if (onThingGroupChanged) onThingGroupChanged()
    })
    socket.on('thingCurrentScenario', function(data) {
        currentScenario = data
        console.log('Retrieved current scenario: ' + currentScenario.id)
        Object.values(things).forEach(thing => {
            console.log("Scenario changed - poking " + thing.def.id)
            try {
                thing.onChanged(thing)
            } catch (e) {
                console.log(thing)
                console.log(thing.onChanged)
                throw new Error('Error in onChanged() for thing ' + thing.def.id, e)
            }
        })
        if (updateScenarioExpectationDisplay) updateScenarioExpectationDisplay()
        if (hideModal) hideModal()
    })
    socket.on('thingInfobox', function(data) {
        console.log('Retrieved thingInfobox update', data)
        if (onThingInfoboxChanged) onThingInfoboxChanged(data)
    })
}

function compareThing(oldThing, thing) {
    var diff = {}
    let relevantKeys = [ 'value', 'targetValue', 'status', 'scenarioStatus' ]
    relevantKeys.forEach(key => {
        if (oldThing[key] != thing[key]) diff[key] = { old: oldThing[key], new: thing[key] }
    })
    return Object.keys(diff).length ? diff : null
}
