var build = function (env, query) {

	var ignore_counter = 0
	var insert_flag = false
	var where_flag = false

	var values_counter = 1
	var unescaped_values = []

	var output = {
		text: []
	}

	if (arguments.length > 2) {
		query = Array.prototype.slice.call(arguments, 1)
	}

	if (query.constructor === Array) {

		for (var i = 0; i < query.length; i++) {

			if (ignore_counter-- > 0) {

				if (query[i] && query[i].constructor === Object && !insert_flag && !where_flag) {

					// Construct UPDATE query
					var keys = Object.keys(query[i])
					var updates = keys.map(function (key) {
						unescaped_values.push(query[i][key])
						return env == "mysql" ?
							key + "=?" :
							key + "=$" + values_counter++
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", updates.join(","))

				} else if (query[i] && query[i].constructor === Object && insert_flag && !where_flag) {

					// Construct INSERT query
					var keys = Object.keys(query[i])
					var insert_columns = "(" + keys.join(",") + ")"
					var inserts = keys.map(function (key) {
						unescaped_values.push(query[i][key])
						return env == "mysql" ?
							"?" :
							"$" + values_counter++
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace(/values \?/gi, insert_columns + " VALUES (" + inserts.join(",") + ")")
					insert_flag = false

				} else if (query[i] && query[i].constructor === Object && !insert_flag && where_flag) {

					// Construct WHERE conditions
					var keys = Object.keys(query[i])
					var where = keys.map(function (key) {
						unescaped_values.push(query[i][key])
						return env == "mysql" ?
							key + "=?" :
							key + "=$" + values_counter++
					})

					output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", where.join(" AND "))
					where_flag = false

				} else {

					// Process variable
					if (env != "mysql") {
						output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", "$" + values_counter++)
					}

					unescaped_values.push(query[i])

				}

				continue

			}

			// Concat projection array with comma, expected only when no question mark or VALUES ? was found
			if (query[i].constructor == Array) {
				query[i] = query[i].join(",")
			}

			var match_question_mark = query[i].match(/\?/g)

			if (match_question_mark && match_question_mark.length > 0) {
				ignore_counter = match_question_mark.length
			}

			var match_insert = query[i].match(/values \?/gi)

			if (match_insert && match_insert.length > 0) {
				insert_flag = true
			}

			var match_where = query[i].match(/where \?/gi)

			if (match_where && match_where.length > 0) {
				where_flag = true
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

var env = {
	pg: build.bind(this, "pg"),
	mysql: build.bind(this, "mysql")
}

module.exports = env
