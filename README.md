# simple-builder

### Simple SQL query string builder

## Installation

```javascript
npm install simple-builder
```

## Use cases
SQL query builders (such as `squel.js`) sometimes feel heavy and it is not easy to transform your SQL knowledge to working query without reading the documentation. It is especially true for complicated queries with subqueries.

The aim is to enable you to write and format queries using pure Javascript arrays, you can use the question mark syntax with matching variables without caring about the order in the result - the only value order you care about is the natural one, question mark(s) should always be followed by matching number of values.

## Dependencies

This library has no dependencies.

## Limitations

The output is only suitable for PostgreSQL drivers such as `pg`. MySQL coming soon.

## API

### build(query)
`query` passed into the build function can be either array of SQL code mixed with values or plain string.

Output is an object containing `text` property which is your SQL query ready to be passed into your SQL client library. If values are present in your `query` input, then output also contains `values` property which is an array of values.


## Example

```javascript
var build = require("simple-builder")

var query = build([
  "SELECT * FROM users",
  "WHERE id = ? AND username = ?", user_id, username,
  "OR id = ?", user_id,
  "AND username = ?", username
])

var rows = yield db.query(query.text, query.values)

/*
{
  text: "SELECT * FROM users WHERE id = $1 AND username = $2 OR id = $3 AND username = $4",
  values: [
    123,
    "sadasd?asdasd",
    123,
    "sadasd?asdasd"
  ]
}
*/

// UPDATE query example

var query = build([
  "UPDATE users SET ?", { username: "something", gender: "male" },
  "WHERE user_id = ? AND is_hidden = ?", user_id, false
])

var rows = yield db.query(query.text, query.values)

/*
{
  "text": "UPDATE users SET username=$1,gender=$2 WHERE user_id = $3 AND is_hidden = $4",
  "values": [
    "something",
    "male",
    123,
    false
  ]
}
*/

// INSERT query example


var query = build([
  "INSERT INTO", "users",
  "VALUES ?", { username: "something", gender: "male" }
])

var rows = yield db.query(query.text, query.values)

/*
{
  "text": "INSERT INTO users (username,gender) VALUES ($1,$2)",
  "values": [
    "something",
    "male"
  ]
}
*/

```

## License

MIT