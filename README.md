# simple-builder

### Simple SQL query string builder

## Installation

```javascript
npm install simple-builder
```

## Motivation

SQL query builders (such as `squel.js`) often feel heavy. It is not easy to create your SQL query without reading the documentation.

The aim of `simple-builder` is

- to NOT obscure the actual SQL code
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

All of them are partial values for constructing query `Object`.

```javascript
var email = "john@doe.wtf"
var partials = [ "SELECT * FROM users WHERE email = ?", email ]
```

Every query is constructed by creating a `partials` array and passing it to the `simple-builder`.

```javascript
var build = require("simple-builder")

var query = build(partials)
// { text: "SELECT * FROM users WHERE email = $1", values: [ "john@doe.wtf" ] }
```

The output of `simple-builder` is always an `Object` containing:

- `text` property
- `values` property

The `values` property may not be set when there was no variable in your `partials` array.

```javascript
var rows = yield db.query(query.text, query.values)
```

## Syntax

The `partials` array is a mix of SQL code and variables that are to be inserted into the final query.

For variable insertion, the `question mark syntax` is used.

```javascript
var user_id = 1
var partials = [ "SELECT * FROM users WHERE id = ?", user_id ]
```

For every SQL string in your `partials` array the number of `question marks` is retrieved. Matching number of variables is then expected right after this SQL string.

```javascript
var user_id = 1
var email = "john@doe.wtf"
var partials = [ "SELECT * FROM users WHERE id = ? AND email = ?", user_id, email ]
```

You are basically mixing SQL code and variables.

```javascript
var user_id = 1
var partials = [ 
  "SELECT * FROM friends WHERE friend_id = ?", user_id,
  "ORDER BY created_at"
]

var query = build(partials)
// { text: "SELECT * FROM friends WHERE friend_id = $1 ORDER BY created_at", values: [ 1 ] }
```

Some query builders are making `INSERT` queries easy to write by using insertion object.

```javascript
var insertion = {
  username: "John Doe",
  email: "john@doe.wtf"
}
```

The keys of the insertion object represent database columns.

```javascript
var partials = [ "INSERT INTO users VALUES ?", insertion ]
```

The example above is the supported syntax for inserting an object.

```javascript
var partials = [ "INSERT INTO users VALUES ?", insertion, "RETURNING id" ]
```

When `VALUES ?` substring is found in the SQL partial, the next value is expected to be an `Object`.

```javascript
var query = build(partials)
// { text: "INSERT INTO users (username,email) VALUES ($1,$2) RETURNING id", values: [ "John Doe", "john@doe.wtf" ] }
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