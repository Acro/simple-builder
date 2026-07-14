# simple-builder

A tiny SQL string builder that keeps your SQL **visible**. You write SQL with
`?` placeholders, interleave the values, and get back `{ text, values }` ready
for the `pg`, `mysql`, and `mysql2` drivers.

Zero dependencies. First-class TypeScript types. Ships CJS **and** ESM.

```bash
npm install simple-builder --save
```

## Why

Most query builders hide your SQL behind a fluent API you have to learn.
`simple-builder` does the opposite — you write real SQL and it only handles the
tedious parts: numbering placeholders and expanding objects/arrays.

- Doesn't obscure the actual SQL.
- Uses the SQL you already know.
- Queries stay easy to read and easy to follow.

## Quick start

```javascript
const { pg } = require('simple-builder')      // or: const { mysql } = ...

const email = 'john@doe.wtf'
const query = pg(['SELECT * FROM users WHERE email = ?', email])
// { text: 'SELECT * FROM users WHERE email = $1', values: ['john@doe.wtf'] }

const rows = await db.query(query.text, query.values)
```

ESM works too:

```javascript
import { pg, mysql } from 'simple-builder'
```

`pg` renders `$1, $2, …` placeholders; `mysql` (and `mysql2`) keep `?`. That is
the only difference between the two.

## The `partials` list

A query is a list mixing SQL fragments and values. Pass an array, an argument
list, or a single ready string:

```javascript
pg(['SELECT * FROM users WHERE id = ?', userId])   // array
pg('SELECT * FROM users WHERE id = ?', userId)     // arguments
pg('SELECT * FROM users')                          // ready string → { text }
```

For each SQL fragment the `?` are counted, and that many values are expected to
follow it:

```javascript
pg([
  'SELECT * FROM friends WHERE friend_id = ?', userId,
  'ORDER BY created_at',
])
// { text: 'SELECT * FROM friends WHERE friend_id = $1 ORDER BY created_at', values: [1] }
```

A bare array in fragment position becomes a comma-separated projection list:

```javascript
pg(['SELECT', ['id', 'username'], 'FROM users'])
// { text: 'SELECT id,username FROM users' }
```

The result always has a `text` property; `values` is present only when the query
bound at least one value.

## Object & array expansion

### `INSERT … VALUES ?`

```javascript
const user = { username: 'John Doe', email: 'john@doe.wtf' }
pg(['INSERT INTO users VALUES ?', user, 'RETURNING id'])
// { text: 'INSERT INTO users (username,email) VALUES ($1,$2) RETURNING id',
//   values: ['John Doe', 'john@doe.wtf'] }
```

### `UPDATE … SET ?`

```javascript
pg(['UPDATE users SET ?', { username: 'Biggie', gender: 'female' }, 'WHERE id = ?', id])
// { text: 'UPDATE users SET username=$1,gender=$2 WHERE id = $3',
//   values: ['Biggie', 'female', 123] }
```

### `WHERE ?` (AND-joined equality)

```javascript
pg(['SELECT * FROM users WHERE ?', { username: 'x', gender: 'male' }])
// { text: 'SELECT * FROM users WHERE username=$1 AND gender=$2', values: ['x', 'male'] }
```

### `WHERE … IN ?`

```javascript
pg('SELECT * FROM users WHERE id IN ?', [1, 2, 3])
// { text: 'SELECT * FROM users WHERE id IN ($1,$2,$3)', values: [1, 2, 3] }
```

You can always write these by hand instead — the object forms are just sugar.

## Security

**Values are always parameterised** — they go into the `values` array and are
never interpolated into the SQL text, so they cannot cause injection.

**Object keys become identifiers and are interpolated verbatim.** In the
`VALUES ?`, `SET ?`, and `WHERE ?` forms the object's *keys* become column
names written directly into the SQL. Never build those keys from user input:

```javascript
// DANGER: keys come straight from the request body
pg(['UPDATE users SET ?', req.body])   // an attacker controls the column list

// Safe: you decide the columns; the user only controls values
pg(['UPDATE users SET ?', { username: req.body.username, email: req.body.email }])
```

## Requirements & compatibility

- Node.js **>= 16**. Works with the `pg`, `mysql`, and `mysql2` drivers.
- The public API (`pg` / `mysql`, same call shapes and output) is unchanged from
  2.x — see [CHANGELOG / release notes](https://github.com/Acro/simple-builder/releases)
  for the 3.0.0 packaging changes and bug fixes.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for the repo layout, build, and test commands.

## License

MIT
