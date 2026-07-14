'use strict'

/**
 * Integration tests against REAL Postgres and MySQL servers.
 *
 * The unit suite asserts on the generated `{ text, values }` — which only ever
 * proves the builder agrees with *our reading* of the SQL grammars. This suite
 * executes the built queries and asserts on the rows that come back, so the
 * lexer's grammar assumptions are checked against the engines themselves.
 * (Both of the lexer bugs found so far — pg `E'…'` escapes and MySQL's
 * whitespace-after-`--` rule — were exactly that kind of mistake.)
 *
 * Config (CI sets these; both default to the docker-compose-ish local ports):
 *   PG_URL     postgres://postgres:secret@localhost:55432/sbtest
 *   MYSQL_URL  mysql://root:secret@127.0.0.1:53306/sbtest
 *
 * Usage: node test/integration.cjs
 */

const assert = require('assert')
const { Client } = require('pg')
const mysql = require('mysql2/promise')
const { pg, mysql: my, sql } = require('../dist/index')

const PG_URL = process.env.PG_URL || 'postgres://postgres:secret@localhost:55432/sbtest'
const MYSQL_URL = process.env.MYSQL_URL || 'mysql://root:secret@127.0.0.1:53306/sbtest'

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])

// Run a built query and return the rows. `q` is a BuildResult.
const runPg = async (client, q) => (await client.query(q.text, q.values || [])).rows
const runMy = async (conn, q) => (await conn.query(q.text, q.values || []))[0]

// ─────────────────────────────────────────────────────────────────────────
// Postgres
// ─────────────────────────────────────────────────────────────────────────

test('pg: values round-trip through INSERT ... VALUES ? / SELECT ... WHERE ?', async (c) => {
  await runPg(c, pg(['INSERT INTO users VALUES ?', { username: 'ada', gender: 'f', age: 36 }]))
  const rows = await runPg(c, pg(['SELECT username, age FROM users WHERE ?', { username: 'ada' }]))
  assert.deepStrictEqual(rows, [{ username: 'ada', age: 36 }])
})

test('pg: UPDATE ... SET ? applies to the right row', async (c) => {
  await runPg(c, pg(['INSERT INTO users VALUES ?', { username: 'grace', gender: 'f', age: 45 }]))
  await runPg(c, pg(['UPDATE users SET ?', { age: 46 }, 'WHERE username = ?', 'grace']))
  const rows = await runPg(c, pg(['SELECT age FROM users WHERE username = ?', 'grace']))
  assert.deepStrictEqual(rows, [{ age: 46 }])
})

test('pg: WHERE ... IN ? matches exactly the listed rows', async (c) => {
  const rows = await runPg(
    c,
    pg(['SELECT username FROM users WHERE username IN ?', ['ada', 'grace'], 'ORDER BY username'])
  )
  assert.deepStrictEqual(rows.map((r) => r.username), ['ada', 'grace'])
})

test('pg: $1..$n numbering is correct across mixed clauses', async (c) => {
  const rows = await runPg(
    c,
    pg(['SELECT username FROM users WHERE ?', { gender: 'f' }, 'AND age IN ?', [36, 46], 'AND username <> ?', 'nobody', 'ORDER BY username'])
  )
  assert.deepStrictEqual(rows.map((r) => r.username), ['ada', 'grace'])
})

test('pg: an injection payload is stored as literal data, not executed', async (c) => {
  const evil = "'; DROP TABLE users; --"
  await runPg(c, pg(['INSERT INTO users VALUES ?', { username: evil, gender: 'x', age: 1 }]))
  // The table still exists and the payload came back verbatim.
  const rows = await runPg(c, pg(['SELECT username FROM users WHERE username = ?', evil]))
  assert.deepStrictEqual(rows, [{ username: evil }])
  await runPg(c, pg(['DELETE FROM users WHERE username = ?', evil]))
})

test('pg: sql tag parameterises an injection payload', async (c) => {
  const evil = "1; DROP TABLE users; --"
  const rows = await runPg(c, pg(sql`SELECT ${evil}::text AS v`))
  assert.deepStrictEqual(rows, [{ v: evil }])
})

test('pg: jsonb ?| and ?& operators execute correctly alongside a placeholder', async (c) => {
  const rows = await runPg(
    c,
    pg([`SELECT '{"k":1,"z":2}'::jsonb ?| ARRAY['k','nope'] AS any_of, '{"k":1,"z":2}'::jsonb ?& ARRAY['k','z'] AS all_of, ? ::int AS n`, 7])
  )
  assert.deepStrictEqual(rows, [{ any_of: true, all_of: true, n: 7 }])
})

test('pg: the bare jsonb ? operator works via the \\? escape', async (c) => {
  const rows = await runPg(c, pg([`SELECT '{"k":1}'::jsonb \\? 'k' AS has_k, ? ::int AS n`, 3]))
  assert.deepStrictEqual(rows, [{ has_k: true, n: 3 }])
})

