'use strict'

/**
 * Unit suite. Runs against the built package (`../dist`), under
 * `--unhandled-rejections=strict`. Covers the documented outputs (as exact
 * assertions), every bug fixed in 3.0.0, the lexer edge cases, identifier
 * safety, and the `sql` tagged-template API.
 */

const assert = require('assert')
const { pg, mysql, sql } = require('../dist/index')
const def = require('../dist/index').default

let passed = 0
const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── Exports ──────────────────────────────────────────────────────────────
test('exposes pg, mysql and sql as named exports and on the default export', () => {
  assert.strictEqual(typeof pg, 'function')
  assert.strictEqual(typeof mysql, 'function')
  assert.strictEqual(typeof sql, 'function')
  assert.strictEqual(def.pg, pg)
  assert.strictEqual(def.mysql, mysql)
  assert.strictEqual(def.sql, sql)
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
    { text: 'INSERT INTO users (username,gender) VALUES ($1,$2)', values: ['something', 'male'] }
  )
})

test('pg: hand-written INSERT with explicit placeholders', () => {
  assert.deepStrictEqual(
    pg('INSERT INTO users (username, gender) VALUES (?, ?)', 'something', 'male'),
    { text: 'INSERT INTO users (username, gender) VALUES ($1, $2)', values: ['something', 'male'] }
  )
})

test('pg: WHERE ? object expansion (AND-joined equality)', () => {
  assert.deepStrictEqual(pg('SELECT * FROM users WHERE ?', { username: 'something', gender: 'male' }), {
    text: 'SELECT * FROM users WHERE username=$1 AND gender=$2',
    values: ['something', 'male'],
  })
})

