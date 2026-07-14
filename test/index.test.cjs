'use strict'

/**
 * Unit suite. Runs against the built package (`../dist`), under
 * `--unhandled-rejections=strict`. Covers the documented outputs (as exact
 * assertions, replacing the old console.log script) plus regression tests for
 * every bug fixed in 3.0.0.
 */

const assert = require('assert')
const { pg, mysql } = require('../dist/index')
const def = require('../dist/index').default

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── Exports ──────────────────────────────────────────────────────────────
test('exposes pg and mysql as named exports and on the default export', () => {
  assert.strictEqual(typeof pg, 'function')
  assert.strictEqual(typeof mysql, 'function')
  assert.strictEqual(def.pg, pg)
  assert.strictEqual(def.mysql, mysql)
})

// ── Documented behaviour (was test/build_query.js) ───────────────────────
test('pg: scalars, OR, repeated params, projection array', () => {
  const projection = ['id', 'username']
  assert.deepStrictEqual(
    pg([
      'SELECT', projection, 'FROM users',
      'WHERE id = ? AND username = ?', 123, 'sadasd?asdasd',
      'OR id = ?', 123,
      'AND username = ?', 'sadasd?asdasd',
    ]),
    {
      text: 'SELECT id,username FROM users WHERE id = $1 AND username = $2 OR id = $3 AND username = $4',
      values: [123, 'sadasd?asdasd', 123, 'sadasd?asdasd'],
    }
  )
})

test('pg: no parameters means no values property', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM users']), { text: 'SELECT * FROM users' })
})

test('pg: varargs call shape', () => {
  assert.deepStrictEqual(pg('SELECT', ['id', 'username'], 'FROM users'), {
    text: 'SELECT id,username FROM users',
  })
})

test('pg: a single ready string returns it verbatim', () => {
  assert.deepStrictEqual(pg('SELECT * FROM users'), { text: 'SELECT * FROM users' })
})

test('pg: UPDATE ... SET ? with a trailing WHERE', () => {
  assert.deepStrictEqual(
    pg([
      'UPDATE users SET ?', { username: 'something', gender: 'male' },
      'WHERE user_id = ? AND is_hidden = ?', 123, false,
    ]),
    {
      text: 'UPDATE users SET username=$1,gender=$2 WHERE user_id = $3 AND is_hidden = $4',
      values: ['something', 'male', 123, false],
    }
  )
})

test('pg: INSERT ... VALUES ? object expansion', () => {
  assert.deepStrictEqual(
    pg(['INSERT INTO', 'users', 'VALUES ?', { username: 'something', gender: 'male' }]),
    {
      text: 'INSERT INTO users (username,gender) VALUES ($1,$2)',
      values: ['something', 'male'],
    }
  )
})

test('pg: hand-written INSERT with explicit placeholders', () => {
  assert.deepStrictEqual(
    pg('INSERT INTO users (username, gender) VALUES (?, ?)', 'something', 'male'),
    {
      text: 'INSERT INTO users (username, gender) VALUES ($1, $2)',
      values: ['something', 'male'],
    }
  )
})

test('pg: WHERE ? object expansion (AND-joined equality)', () => {
  assert.deepStrictEqual(pg('SELECT * FROM users WHERE ?', { username: 'something', gender: 'male' }), {
    text: 'SELECT * FROM users WHERE username=$1 AND gender=$2',
    values: ['something', 'male'],
  })
})

test('pg: Date values pass through untouched', () => {
  const d = new Date('2026-01-01T00:00:00.000Z')
  assert.deepStrictEqual(pg('SELECT id FROM users WHERE created_at > ?', d), {
    text: 'SELECT id FROM users WHERE created_at > $1',
    values: [d],
  })
})

test('pg: WHERE IN ? expands an array', () => {
  assert.deepStrictEqual(pg('SELECT id FROM users WHERE user_id IN ?', [1, 2, 3]), {
    text: 'SELECT id FROM users WHERE user_id IN ($1,$2,$3)',
    values: [1, 2, 3],
  })
})

