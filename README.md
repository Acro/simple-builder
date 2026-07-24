# simple-builder

A tiny SQL builder that keeps your SQL **visible**. You write real SQL; it only
handles the tedious parts — numbering placeholders, expanding objects and lists,
and quoting identifiers.

Zero dependencies. ~16 kB. First-class TypeScript types. CJS **and** ESM.

```bash
npm install simple-builder --save
```

> **Using an AI coding agent?** The complete API, semantics, recipes, and
> gotchas are in [`llms.txt`](./llms.txt) — one file, no prose, written to be
> read by an LLM. It ships inside the npm tarball, so it is already on disk at
> `node_modules/simple-builder/llms.txt`. Every example in it is executed and
> verified on each CI run.

## Why

Most query builders hide your SQL behind a fluent API you have to learn.
`simple-builder` does the opposite — the SQL in your source *is* the SQL that
runs. It returns `{ text, values }`, ready for the `pg`, `mysql`, and `mysql2`
drivers.

## Two ways to write a query

```javascript
const { pg, sql } = require('simple-builder')   // or: import { pg, sql } from 'simple-builder'

// 1. Tagged template — recommended
pg(sql`SELECT * FROM users WHERE email = ${email}`)

// 2. Partials + `?` — the classic API, unchanged
pg(['SELECT * FROM users WHERE email = ?', email])

// both → { text: 'SELECT * FROM users WHERE email = $1', values: ['john@doe.wtf'] }
```

`pg` renders `$1, $2, …`; `mysql` (and `mysql2`) keep `?`. That is the only
difference between them.

```javascript
const query = pg(sql`SELECT * FROM users WHERE id = ${id}`)
const rows = await db.query(query.text, query.values)
```

The result always has `text`; `values` is present only when the query bound at
least one value.

---

## The `sql` tag (recommended)

Every `${interpolation}` is **always** a bound parameter. You cannot forget to
parameterise something, which makes accidental injection structurally
impossible:

```javascript
const evil = "1; DELETE FROM users; --"
pg(sql`SELECT * FROM users WHERE id = ${evil}`)
// { text: 'SELECT * FROM users WHERE id = $1', values: ["1; DELETE FROM users; --"] }
```

### Composition

Fragments nest. Build queries conditionally without string glue:

```javascript
const active = onlyActive ? sql`AND active = ${true}` : sql.empty
pg(sql`SELECT * FROM users WHERE org = ${org} ${active}`)
```

```javascript
const where = sql.join([sql`a = ${1}`, sql`b = ${2}`], ' AND ')
pg(sql`SELECT * FROM t WHERE ${where}`)
// { text: 'SELECT * FROM t WHERE a = $1 AND b = $2', values: [1, 2] }
```

### Lists

An interpolated array expands to a parenthesised list — the `IN` form:

```javascript
pg(sql`SELECT * FROM users WHERE id IN ${[1, 2, 3]}`)
// { text: 'SELECT * FROM users WHERE id IN ($1,$2,$3)', values: [1, 2, 3] }
```

Use `sql.value()` when you want an array bound as a *single* parameter (a
Postgres array or jsonb column):

```javascript
pg(sql`SELECT * FROM t WHERE tags = ${sql.value(['a', 'b'])}`)
// { text: 'SELECT * FROM t WHERE tags = $1', values: [['a','b']] }
```

### Dynamic identifiers

Identifiers can never be parameterised by any driver, so they get their own
helper. `sql.id()` quotes per dialect and escapes embedded quotes:

```javascript
pg(sql`SELECT * FROM ${sql.id('public', 'users')} WHERE id = ${1}`)
// { text: 'SELECT * FROM "public"."users" WHERE id = $1', values: [1] }

mysql(sql`SELECT * FROM ${sql.id('my table')}`)
// { text: 'SELECT * FROM `my table`' }
```

> Quoted identifiers are **case-sensitive** in Postgres, where unquoted names
> fold to lower case. `sql.id('userName')` refers to a column literally named
> `userName`, not `username`.

### Escape hatch

`sql.raw()` inserts unescaped text. It is the only unsafe helper — never give it
user input:

```javascript
pg(sql`SELECT * FROM t ORDER BY id ${sql.raw('DESC')}`)
```

### API

```typescript
sql`...`                                  // → Sql fragment (nestable)
sql.id(...parts: string[])                // safe, dialect-quoted identifier
sql.value(v: unknown)                     // bind as exactly one parameter
sql.join(items: unknown[], sep = ', ')    // join fragments/values
sql.raw(text: string)                     // unescaped SQL — unsafe with user input
sql.empty                                 // renders to nothing

pg(fragment) / mysql(fragment)            // → { text, values? }
```

---

## The `?` partials API

A query is a list mixing SQL fragments and values. Pass an array, an argument
list, or a single ready string:

```javascript
pg(['SELECT * FROM users WHERE id = ?', userId])   // array
pg('SELECT * FROM users WHERE id = ?', userId)     // arguments
pg('SELECT * FROM users')                          // ready string → { text }
```

For each SQL fragment the `?` are counted, and that many values must follow it:

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

### Object & list expansion