test('pg: Date values pass through untouched and are not expanded as objects', () => {
  const d = new Date('2026-01-01T00:00:00.000Z')
  assert.deepStrictEqual(pg('SELECT id FROM users WHERE created_at > ?', d), {
    text: 'SELECT id FROM users WHERE created_at > $1',
    values: [d],
  })
  // A Date directly after WHERE ? must bind, not expand into columns.
  assert.deepStrictEqual(pg('SELECT * FROM t WHERE ?', d), {
    text: 'SELECT * FROM t WHERE $1',
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
  assert.deepStrictEqual(pg('INSERT INTO users VALUES ?', { username: 'John' }, 'RETURNING id'), {
    text: 'INSERT INTO users (username) VALUES ($1) RETURNING id',
    values: ['John'],
  })
})

// ── mysql dialect ────────────────────────────────────────────────────────
test('mysql: keeps ? placeholders for scalars', () => {
  assert.deepStrictEqual(mysql(['SELECT * FROM users', 'WHERE id = ? AND username = ?', 1, 'John Doe']), {
    text: 'SELECT * FROM users WHERE id = ? AND username = ?',
    values: [1, 'John Doe'],
  })
})

test('mysql: object expansion still uses ? placeholders', () => {
  assert.deepStrictEqual(mysql('UPDATE users SET ?', { a: 1, b: 2 }, 'WHERE id = ?', 9), {
    text: 'UPDATE users SET a=?,b=? WHERE id = ?',
    values: [1, 2, 9],
  })
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

test("FIX: the caller's partials array is never mutated", () => {
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

test('FIX: too few values for the placeholders throws instead of binding undefined', () => {
  assert.throws(() => pg(['SELECT * FROM t WHERE a = ? AND b = ?', 1]), /but only 1 value/i)
})

test('FIX: OFFSET ? is not misread as the SET ? clause', () => {
  assert.deepStrictEqual(pg('SELECT * FROM t LIMIT 10 OFFSET ?', 20), {
    text: 'SELECT * FROM t LIMIT 10 OFFSET $1',
    values: [20],
  })
})

// ── Lexer: `?` that is NOT a placeholder ─────────────────────────────────
test('LEXER: postgres jsonb ?| and ?& operators survive alongside real placeholders', () => {
  assert.deepStrictEqual(pg(["SELECT * FROM t WHERE tags ?| ARRAY['x'] AND id = ?", 5]), {
    text: "SELECT * FROM t WHERE tags ?| ARRAY['x'] AND id = $1",
    values: [5],
  })
  assert.deepStrictEqual(pg(["SELECT * FROM t WHERE tags ?& ARRAY['x'] AND id = ?", 9]), {
    text: "SELECT * FROM t WHERE tags ?& ARRAY['x'] AND id = $1",
    values: [9],
  })
})

test('LEXER: \\? escapes a literal question mark (the bare jsonb ? operator)', () => {
  assert.deepStrictEqual(pg(["SELECT * FROM t WHERE data \\? 'key' AND id = ?", 7]), {
    text: "SELECT * FROM t WHERE data ? 'key' AND id = $1",
    values: [7],
  })
})

test('LEXER: ? inside a single-quoted string literal is not a placeholder', () => {
  assert.deepStrictEqual(pg(["SELECT 'why?' AS q FROM t WHERE id = ?", 1]), {
    text: "SELECT 'why?' AS q FROM t WHERE id = $1",
    values: [1],
  })
})

test("LEXER: '' escape inside a string literal is handled", () => {
  assert.deepStrictEqual(pg(["SELECT 'it''s a ?' AS q FROM t WHERE id = ?", 1]), {
    text: "SELECT 'it''s a ?' AS q FROM t WHERE id = $1",
    values: [1],
  })
})

test("LEXER: pg E'...' escape strings honour backslash escapes", () => {
  // Backslash escapes the quote inside E'…', so the string does not end early
  // and the `?` inside it is not a placeholder.
  assert.deepStrictEqual(pg(["SELECT E'a\\'b ?' AS s FROM t WHERE id = ?", 1]), {
    text: "SELECT E'a\\'b ?' AS s FROM t WHERE id = $1",
    values: [1],
  })
})

test('LEXER: pg standard strings treat backslash as an ordinary character', () => {
  // standard_conforming_strings: `\` does NOT escape, so this string ends at
  // the second quote and the trailing ? is the placeholder.
  assert.deepStrictEqual(pg(["SELECT 'a\\' AS s, ? AS n FROM t", 1]), {
    text: "SELECT 'a\\' AS s, $1 AS n FROM t",
    values: [1],
  })
})

test('LEXER: mysql honours backslash escapes in both quote styles', () => {
  assert.deepStrictEqual(mysql(["SELECT 'a\\'b ?' AS s FROM t WHERE id = ?", 1]), {
    text: "SELECT 'a\\'b ?' AS s FROM t WHERE id = ?",
    values: [1],
  })
  assert.deepStrictEqual(mysql(['SELECT "a\\"b ?" AS s FROM t WHERE id = ?', 1]), {
    text: 'SELECT "a\\"b ?" AS s FROM t WHERE id = ?',
    values: [1],
  })
})

test('LEXER: ? inside a quoted identifier is not a placeholder', () => {
  assert.deepStrictEqual(pg(['SELECT "we?ird" FROM t WHERE id = ?', 6]), {
    text: 'SELECT "we?ird" FROM t WHERE id = $1',
    values: [6],
  })
  assert.deepStrictEqual(mysql(['SELECT `we?ird` FROM t WHERE id = ?', 6]), {
    text: 'SELECT `we?ird` FROM t WHERE id = ?',
    values: [6],
  })
})

test('LEXER: ? inside line and block comments is not a placeholder', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM t -- what?\nWHERE id = ?', 2]), {
    text: 'SELECT * FROM t -- what?\nWHERE id = $1',
    values: [2],
  })
  assert.deepStrictEqual(pg(['SELECT * /* huh? */ FROM t WHERE id = ?', 8]), {
    text: 'SELECT * /* huh? */ FROM t WHERE id = $1',
    values: [8],
  })
})

test('LEXER: ? inside dollar-quoted strings (anonymous and tagged) is not a placeholder', () => {
  assert.deepStrictEqual(pg(['SELECT $$a ? b$$ AS s FROM t WHERE id = ?', 3]), {
    text: 'SELECT $$a ? b$$ AS s FROM t WHERE id = $1',
    values: [3],
  })
  assert.deepStrictEqual(pg(['SELECT $x$a ? b$x$ AS s FROM t WHERE id = ?', 4]), {
    text: 'SELECT $x$a ? b$x$ AS s FROM t WHERE id = $1',
    values: [4],
  })
})

test('LEXER: mysql `--` is only a comment when followed by whitespace', () => {
  // Verified against MySQL 8.4: `SELECT 1--2` is 3 (two minus signs), and
  // `SELECT 1--?` really does bind — so `--` must NOT swallow the placeholder.
  assert.deepStrictEqual(mysql(['SELECT 1--? AS v', 2]), {
    text: 'SELECT 1--? AS v',
    values: [2],
  })
  // With whitespace it IS a comment, so the ? inside is not a placeholder.
  assert.deepStrictEqual(mysql(['SELECT ? AS n -- note ? here\n', 1]), {
    text: 'SELECT ? AS n -- note ? here\n',
    values: [1],
  })
  // A bare `--` at end of input is a comment.
  assert.deepStrictEqual(mysql(['SELECT ? AS n --', 1]), { text: 'SELECT ? AS n --', values: [1] })
  // Postgres always treats `--` as a comment, no whitespace required — so here
  // the first ? is commented out and only the one on the next line binds.
  assert.deepStrictEqual(pg(['SELECT 1--? AS v\n, ? ::int AS n', 2]), {
    text: 'SELECT 1--? AS v\n, $1 ::int AS n',
    values: [2],
  })
})

test('LEXER: mysql # line comments are skipped; pg # starts an operator', () => {
  // MySQL: `#` runs to end of line, so the ? inside it is not a placeholder.
  assert.deepStrictEqual(
    mysql('SELECT * FROM t WHERE id = ? # note ? here\nAND active = ?', 1, true),
    { text: 'SELECT * FROM t WHERE id = ? # note ? here\nAND active = ?', values: [1, true] }
  )
  // Postgres has no # comment — #> and #- are jsonb operators and must survive.
  assert.deepStrictEqual(pg(["SELECT data #> '{a}' FROM t WHERE id = ?", 1]), {
    text: "SELECT data #> '{a}' FROM t WHERE id = $1",
    values: [1],
  })
  assert.deepStrictEqual(pg(["SELECT data #- '{a}' FROM t WHERE id = ?", 1]), {
    text: "SELECT data #- '{a}' FROM t WHERE id = $1",
    values: [1],
  })
})

test('LEXER: :: casts and $n text are left alone', () => {
  assert.deepStrictEqual(pg(['SELECT id::text FROM t WHERE id = ?', 1]), {
    text: 'SELECT id::text FROM t WHERE id = $1',
    values: [1],
  })
})

// ── Identifier safety ────────────────────────────────────────────────────
test('SECURITY: an injection payload as an object key is rejected', () => {
  assert.throws(() => pg(['UPDATE t SET ?', { 'x=1; DROP TABLE t; --': 'v' }]), /not a valid column name/i)
  assert.throws(() => pg(['INSERT INTO t VALUES ?', { 'a,b': 1 }]), /not a valid column name/i)
  assert.throws(() => pg(['SELECT * FROM t WHERE ?', { 'a"b': 1 }]), /not a valid column name/i)
})

test('SECURITY: plain and dotted identifiers still pass through byte-for-byte', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE ?', { 'u.id': 1, name_2$: 'x' }]), {
    text: 'SELECT * FROM t WHERE u.id=$1 AND name_2$=$2',
    values: [1, 'x'],
  })
})

