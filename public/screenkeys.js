socket.emit('subscribe', 'screenkeys')
	
socket.on('screenkeys', function(data) {
//    console.log('screenkeys', data)
	switch (data.cmnd) {
		case 'SetColor':
			maskToIdxList(data.keymask).forEach(idx => { setColor(idx, data.color) })
		break
		case 'StoreBitmap':
			screenkeys.bitmaps[data.idx] = data.bitmap
		break
		case 'SetBitmap':
			maskToIdxList(data.keymask).forEach(idx => { paintCanvas(screenkeys.canvas[idx], screenkeys.bitmaps[data.idx]) })
		break
		default:
			console.log("Screenkeys: unknown command", data.cmnd)
	}
})

function maskToIdxList(mask) {
	let idx = 0
	let list = []
	while(mask > 0) {
		if (mask & 1) list.push(idx)
		idx++
		mask >>= 1
	}
	return list
}

var screenkeys = {
	length: 17,
	canvas: [],
	bitmaps: []
}

let dpi = window.devicePixelRatio
function fix_dpi(canvas) {
//create a style object that returns width and height
  let style = {
    height() {
      return +getComputedStyle(canvas).getPropertyValue('height').slice(0,-2);
    },
    width() {
      return +getComputedStyle(canvas).getPropertyValue('width').slice(0,-2);
    }
  }
//set the correct attributes for a crystal clear image!
  canvas.setAttribute('width', style.width() * dpi);
  canvas.setAttribute('height', style.height() * dpi);
  console.log("dpi: " + dpi)
}

function createScreenkeys_old(parentElement) {
	let keys = document.createElement('span')
	let createOnMouseDownHandler = idx => event => {
		if (event.button == 0) {
			console.log('Screenkeys:     clicked on ' + idx)
			socket.emit('screenkeys-btn', idx)
		}
	}
	let createOnMouseUpHandler = idx => event => {
		if (event.button == 0) {
			console.log('Screenkeys: released on ' + idx)
			socket.emit('screenkeys-btnup', idx)
		}
	}
	for(i = 0; i < screenkeys.length; i++) {
		let canvas = document.createElement('canvas')
		keys.appendChild(canvas)
		canvas.style.margin = '3px'
		canvas.style.padding = '3px'
		screenkeys.canvas[i] = canvas
		let json = { x: 32, y: 16 }
		paintCanvas(canvas, json)
		setColor(i, 0)
		canvas.onmousedown = createOnMouseDownHandler(i)
		canvas.onmouseup = createOnMouseUpHandler(i)
	}
	parentElement.style.backgroundColor = '#c0c0c0'
	parentElement.style.padding = '10px'
	parentElement.appendChild(keys)
}

function createScreenkeys(parentElement) {
	let keys = document.createElement('span')
	let createOnMouseDownHandler = idx => event => {
		if (event.button == 0) {
			console.log('Screenkeys: clicked on ' + idx)
			socket.emit('screenkeys-btn', idx)
		}
	}
	let createOnMouseUpHandler = idx => event => {
		if (event.button == 0) {
			console.log('Screenkeys: released on ' + idx)
			socket.emit('screenkeys-btnup', idx)
		}
	}
	for(i = 0; i < screenkeys.length; i++) {
		let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		keys.appendChild(svg)
		svg.onmousedown = createOnMouseDownHandler(i)
		svg.onmouseup = createOnMouseUpHandler(i)
		svg.style.margin = '3px'
		svg.style.padding = '3px'
		screenkeys.canvas[i] = svg
		let json = { x: 32, y: 16 }
		paintCanvas(svg, json)
		setColor(i, 0)
		svg.setAttribute('title', 'test')
	}
	parentElement.style.backgroundColor = '#c0c0c0'
	parentElement.style.padding = '10px'
	parentElement.appendChild(keys)
}

