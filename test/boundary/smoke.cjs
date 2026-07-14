'use strict'

/**
 * Package-boundary smoke test. Runs against the INSTALLED package
 * (`require('simple-builder')`), not ../src or ../dist — CI packs the tarball,
 * installs it into a scratch consumer, copies this file in, and runs it.
 */
const assert = require('assert')
const { pg, mysql } = require('simple-builder')
const def = require('simple-builder').default

// Exports present at the package boundary.
assert.strictEqual(typeof pg, 'function')
assert.strictEqual(typeof mysql, 'function')
assert.strictEqual(def.pg, pg)
assert.strictEqual(def.mysql, mysql)

// pg placeholder rewriting + object expansion.
assert.deepStrictEqual(
  pg(['UPDATE users SET ?', { username: 'x', gender: 'male' }, 'WHERE id = ?', 7]),
  { text: 'UPDATE users SET username=$1,gender=$2 WHERE id = $3', values: ['x', 'male', 7] }
)

// mysql keeps ? placeholders.
assert.deepStrictEqual(
  mysql('SELECT * FROM t WHERE id IN ?', [1, 2, 3]),
  { text: 'SELECT * FROM t WHERE id IN (?,?,?)', values: [1, 2, 3] }
)

// No-parameter query has no values property.
assert.deepStrictEqual(pg(['SELECT * FROM t']), { text: 'SELECT * FROM t' })

console.log('CJS package-boundary smoke: all checks passed')