test('pg: the bare jsonb ? operator needs no escape in the sql tag', async (c) => {
  const rows = await runPg(c, pg(sql`SELECT '{"k":1}'::jsonb ? ${'k'} AS has_k, ${3}::int AS n`))
  assert.deepStrictEqual(rows, [{ has_k: true, n: 3 }])
})

test('pg: #> and #- are operators, not comments', async (c) => {
  const rows = await runPg(
    c,
    pg([`SELECT '{"a":{"b":1}}'::jsonb #> '{a,b}' AS got, '{"a":1,"b":2}'::jsonb #- '{a}' AS deleted, ? ::int AS n`, 5])
  )
  assert.deepStrictEqual(rows, [{ got: 1, deleted: { b: 2 }, n: 5 }])
})

test('pg: ? inside string literals, dollar-quotes and comments is not a placeholder', async (c) => {
  const rows = await runPg(c, pg(["SELECT 'why?' AS a, $$d ? q$$ AS b, $x$t ? q$x$ AS c, ? ::int AS n -- trailing ?\n", 1]))
  assert.deepStrictEqual(rows, [{ a: 'why?', b: 'd ? q', c: 't ? q', n: 1 }])
})

test("pg: E'...' honours backslash escapes; a standard string does not", async (c) => {
  // E'a\'b ?' → the ? is inside the string; the real placeholder is the second.
  const rows = await runPg(c, pg(["SELECT E'a\\'b ?' AS e, ? ::int AS n", 2]))
  assert.deepStrictEqual(rows, [{ e: "a'b ?", n: 2 }])
  // standard_conforming_strings: backslash is literal, so this string ends at
  // the second quote and the trailing ? is the placeholder.
  const rows2 = await runPg(c, pg(["SELECT 'a\\' AS s, ? ::int AS n", 4]))
  assert.deepStrictEqual(rows2, [{ s: 'a\\', n: 4 }])
})

test('pg: sql.id quotes identifiers, and quoting is case-sensitive', async (c) => {
  // The column is created case-sensitively, so only the quoted form finds it.
  const rows = await runPg(c, pg(['SELECT', sql.id('MixedCase'), 'FROM quoted WHERE id = ?', 1]))
  assert.deepStrictEqual(rows, [{ MixedCase: 'v' }])
})

test('pg: sql.id escapes an embedded double quote', async (c) => {
  const rows = await runPg(c, pg(['SELECT', sql.id('ev"il'), 'FROM quoted WHERE id = ?', 1]))
  assert.deepStrictEqual(rows, [{ 'ev"il': 'w' }])
})

test('pg: sql.id schema-qualifies', async (c) => {
  const rows = await runPg(c, pg(sql`SELECT count(*)::int AS n FROM ${sql.id('public', 'users')}`))
  assert.ok(rows[0].n >= 2)
})

test('pg: sql tag composes fragments with correct numbering', async (c) => {
  const where = sql.join([sql`gender = ${'f'}`, sql`age >= ${40}`], ' AND ')
  const rows = await runPg(c, pg(sql`SELECT username FROM users WHERE ${where} ORDER BY username`))
  assert.deepStrictEqual(rows.map((r) => r.username), ['grace'])
})

test('pg: an sql`` fragment spliced at a ? value position executes', async (c) => {
  const rows = await runPg(c, pg(['SELECT username FROM users WHERE ?', sql`age = ${36}`]))
  assert.deepStrictEqual(rows.map((r) => r.username), ['ada'])
})

test('pg: LIKE wildcards in a bound value still act as wildcards (documented)', async (c) => {
  const rows = await runPg(c, pg(['SELECT username FROM users WHERE username LIKE ? ORDER BY username', '%a%']))
  assert.ok(rows.length >= 2, 'the % in the value matched as a wildcard, as documented')
})

// ─────────────────────────────────────────────────────────────────────────
// MySQL
// ─────────────────────────────────────────────────────────────────────────

test('mysql: values round-trip through INSERT ... VALUES ? / SELECT ... WHERE ?', async (_c, m) => {
  await runMy(m, my(['INSERT INTO users VALUES ?', { username: 'ada', gender: 'f', age: 36 }]))
  const rows = await runMy(m, my(['SELECT username, age FROM users WHERE ?', { username: 'ada' }]))
  assert.deepStrictEqual(rows.map((r) => ({ username: r.username, age: r.age })), [{ username: 'ada', age: 36 }])
})

test('mysql: UPDATE ... SET ? applies to the right row', async (_c, m) => {
  await runMy(m, my(['INSERT INTO users VALUES ?', { username: 'grace', gender: 'f', age: 45 }]))
  await runMy(m, my(['UPDATE users SET ?', { age: 46 }, 'WHERE username = ?', 'grace']))
  const rows = await runMy(m, my(['SELECT age FROM users WHERE username = ?', 'grace']))
  assert.strictEqual(rows[0].age, 46)
})

