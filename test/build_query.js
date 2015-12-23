var build = require("../lib/builder.js")

var user_id = 123
var username = "sadasd?asdasd"

var q = [
	"SELECT * FROM users",
	"WHERE id = ? AND username = ?", user_id, username,
	"OR id = ?", user_id,
	"AND username = ?", username
]

console.log(JSON.stringify(build(q), null, 4))
console.log()

var q2 = [
	"SELECT * FROM users"
]

console.log(JSON.stringify(build(q2), null, 4))
console.log()

var q3 = [
	"SELECT *",
	"FROM users"
]

console.log(JSON.stringify(build(q3), null, 4))
console.log()

var q4 = "SELECT * FROM users"

console.log(JSON.stringify(build(q4), null, 4))