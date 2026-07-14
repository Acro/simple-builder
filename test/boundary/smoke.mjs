// ESM package-boundary smoke test: named imports resolve through the exports
// map's `import` condition, and the default import is the { pg, mysql } object.
import assert from 'assert'
import simpleBuilder, { pg, mysql } from 'simple-builder'

assert.strictEqual(typeof pg, 'function', 'named pg import must be the function')
assert.strictEqual(typeof mysql, 'function', 'named mysql import must be the function')
assert.strictEqual(simpleBuilder.pg, pg)
assert.strictEqual(simpleBuilder.mysql, mysql)

assert.deepStrictEqual(
  pg('SELECT * FROM users WHERE ?', { email: 'a@b.c' }),
  { text: 'SELECT * FROM users WHERE email=$1', values: ['a@b.c'] }
)

assert.deepStrictEqual(
  mysql(['INSERT INTO t VALUES ?', { a: 1, b: 2 }]),
  { text: 'INSERT INTO t (a,b) VALUES (?,?)', values: [1, 2] }
)

console.log('ESM package-boundary smoke: all checks passed')
