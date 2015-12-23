var build = function (query) {

	var ignore = 0

	var val_count = 1
	var unescaped_values = []

	var output = {
		text: []
	}

	if (query.constructor === Array) {

		for (var i = 0; i < query.length; i++) {

			if (ignore-- > 0) {

				if (query[i].constructor === Object) {
					
					var keys = Object.keys(query[i])
					var update_q = []

					keys.map(function (key) { 
						update_q.push( key + "=$" + val_count++ )
						unescaped_values.push(query[i][key])
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", update_q.join(","))

				} else {
					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", "$" + val_count++)
					unescaped_values.push(query[i])
				}

				continue
			}

			var match = query[i].match(/\?/g)

			if (match && match.length > 0) {
				ignore = match.length
			}

			output.text.push(query[i])
		}

		output.text = output.text.join(" ")

		if (unescaped_values.length > 0) {
			output.values = unescaped_values
		} 

		return output

	} else {
		return { text: query }
	}
}

module.exports = build