test('mysql: WHERE ... IN ? matches exactly the listed rows', async (_c, m) => {
  const rows = await runMy(m, my(['SELECT username FROM users WHERE username IN ?', ['ada', 'grace'], 'ORDER BY username']))
  assert.deepStrictEqual(rows.map((r) => r.username), ['ada', 'grace'])
})

test('mysql: an injection payload is stored as literal data, not executed', async (_c, m) => {
  const evil = "'; DROP TABLE users; --"
  await runMy(m, my(['INSERT INTO users VALUES ?', { username: evil, gender: 'x', age: 1 }]))
  const rows = await runMy(m, my(['SELECT username FROM users WHERE username = ?', evil]))
  assert.deepStrictEqual(rows.map((r) => r.username), [evil])
  await runMy(m, my(['DELETE FROM users WHERE username = ?', evil]))
})

test('mysql: # line comment is not scanned for placeholders', async (_c, m) => {
  const rows = await runMy(m, my(['SELECT ? AS n # note ? here\n', 1]))
  assert.strictEqual(rows[0].n, 1)
})

test('mysql: `--` is only a comment when followed by whitespace', async (_c, m) => {
  // `-- ` (with space) → comment: the trailing ? is not a placeholder.
  const rows = await runMy(m, my(['SELECT ? AS n -- note ? here\n', 1]))
  assert.strictEqual(rows[0].n, 1)
  // `--?` (no space) → NOT a comment: two minus signs, so ? really binds.
  // 1--2 === 3 in MySQL.
  const rows2 = await runMy(m, my(['SELECT 1--? AS v', 2]))
  assert.strictEqual(Number(rows2[0].v), 3)
})

test('mysql: ? inside string literals and backslash escapes is not a placeholder', async (_c, m) => {
  const rows = await runMy(m, my(["SELECT 'why?' AS a, 'a\\'b ?' AS b, ? AS n", 1]))
  assert.strictEqual(rows[0].a, 'why?')
  assert.strictEqual(rows[0].b, "a'b ?")
  assert.strictEqual(rows[0].n, 1)
})

test('mysql: sql.id quotes with backticks and escapes an embedded backtick', async (_c, m) => {
  const rows = await runMy(m, my(['SELECT', sql.id('we`ird'), 'FROM quoted WHERE id = ?', 1]))
  assert.strictEqual(rows[0]['we`ird'], 'v')
})

test('mysql: sql tag composes fragments', async (_c, m) => {
  const where = sql.join([sql`gender = ${'f'}`, sql`age >= ${40}`], ' AND ')
  const rows = await runMy(m, my(sql`SELECT username FROM users WHERE ${where} ORDER BY username`))
  assert.deepStrictEqual(rows.map((r) => r.username), ['grace'])
})

// ─────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────

const schema = {
  pg: [
    'DROP TABLE IF EXISTS users',
    'DROP TABLE IF EXISTS quoted',
    'CREATE TABLE users (username text, gender text, age int)',
    'CREATE TABLE quoted (id int, "MixedCase" text, "ev""il" text)',
    `INSERT INTO quoted VALUES (1, 'v', 'w')`,
  ],
  mysql: [
    'DROP TABLE IF EXISTS users',
    'DROP TABLE IF EXISTS quoted',
    'CREATE TABLE users (username varchar(64), gender varchar(8), age int)',
    'CREATE TABLE quoted (id int, `we``ird` varchar(8))',
    "INSERT INTO quoted VALUES (1, 'v')",
  ],
}

;(async () => {
  const client = new Client({ connectionString: PG_URL })
  await client.connect()
  const conn = await mysql.createConnection(MYSQL_URL)

  for (const stmt of schema.pg) await client.query(stmt)
  for (const stmt of schema.mysql) await conn.query(stmt)

  for (const [name, fn] of tests) {
    try {
      await fn(client, conn)
      passed++
    } catch (err) {
      console.error(`✗ ${name}`)
      console.error(err && err.stack ? err.stack : err)
      await client.end()
      await conn.end()
      process.exit(1)
    }
  }

  await client.end()
  await conn.end()
  console.log(`✓ ${passed}/${tests.length} integration tests passed against real Postgres + MySQL`)
})().catch((err) => {
  console.error('Integration setup failed:', err && err.message ? err.message : err)
  console.error('\nStart servers with:')
  console.error('  docker run -d --name sb-pg -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=sbtest -p 55432:5432 postgres:16-alpine')
  console.error('  docker run -d --name sb-mysql -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=sbtest -p 53306:3306 mysql:8')
  process.exit(1)
})