test('pg: RETURNING clause survives after VALUES ?', () => {
  assert.deepStrictEqual(
    pg('INSERT INTO users VALUES ?', { username: 'John' }, 'RETURNING id'),
    { text: 'INSERT INTO users (username) VALUES ($1) RETURNING id', values: ['John'] }
  )
})

// ── mysql dialect ────────────────────────────────────────────────────────
test('mysql: keeps ? placeholders for scalars', () => {
  assert.deepStrictEqual(
    mysql(['SELECT * FROM users', 'WHERE id = ? AND username = ?', 1, 'John Doe']),
    { text: 'SELECT * FROM users WHERE id = ? AND username = ?', values: [1, 'John Doe'] }
  )
})

test('mysql: object expansion still uses ? placeholders', () => {
  assert.deepStrictEqual(
    mysql('UPDATE users SET ?', { a: 1, b: 2 }, 'WHERE id = ?', 9),
    { text: 'UPDATE users SET a=?,b=? WHERE id = ?', values: [1, 2, 9] }
  )
})

test('mysql: IN ? expansion', () => {
  assert.deepStrictEqual(mysql('SELECT * FROM t WHERE id IN ?', [1, 2, 3]), {
    text: 'SELECT * FROM t WHERE id IN (?,?,?)',
    values: [1, 2, 3],
  })
})

// ── Regression tests for 3.0.0 bug fixes ─────────────────────────────────
test('FIX: lowercase "in ?" is expanded (was left as a literal placeholder)', () => {
  assert.deepStrictEqual(pg('SELECT * FROM t WHERE id in ?', [1, 2, 3]), {
    text: 'SELECT * FROM t WHERE id in ($1,$2,$3)',
    values: [1, 2, 3],
  })
  assert.deepStrictEqual(mysql('SELECT * FROM t WHERE id in ?', [7, 8]), {
    text: 'SELECT * FROM t WHERE id in (?,?)',
    values: [7, 8],
  })
})

test('FIX: the caller\'s partials array is never mutated', () => {
  const projection = ['id', 'name']
  const partials = ['SELECT', projection, 'FROM t']
  pg(partials)
  assert.deepStrictEqual(partials, ['SELECT', ['id', 'name'], 'FROM t'])
  assert.deepStrictEqual(projection, ['id', 'name'])
})

test('FIX: an empty object throws a clear error instead of emitting invalid SQL', () => {
  assert.throws(() => pg('INSERT INTO t VALUES ?', {}), /empty object/i)
  assert.throws(() => pg('UPDATE t SET ?', {}), /empty object/i)
  assert.throws(() => pg('SELECT * FROM t WHERE ?', {}), /empty object/i)
})

test('FIX: a stray value with no preceding placeholder throws a helpful error', () => {
  assert.throws(() => pg(['SELECT * FROM t', 42]), /expected an SQL string/i)
})

// ── Edge cases ───────────────────────────────────────────────────────────
test('null and boolean values are bound, not inlined', () => {
  assert.deepStrictEqual(pg('SELECT * FROM t WHERE a = ? AND b = ?', null, false), {
    text: 'SELECT * FROM t WHERE a = $1 AND b = $2',
    values: [null, false],
  })
})

test('WHERE ? object followed by a trailing scalar placeholder', () => {
  assert.deepStrictEqual(pg('SELECT * FROM t WHERE ? AND active = ?', { a: 1 }, true), {
    text: 'SELECT * FROM t WHERE a=$1 AND active = $2',
    values: [1, true],
  })
})

test('pg placeholder numbering is continuous across mixed clauses', () => {
  const q = pg([
    'UPDATE t SET ?', { a: 1, b: 2 },
    'WHERE id IN ?', [10, 11],
    'AND status = ?', 'x',
  ])
  assert.strictEqual(q.text, 'UPDATE t SET a=$1,b=$2 WHERE id IN ($3,$4) AND status = $5')
  assert.deepStrictEqual(q.values, [1, 2, 10, 11, 'x'])
})

// ── Runner ───────────────────────────────────────────────────────────────
;(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn()
      passed++
    } catch (err) {
      console.error(`✗ ${name}`)
      console.error(err && err.stack ? err.stack : err)
      process.exit(1)
    }
  }
  console.log(`✓ ${passed}/${tests.length} unit tests passed`)
})()
