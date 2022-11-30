// removes comments from JSON without changing the line numbers

 module.exports = function() { 
	var self = {
		
	init: function() {
	},
	
	parse: function(txt) {
		const states = {
			TEXT: 'text',
			SINGLE_QUOTED: 'single quoted',
			DOUBLE_QUOTED: 'double quoted',
			LINE_COMMENT: 'line comment',
			BLOCK_COMMENT: 'block comment'			
		}
		let res = ''
		let state = states.TEXT
		let parts = txt.split(/("|'|\n|\/\/|\/\*|\*\/|\\"|\\|')/)
		for(let i=0; i<parts.length; i++) {
			let c = parts[i]
			switch(state) {
				case states.TEXT:
					switch(c) {
						case '"': state = states.DOUBLE_QUOTED; res += c; break
						case '\'': state = states.SINGLE_QUOTED; res += '"'; break
						case '//': state = states.LINE_COMMENT; break
						case '/*': state = states.BLOCK_COMMENT; break
						default: res += c
					}
					break
				case states.SINGLE_QUOTED:
					if (c == "'") {
                        state = states.TEXT
                        res += '"'
                    } else if (c == '"') {
                        res += '\\"'
                    } else {
                        res += c
                    }
					break
				case states.DOUBLE_QUOTED:
					if (c == '"') state = states.TEXT
					res += c
					break
				case states.LINE_COMMENT:
					if (c == '\n') {
						state = states.TEXT
						res += c
					}
					break
				case states.BLOCK_COMMENT:
					if (c == '*/') {
						state = states.TEXT
					}
					break
			}
		}
		// but remove trailing comma in arrays/objects
		// TODO currently also removes inside strings
		res = res.replace(/,(\s*)(}|])/g, '$1$2')
		return JSON.parse(res)
	}
	
}
    self.init()
    return self
}
