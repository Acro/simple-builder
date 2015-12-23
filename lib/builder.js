var build = function (query) {

	var ignore = 0
	var insert_flag = false

	var val_count = 1
	var unescaped_values = []

	var output = {
		text: []
	}

	if (query.constructor === Array) {

		for (var i = 0; i < query.length; i++) {

			if (ignore-- > 0) {

				if (query[i].constructor === Object && !insert_flag) {
					
					// Construct UPDATE query
					var keys = Object.keys(query[i])
					var updates = []

					keys.map(function (key) { 
						updates.push( key + "=$" + val_count++ )
						unescaped_values.push(query[i][key])
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", updates.join(","))

				} else if (query[i].constructor === Object && insert_flag) {

					// Construct INSERT query
					var keys = Object.keys(query[i])
					var insert_columns = "(" + keys.join(",") + ")"
					var inserts = []

					keys.map(function (key) { 
						inserts.push( "$" + val_count++ )
						unescaped_values.push(query[i][key])
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace(/values \?/gi, insert_columns + " VALUES (" + inserts.join(",") + ")")
					insert_flag = false

				} else {

					// Process variable
					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", "$" + val_count++)
					unescaped_values.push(query[i])

				}

				continue

			}

			var match_question_mark = query[i].match(/\?/g)

			if (match_question_mark && match_question_mark.length > 0) {
				ignore = match_question_mark.length
			}

			var match_insert = query[i].match(/values \?/gi)

			if (match_insert && match_insert.length > 0) {
				insert_flag = true
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