test('SECURITY: IN ? values are never treated as identifiers', () => {
  // Array indices are keys here — they must not go through identifier checks.
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE id IN ?', ['; DROP TABLE t; --']]), {
    text: 'SELECT * FROM t WHERE id IN ($1)',
    values: ['; DROP TABLE t; --'],
  })
})

test('sql.id quotes per dialect and escapes embedded quotes', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM', sql.id('my table'), 'WHERE id = ?', 1]), {
    text: 'SELECT * FROM "my table" WHERE id = $1',
    values: [1],
  })
  assert.deepStrictEqual(pg(['SELECT * FROM', sql.id('ev"il'), 'WHERE id = ?', 1]), {
    text: 'SELECT * FROM "ev""il" WHERE id = $1',
    values: [1],
  })
  assert.deepStrictEqual(mysql(['SELECT * FROM', sql.id('we`ird'), 'WHERE id = ?', 1]), {
    text: 'SELECT * FROM `we``ird` WHERE id = ?',
    values: [1],
  })
})

test('sql.id joins parts with a dot for schema qualification', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM ${sql.id('public', 'users')} WHERE id = ${1}`), {
    text: 'SELECT * FROM "public"."users" WHERE id = $1',
    values: [1],
  })
})

test('sql.id rejects NUL and non-strings', () => {
  assert.throws(() => pg(sql`SELECT * FROM ${sql.id('a\0b')}`), /NUL/i)
  assert.throws(() => pg(sql`SELECT * FROM ${sql.id('')}`), /non-empty string/i)
})

// ── Markers at a value position ──────────────────────────────────────────
// The marker classes are objects, so a clause marker before the `?` must not
// enumerate their internal fields (`parts`/`text`/`nodes`/`value`) as columns.
test('MARKERS: sql.id at a clause-marker value position splices, never expands', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE ?', sql.id('foo')]), {
    text: 'SELECT * FROM t WHERE "foo"',
  })
  assert.deepStrictEqual(pg(['INSERT INTO t VALUES ?', sql.id('foo')]), {
    text: 'INSERT INTO t VALUES "foo"',
  })
  assert.deepStrictEqual(pg(['UPDATE t SET ?', sql.id('foo')]), {
    text: 'UPDATE t SET "foo"',
  })
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE id IN ?', sql.id('foo')]), {
    text: 'SELECT * FROM t WHERE id IN "foo"',
  })
})

test('MARKERS: sql.raw / sql.value at a clause-marker value position', () => {
  assert.deepStrictEqual(pg(['UPDATE t SET ?', sql.raw('a=1')]), { text: 'UPDATE t SET a=1' })
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE id IN ?', sql.value([1, 2])]), {
    text: 'SELECT * FROM t WHERE id IN $1',
    values: [[1, 2]],
  })
})

test('MARKERS: an sql`` fragment at a value position splices with continuous numbering', () => {
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE ?', sql`a = ${1}`]), {
    text: 'SELECT * FROM t WHERE a = $1',
    values: [1],
  })
  // Also without a clause marker, and with numbering continuing across it.
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE x = ?', 9, 'AND ?', sql`a = ${1}`, 'AND b = ?', 2]), {
    text: 'SELECT * FROM t WHERE x = $1 AND a = $2 AND b = $3',
    values: [9, 1, 2],
  })
})

test('MARKERS: a plain object still expands at a clause marker', () => {
  // The reordering must not break the ordinary Row path.
  assert.deepStrictEqual(pg(['SELECT * FROM t WHERE ?', { a: 1, b: 2 }]), {
    text: 'SELECT * FROM t WHERE a=$1 AND b=$2',
    values: [1, 2],
  })
})

// ── The sql tagged-template API ──────────────────────────────────────────
test('sql: interpolations are always parameterised, in both dialects', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM users WHERE id = ${42}`), {
    text: 'SELECT * FROM users WHERE id = $1',
    values: [42],
  })
  assert.deepStrictEqual(mysql(sql`SELECT * FROM users WHERE id = ${42}`), {
    text: 'SELECT * FROM users WHERE id = ?',
    values: [42],
  })
})

