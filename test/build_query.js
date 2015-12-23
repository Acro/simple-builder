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

var q5 = [
	"UPDATE users SET ?", { username: "something", gender: "male" },
	"WHERE user_id = ? AND is_hidden = ?", user_id, false
]

console.log(JSON.stringify(build(q5), null, 4))

var q6 = [
	"INSERT INTO", "users",
	"VALUES ?", { username: "something", gender: "male" }
]

console.log(JSON.stringify(build(q6), null, 4))

var user = {
	username: "something",
	gender: "male"
}

var q7 = [
	"INSERT INTO users (username, gender)",
	"VALUES (?, ?)", user.username, user.gender
]

console.log(JSON.stringify(build(q7), null, 4))