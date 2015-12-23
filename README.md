# simple-builder

### Simple SQL query string builder

## Installation

```javascript
npm install simple-builder
```

## Motivation
SQL query builders (such as `squel.js`) often feel heavy. It is not easy to create your SQL query without reading the documentation.

The aim of `simple-builder` is

- to make use of your existing SQL knowledge
- to make queries easy-to-read and easy-to-follow
- to eliminate annoyances of different client libraries

## API

### `build(Array partials)` -> `Object`
The `partials` is an `Array` consisting of:

- strings
- numbers
- arrays
- boolean values
- objects

All of them are partial values for constructing resulting `Object`.

```javascript
var email = "john@doe.wtf"
var partials = [ "SELECT * FROM users WHERE email = ?", email ]
```

Every query is constructed by creating an `partials` array and passing it to the `simple-builder`.

```javascript
var build = require("simple-builder")

var query = build(partials)
```

The output of `simple-builder` is always an `Object` containing:

- `text` property
- `values` property

The `values` property may not be set when there was no variable in your `partials` array.

```javascript
var rows = yield db.query(query.text, query.values)
```

## Examples

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

## Dependencies

This library has no dependencies.

## Limitations

The output is only suitable for PostgreSQL drivers such as `pg`. MySQL coming soon.

## License

MIT