test('sql: an injection payload stays a bound value', () => {
  const evil = '1; DROP TABLE users; --'
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id = ${evil}`), {
    text: 'SELECT * FROM t WHERE id = $1',
    values: [evil],
  })
})

test('sql: a bare jsonb ? operator needs no escaping in the tag', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE data ? ${'key'} AND id = ${1}`), {
    text: 'SELECT * FROM t WHERE data ? $1 AND id = $2',
    values: ['key', 1],
  })
})

test('sql: arrays expand to a parenthesised list (the IN form)', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id IN ${[1, 2, 3]}`), {
    text: 'SELECT * FROM t WHERE id IN ($1,$2,$3)',
    values: [1, 2, 3],
  })
})

test('sql.value forces a single bound parameter for an array', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE tags = ${sql.value([1, 2])}`), {
    text: 'SELECT * FROM t WHERE tags = $1',
    values: [[1, 2]],
  })
})

test('sql: fragments compose by nesting, numbering stays continuous', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE ${sql`a = ${1}`} AND ${sql`b = ${2}`}`), {
    text: 'SELECT * FROM t WHERE a = $1 AND b = $2',
    values: [1, 2],
  })
})

test('sql.join joins fragments with a separator', () => {
  assert.deepStrictEqual(
    pg(sql`SELECT * FROM t WHERE ${sql.join([sql`a = ${1}`, sql`b = ${2}`], ' AND ')}`),
    { text: 'SELECT * FROM t WHERE a = $1 AND b = $2', values: [1, 2] }
  )
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE id IN (${sql.join([1, 2])})`), {
    text: 'SELECT * FROM t WHERE id IN ($1, $2)',
    values: [1, 2],
  })
})

test('sql.raw injects unescaped text and binds nothing', () => {
  assert.deepStrictEqual(pg(sql`SELECT * FROM t ORDER BY id ${sql.raw('DESC')}`), {
    text: 'SELECT * FROM t ORDER BY id DESC',
  })
})

test('sql.empty renders to nothing and is usable as a conditional', () => {
  const cond = false
  assert.deepStrictEqual(pg(sql`SELECT * FROM t${cond ? sql` WHERE a = ${1}` : sql.empty}`), {
    text: 'SELECT * FROM t',
  })
})

test('sql: a fragment with no values has no values property', () => {
  assert.deepStrictEqual(pg(sql`SELECT 1`), { text: 'SELECT 1' })
})

test('sql: null / false / Date interpolate as bound values', () => {
  const d = new Date('2026-01-01T00:00:00.000Z')
  assert.deepStrictEqual(pg(sql`SELECT * FROM t WHERE a = ${null} AND b = ${false} AND c > ${d}`), {
    text: 'SELECT * FROM t WHERE a = $1 AND b = $2 AND c > $3',
    values: [null, false, d],
  })
})

test('sql: the same fragment can be rendered for both dialects independently', () => {
  const frag = sql`SELECT * FROM t WHERE id = ${1} AND b = ${2}`
  assert.deepStrictEqual(pg(frag), { text: 'SELECT * FROM t WHERE id = $1 AND b = $2', values: [1, 2] })
  assert.deepStrictEqual(mysql(frag), { text: 'SELECT * FROM t WHERE id = ? AND b = ?', values: [1, 2] })
  // Rendering must not consume/mutate the fragment.
  assert.deepStrictEqual(pg(frag), { text: 'SELECT * FROM t WHERE id = $1 AND b = $2', values: [1, 2] })
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