function paintCanvas(svg, json) {
	let showGrid = false
	if (!svg) {
		console.log("Error: svg doesn't exist")
		return
	}
	if (!json) {
		console.log("Error: json not defined")
		return
	}
	let zoom = 2 / dpi

	while (svg.lastChild) {
		svg.removeChild(svg.lastChild);
	}

	svg.style.width = json.x * zoom
	svg.style.height = json.y * zoom
	let svgNS = svg.namespaceURI;
	for(y = 0; y < json.y; y++) {
		let line = json['line' + (y < 10 ? '0' : '') + y]
		if (!line) line = ''
		for(x = 0; x < json.x; x++) {
			let imgIdx = (y * json.x + x) * 4
			let pixel = line[x] == 'X'
			if (pixel || showGrid) {
				var rect = document.createElementNS(svgNS,'rect');
				rect.setAttribute('x', x * zoom);
				rect.setAttribute('y', y * zoom);
				rect.setAttribute('width', zoom);
				rect.setAttribute('height', zoom);
				rect.setAttribute('fill', pixel ? '#000000' : x+y & 1 ? '#c0c0c0' : '#d0d0d0');
				svg.appendChild(rect);
			}
		}
	}
}

function paintCanvas_old(canvas, json) {
	if (!canvas) {
		console.log("Error: canvas doesn't exist")
		return
	}
	if (!json) {
		console.log("Error: json not defined")
		return
	}
	const ctx = canvas.getContext('2d');
	canvas.width = json.x
	canvas.height = json.y
	canvas.style.width = json.x / 1.25 * 2
	canvas.style.height = json.y / 1.25 * 2
	ctx.clearRect(0, 0, canvas.width, canvas.height)
//	console.log("Canvas size is " + canvas.width + " x " + canvas.height)
	let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
	let data = imageData.data
	for(y = 0; y < canvas.height; y++) {
		let line = json['line' + (y < 10 ? '0' : '') + y]
		if (!line) line = ''
		for(x = 0; x < canvas.width; x++) {
			let imgIdx = (y * canvas.width + x) * 4
			let pixel = line[x] == 'X'
			data[imgIdx + 0] = pixel ? 10 : 240
			data[imgIdx + 1] = pixel ? 10 : 240
			data[imgIdx + 2] = pixel ? 10 : 240
			if (pixel) ctx.fillRect(x, y, 1, 1);
		}
	}
//	ctx.putImageData(imageData, 0, 0);	// somehow seems to not work?
}

function setColor(idx, col) {
	let canvas = screenkeys.canvas[idx]
	if (!canvas) {
		console.log("Error: canvas doesn't exist")
		return
	}
	let off = '#406040'
	let green = '#80c080'
	let green2 = '#c0ffc0'
	let red = '#c04040'
	let red2 = '#ff8080'
	let orange = '#c08040'
	let color = null
	if (col == 0x00) color = [off, off]  // does nothing?
	if (col == 0x01) color = [off, green]
	if (col == 0x02) color = [green, off]
	if (col == 0x03) color = [green, green]
	if (col == 0x33) color = [green2, green2]
	if (col == 0x04) color = [off, red]
	if (col == 0x05) color = [off, orange]
	if (col == 0x06) color = [green, red]
	if (col == 0x07) color = [green, orange]
	if (col == 0x08) color = [red, off]
	if (col == 0x09) color = [red, green]
//	if (col == 0x0a) color = [orange, off] // does nothing?
	if (col == 0x0b) color = [orange, green]
	if (col == 0x0c) color = [red, red]
	if (col == 0xcc) color = [red2, red2]
	if (col == 0x0d) color = [red, orange]
	if (col == 0x0e) color = [orange, red]
	if (col == 0x0f) color = [orange, orange]
	if (col == 0x10) color = [off, off]
	if (color) canvas.style.backgroundImage = 'linear-gradient(to right, ' + color[0] + ', ' + color[1] + ')'
}