```javascript
// INSERT … VALUES ?
pg(['INSERT INTO users VALUES ?', { username: 'John', email: 'j@d.wtf' }, 'RETURNING id'])
// { text: 'INSERT INTO users (username,email) VALUES ($1,$2) RETURNING id',
//   values: ['John', 'j@d.wtf'] }

// UPDATE … SET ?
pg(['UPDATE users SET ?', { username: 'Biggie' }, 'WHERE id = ?', id])
// { text: 'UPDATE users SET username=$1 WHERE id = $2', values: ['Biggie', 123] }

// WHERE ?  (AND-joined equality)
pg(['SELECT * FROM users WHERE ?', { username: 'x', gender: 'male' }])
// { text: 'SELECT * FROM users WHERE username=$1 AND gender=$2', values: ['x', 'male'] }

// WHERE … IN ?
pg(['SELECT * FROM users WHERE id IN ?', [1, 2, 3]])
// { text: 'SELECT * FROM users WHERE id IN ($1,$2,$3)', values: [1, 2, 3] }
```

### Question marks that aren't placeholders

`simple-builder` lexes your SQL rather than counting `?`, so a `?` inside a
string literal, quoted identifier, comment, or dollar-quoted body is left alone,
and Postgres' `?|` / `?&` jsonb operators keep working:

```javascript
pg(["SELECT * FROM t WHERE tags ?| ARRAY['a'] AND id = ?", 5])
// { text: "SELECT * FROM t WHERE tags ?| ARRAY['a'] AND id = $1", values: [5] }
```

The **bare** jsonb `?` operator is genuinely ambiguous with a placeholder, so
escape it as `\?`:

```javascript
pg(["SELECT * FROM t WHERE data \\? 'key' AND id = ?", 7])
// { text: "SELECT * FROM t WHERE data ? 'key' AND id = $1", values: [7] }
```

…or just use the `sql` tag, where nothing is scanned and no escaping is needed:

```javascript
pg(sql`SELECT * FROM t WHERE data ? ${'key'} AND id = ${7}`)
```

---

## Security

**Values are always parameterised.** They go into the `values` array and never
into the SQL text, so they cannot cause injection — in either API.

**Identifiers cannot be parameterised** by any driver — placeholders name data,
never tables or columns. So `simple-builder` handles them two ways:

- **Object keys are allow-listed.** In `VALUES ?` / `SET ?` / `WHERE ?`, keys
  become column names, so only plain identifiers (`col`, `tbl.col`) are
  accepted. Anything else throws:

  ```javascript
  pg(['UPDATE users SET ?', req.body])
  // throws if req.body has a key like "x=1; DELETE FROM users; --"
  ```

  This is a backstop, not a licence — still choose the columns yourself:

  ```javascript
  pg(['UPDATE users SET ?', { username: req.body.username, email: req.body.email }])
  ```

- **`sql.id()` quotes** for the dynamic case, escaping embedded quotes.

**`sql.raw()` is unsafe by construction** — it exists for things like `ASC`/`DESC`
that cannot be parameterised. Map user input to a fixed set of allowed values
before it ever reaches `raw()`.

Two things the library cannot do for you:

- **LIKE wildcards.** A bound value in `LIKE ?` is injection-safe, but `%` and
  `_` inside it still act as wildcards. Escape them (`\%`, `\_`) if the value
  should be literal.
- **Second-order injection.** Data read back out of the database is not
  automatically safe to concatenate into new SQL — parameterise on the way out
  too.

### On MySQL, prefer `execute()` over `query()`

This is about the driver, not this library, but it affects you: `mysql2`'s
`query()` substitutes values **client-side** using backslash escaping
(`escape("it's")` → `'it\'s'`). Under `sql_mode=NO_BACKSLASH_ESCAPES` that
escaping is wrong — we measured it erroring outright and round-tripping `x\` as
`x\\`. `execute()` uses a real server-side prepared statement and is correct in
every mode:

```javascript
const q = mysql(['SELECT * FROM users WHERE id = ?', id])
const [rows] = await conn.execute(q.text, q.values)   // ← prefer this
```

## Non-default server modes

Three server settings change how SQL *lexes*, and therefore which `?` is a
placeholder. If you have changed them, tell the builder:

```javascript
const my = mysql.withMode({ ansiQuotes: true, noBackslashEscapes: true })
const pgOld = pg.withMode({ standardConformingStrings: false })
```

| Setting | Effect |
|---|---|
| `ansiQuotes` | MySQL `sql_mode=ANSI_QUOTES`: `"…"` is an identifier, not a string |
| `noBackslashEscapes` | MySQL `sql_mode=NO_BACKSLASH_ESCAPES`: `\` is ordinary in literals |
| `standardConformingStrings: false` | Postgres: `\` escapes inside `'…'` |

`withMode` returns a new builder and leaves the original alone. **You only need
it if your SQL puts a backslash immediately before a quote inside a literal** —
`''` doubling lexes identically in every mode, and the `sql` tag never lexes at
all, so both are mode-proof. All of the above is verified against real Postgres
16 and MySQL 8.4 across the full mode matrix.

## Requirements & compatibility

- Node.js **>= 16**. Works with the `pg`, `mysql`, and `mysql2` drivers.
- The `?` partials API is unchanged from 2.x — same call shapes, same output.
  Verified by a differential fuzzer against 2.4.2 on every CI run.
- See the [release notes](https://github.com/Acro/simple-builder/releases) for
  the 3.0.0 packaging changes, bug fixes, and the new `sql` tag.

## Contributing

See [`AGENTS.md`](./AGENTS.md) for the repo layout, build, and test commands.

## License

MIT
