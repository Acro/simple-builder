'use strict'

/**
 * Package-boundary smoke test. Runs against the INSTALLED package
 * (`require('simple-builder')`), not ../src or ../dist — CI packs the tarball,
 * installs it into a scratch consumer, copies this file in, and runs it.
 */
const assert = require('assert')
const { pg, mysql, sql } = require('simple-builder')
const def = require('simple-builder').default

// Exports present at the package boundary.
assert.strictEqual(typeof pg, 'function')
assert.strictEqual(typeof mysql, 'function')
assert.strictEqual(typeof sql, 'function')
assert.strictEqual(def.pg, pg)
assert.strictEqual(def.mysql, mysql)
assert.strictEqual(def.sql, sql)

// ── partials API ──
assert.deepStrictEqual(
  pg(['UPDATE users SET ?', { username: 'x', gender: 'male' }, 'WHERE id = ?', 7]),
  { text: 'UPDATE users SET username=$1,gender=$2 WHERE id = $3', values: ['x', 'male', 7] }
)

assert.deepStrictEqual(mysql('SELECT * FROM t WHERE id IN ?', [1, 2, 3]), {
  text: 'SELECT * FROM t WHERE id IN (?,?,?)',
  values: [1, 2, 3],
})

assert.deepStrictEqual(pg(['SELECT * FROM t']), { text: 'SELECT * FROM t' })

// ── lexer: jsonb operators survive ──
assert.deepStrictEqual(pg(["SELECT * FROM t WHERE tags ?| ARRAY['x'] AND id = ?", 5]), {
  text: "SELECT * FROM t WHERE tags ?| ARRAY['x'] AND id = $1",
  values: [5],
})

// ── identifier safety ──
assert.throws(() => pg(['UPDATE t SET ?', { 'x=1; DROP TABLE t; --': 1 }]), /not a valid column name/i)

// ── withMode ──
assert.strictEqual(typeof mysql.withMode, 'function')
assert.notStrictEqual(mysql.withMode({ ansiQuotes: true }), mysql)
assert.deepStrictEqual(mysql.withMode({ ansiQuotes: true })(['SELECT "a""b" AS s, ? AS n', 1]), {
  text: 'SELECT "a""b" AS s, ? AS n',
  values: [1],
})
assert.deepStrictEqual(
  pg.withMode({ standardConformingStrings: false })(["SELECT 'a\\'b ?' AS s, ? ::int AS n", 1]),
  { text: "SELECT 'a\\'b ?' AS s, $1 ::int AS n", values: [1] }
)

// ── sql tag ──
assert.deepStrictEqual(pg(sql`SELECT * FROM users WHERE id = ${42}`), {
  text: 'SELECT * FROM users WHERE id = $1',
  values: [42],
})
assert.deepStrictEqual(mysql(sql`SELECT * FROM users WHERE id = ${42}`), {
  text: 'SELECT * FROM users WHERE id = ?',
  values: [42],
})
assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id IN ${[1, 2]}`), {
  text: 'SELECT * FROM t WHERE id IN ($1,$2)',
  values: [1, 2],
})
assert.deepStrictEqual(pg(sql`SELECT * FROM ${sql.id('public', 'users')} WHERE a = ${1}`), {
  text: 'SELECT * FROM "public"."users" WHERE a = $1',
  values: [1],
})
assert.deepStrictEqual(
  pg(sql`SELECT * FROM t WHERE ${sql.join([sql`a = ${1}`, sql`b = ${2}`], ' AND ')}`),
  { text: 'SELECT * FROM t WHERE a = $1 AND b = $2', values: [1, 2] }
)

console.log('CJS package-boundary smoke: all checks passed')
