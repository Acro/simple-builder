// ESM package-boundary smoke test: named imports resolve through the exports
// map's `import` condition, and the default import is the { pg, mysql, sql } object.
import assert from 'assert'
import simpleBuilder, { pg, mysql, sql } from 'simple-builder'

assert.strictEqual(typeof pg, 'function', 'named pg import must be the function')
assert.strictEqual(typeof mysql, 'function', 'named mysql import must be the function')
assert.strictEqual(typeof sql, 'function', 'named sql import must be the tag')
assert.strictEqual(simpleBuilder.pg, pg)
assert.strictEqual(simpleBuilder.mysql, mysql)
assert.strictEqual(simpleBuilder.sql, sql)

// partials API
assert.deepStrictEqual(pg('SELECT * FROM users WHERE ?', { email: 'a@b.c' }), {
  text: 'SELECT * FROM users WHERE email=$1',
  values: ['a@b.c'],
})
assert.deepStrictEqual(mysql(['INSERT INTO t VALUES ?', { a: 1, b: 2 }]), {
  text: 'INSERT INTO t (a,b) VALUES (?,?)',
  values: [1, 2],
})

// sql tag, composition and identifiers
assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id = ${1} AND name = ${'x'}`), {
  text: 'SELECT * FROM t WHERE id = $1 AND name = $2',
  values: [1, 'x'],
})
assert.deepStrictEqual(pg(sql`SELECT * FROM ${sql.id('users')} WHERE id IN ${[1, 2, 3]}`), {
  text: 'SELECT * FROM "users" WHERE id IN ($1,$2,$3)',
  values: [1, 2, 3],
})

// an injection payload stays a bound value
const evil = "1; DROP TABLE users; --"
assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id = ${evil}`), {
  text: 'SELECT * FROM t WHERE id = $1',
  values: [evil],
})

console.log('ESM package-boundary smoke: all checks passed')
