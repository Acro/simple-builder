var isObject = function (value) {
	return value !== null && typeof value === "object"
}

var build = function (env, query) {

	var ignore_counter = 0

	var values_counter = 1
	var unescaped_values = []

	var output = {
		text: []
	}

	var flags = {
		insert: false,
		where: false,
		where_in: false,
		update: false
	}

	var actions = {
		insert: function (query_part) {
			var keys = Object.keys(query_part)
			var insert_columns = "(" + keys.join(",") + ")"
			var inserts = keys.map(function (key) {
				unescaped_values.push(query_part[key])
				return env == "mysql" ?
					"?" :
					"$" + values_counter++
			})

			output.text[output.text.length - 1] = output.text[output.text.length - 1].replace(/values \?/gi, insert_columns + " VALUES (" + inserts.join(",") + ")")
			flags.insert = false
		},
		where: function (query_part) {
			var keys = Object.keys(query_part)
			var where = keys.map(function (key) {
				unescaped_values.push(query_part[key])
				return env == "mysql" ?
					key + "=?" :
					key + "=$" + values_counter++
			})

			output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", where.join(" AND "))
			flags.where = false
		},
		where_in: function (query_part) {
			var keys = Object.keys(query_part)
			var in_arr = keys.map(function (key) {
				unescaped_values.push(query_part[key])
				return env == "mysql" ? "?" : "$" + values_counter++
			})

			output.text[output.text.length - 1] = output.text[output.text.length - 1].replace(" IN ?", " IN (" + in_arr.join(",") + ")")

			flags.where_in = false
		},
		update: function (query_part) {
			var keys = Object.keys(query_part)
			var updates = keys.map(function (key) {
				unescaped_values.push(query_part[key])
				return env == "mysql" ?
					key + "=?" :
					key + "=$" + values_counter++
			})

			output.text[output.text.length - 1] = output.text[output.text.length - 1].replace("?", updates.join(","))
			flags.update = false
		}
	}

	if (arguments.length > 2) {
		query = Array.prototype.slice.call(arguments, 1)
	}

	if (query.constructor === Array) {

		for (var i = 0; i < query.length; i++) {

			if (ignore_counter-- > 0) {

				var current_action = Object.keys(flags).map((key) => {
					return flags[key] == true ? key : null
				}).filter((key) => {
					return key != null
				}).pop()

				if (query[i] && isObject(query[i]) && current_action) {

					actions[current_action](query[i])

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

			var match_question_mark = typeof query[i] == "string" ? query[i].match(/\?/g) : (function () { throw Error("Wrong query construction, check error near: [..., " + query[i-1] + ", " + query[i] + ", ...]") })()

			if (match_question_mark && match_question_mark.length > 0) {
				ignore_counter = match_question_mark.length
			}

			var match_insert = query[i].match(/values \?/gi)

			if (match_insert && match_insert.length > 0) {
				flags.insert = true
			}

			var match_where = query[i].match(/where \?/gi)

			if (match_where && match_where.length > 0) {
				flags.where = true
			}

			var match_where_in = query[i].match(/ in \?/gi)

			if (match_where_in && match_where_in.length > 0) {
				flags.where_in = true
			}

			var match_set = query[i].match(/set \?/gi)

			if (match_set && match_set.length > 0) {
				flags.update = true
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
