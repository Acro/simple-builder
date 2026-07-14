'use strict'

/**
 * Differential fuzzer. Generates seeded random queries and checks the 3.x
 * implementation (`../dist`) against the original 2.4.2 builder
 * (`./legacy-oracle.cjs`, vendored verbatim) for byte-identical output.
 *
 * The generator stays inside the domain where the two MUST agree: it never
 * emits the inputs whose behaviour 3.0.0 intentionally changed (lowercase
 * `in ?`, empty objects). Those fixes are covered by the unit suite. Any other
 * divergence is a real regression, and the seed + scenario is printed for exact
 * reproduction.
 *
 * Usage: node test/fuzz.cjs [iterations] [seed]
 */

const assert = require('assert')
const dist = require('../dist/index')
const legacy = require('./legacy-oracle.cjs')

const ITERATIONS = Number(process.argv[2]) || 2000
const BASE_SEED = Number(process.argv[3]) || 0x5119b1

// xorshift32 — deterministic, seedable.
const prng = (seed) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
}

const COLUMNS = ['id', 'user_id', 'username', 'gender', 'email', 'status', 'age', 'is_hidden', 'created_at']
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)]

const randScalar = (rand) => {
  switch (Math.floor(rand() * 7)) {
    case 0: return Math.floor(rand() * 1000)
    case 1: return 'str' + Math.floor(rand() * 1000)
    case 2: return rand() < 0.5
    case 3: return null
    case 4: return 'has?question'      // a `?` inside a value must not confuse binding
    case 5: return new Date(Math.floor(rand() * 1e12))
    default: return 'value with spaces'
  }
}

const randRow = (rand) => {
  const n = 1 + Math.floor(rand() * 4)           // never empty
  const row = {}
  const cols = COLUMNS.slice()
  for (let i = 0; i < n && cols.length; i++) {
    const idx = Math.floor(rand() * cols.length)
    row[cols.splice(idx, 1)[0]] = randScalar(rand)
  }
  return row
}

const randArray = (rand) => Array.from({ length: 1 + Math.floor(rand() * 5) }, () => randScalar(rand))

// Each template returns a partials array. Markers use uppercase IN/VALUES/SET so
// old and new agree (lowercase `in` is a 3.0.0-only fix, unit-tested separately).
const templates = [
  (rand) => ['SELECT * FROM t WHERE id = ?', randScalar(rand)],
  (rand) => ['SELECT * FROM t WHERE a = ? AND b = ?', randScalar(rand), randScalar(rand)],
  (rand) => ['SELECT', COLUMNS.slice(0, 1 + Math.floor(rand() * 4)), 'FROM t'],
  (rand) => ['SELECT * FROM t WHERE ?', randRow(rand)],
  (rand) => ['SELECT * FROM t WHERE ?', randRow(rand), 'ORDER BY id'],
  (rand) => ['SELECT * FROM t WHERE ' + pick(rand, COLUMNS) + ' IN ?', randArray(rand)],
  (rand) => ['INSERT INTO t VALUES ?', randRow(rand)],
  (rand) => ['INSERT INTO t VALUES ?', randRow(rand), 'RETURNING id'],
  (rand) => ['UPDATE t SET ?', randRow(rand), 'WHERE id = ?', randScalar(rand)],
  (rand) => ['UPDATE t SET ?', randRow(rand), 'WHERE ' + pick(rand, COLUMNS) + ' IN ?', randArray(rand)],
  (rand) => [
    'SELECT * FROM t',
    'WHERE ' + pick(rand, COLUMNS) + ' = ? AND ' + pick(rand, COLUMNS) + ' = ?', randScalar(rand), randScalar(rand),
    'ORDER BY created_at',
  ],
  (rand) => ['INSERT INTO t (username, gender) VALUES (?, ?)', randScalar(rand), randScalar(rand)],
]

let checked = 0
for (let iter = 0; iter < ITERATIONS; iter++) {
  const seed = (BASE_SEED + iter) >>> 0

  // Build the SAME scenario twice from independent PRNGs seeded identically, so
  // each builder gets its own fresh objects/Dates. This sidesteps the legacy
  // builder's input-array mutation bug without any fragile deep-copy.
  const gen = () => {
    const rand = prng(seed)
    const dialect = rand() < 0.5 ? 'pg' : 'mysql'
    const template = templates[Math.floor(rand() * templates.length)]
    return { dialect, partials: template(rand) }
  }
  const { dialect, partials } = gen()

  let a, b
  try {
    a = dist[dialect].apply(null, partials)
    b = legacy[dialect].apply(null, gen().partials)
  } catch (err) {
    console.error(`\nFUZZ ERROR at seed ${seed} (dialect ${dialect}):`)
    console.error(JSON.stringify(partials))
    throw err
  }

  try {
    assert.strictEqual(a.text, b.text, 'text mismatch')
    assert.deepStrictEqual(a.values, b.values, 'values mismatch')
  } catch (err) {
    console.error(`\nDIVERGENCE at seed ${seed} (dialect ${dialect}):`)
    console.error('  input :', JSON.stringify(partials))
    console.error('  3.x   :', JSON.stringify(a))
    console.error('  2.4.2 :', JSON.stringify(b))
    throw err
  }
  checked++
}

console.log(`✓ differential fuzz: ${checked} scenarios agree with the 2.4.2 oracle (base seed 0x${BASE_SEED.toString(16)})`)

// ─────────────────────────────────────────────────────────────────────────
// Property fuzz — the `sql` tag and the lexer have no 2.4.2 counterpart, so
// they are checked against invariants rather than an oracle.
//
//   1. every interpolated value is bound, in left-to-right order, and NEVER
//      appears in the SQL text (the core safety property)
//   2. pg renders exactly $1..$n, in order, with n === values.length
//   3. mysql renders exactly n `?`, with n === values.length
//   4. rendering is pure — the same fragment renders identically every time,
//      and for either dialect
// ─────────────────────────────────────────────────────────────────────────

const { sql, pg, mysql } = dist

// Distinctive, injection-shaped strings: if any of these ever land in `text`,
// the safety property is broken.
const POISON = [
  "'; DROP TABLE users; --",
  '1 OR 1=1',
  '$1',
  '?',
  'a`b"c',
  '$$x$$',
]

// Identifier poison is kept DISJOINT from value poison: sql.id legitimately
// writes (escaped) identifier text into the SQL, so sharing a pool would make
// the "no value ever reaches the text" check ambiguous.
const ID_POISON = [
  'we`ird',
  'ev"il',
  'my table',
  'sel$ect',
  'x?y',
  'has$1dollar',
]

const randPoison = (rand) => POISON[Math.floor(rand() * POISON.length)]
const randIdPoison = (rand) => ID_POISON[Math.floor(rand() * ID_POISON.length)]

// Build a random nested fragment, tracking the values it should bind in order.
const randFragment = (rand, depth, expected) => {
  const roll = rand()

  if (depth < 2 && roll < 0.25) {
    // Nested composition.
    const left = randFragment(rand, depth + 1, expected)
    const right = randFragment(rand, depth + 1, expected)
    return sql`(${left} AND ${right})`
  }

  if (roll < 0.4) {
    const v = randPoison(rand)
    expected.push(v)
    return sql`name = ${v}`
  }

  if (roll < 0.55) {
    const arr = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => randPoison(rand))
    arr.forEach((v) => expected.push(v))
    return sql`id IN ${arr}`
  }

  if (roll < 0.65) {
    // Identifiers are quoted, not bound — they add no values.
    return sql`${sql.id(randIdPoison(rand))} IS NOT NULL`
  }

  if (roll < 0.75) {
    const items = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
      const v = randPoison(rand)
      expected.push(v)
      return sql`x = ${v}`
    })
    return sql`(${sql.join(items, ' OR ')})`
  }

  if (roll < 0.85) {
    // A jsonb `?` operator in the tag needs no escaping — it must survive.
    const v = randPoison(rand)
    expected.push(v)
    return sql`data ? ${v}`
  }

  if (roll < 0.92) {
    // sql.value binds the array itself as ONE parameter.
    const v = randPoison(rand)
    expected.push([v])
    return sql`tags = ${sql.value([v])}`
  }

  const v = randPoison(rand)
  expected.push(v)
  return sql`created_at > ${v}`
}

// Quoted identifiers may legitimately contain `?` or `$1` (sql.id quotes the
// poison strings), so blank them out before scanning for placeholders —
// otherwise the checker, not the library, is what's wrong.
//
// Dialect-aware on purpose: pg quotes with "double quotes" and treats backticks
// as ordinary characters, so stripping backtick spans from pg text would eat
// whatever sits between two identifiers — including a real $1.
const stripQuoted = (text, dialect) =>
  dialect === 'mysql'
    ? text.replace(/`(?:[^`]|``)*`/g, '``')
    : text.replace(/"(?:[^"]|"")*"/g, '""')

const pgPlaceholders = (text) => (stripQuoted(text, 'pg').match(/\$\d+/g) || [])

let propChecked = 0
for (let iter = 0; iter < ITERATIONS; iter++) {
  const seed = (BASE_SEED + 0x9e3779b9 + iter) >>> 0
  const rand = prng(seed)

  const expected = []
  const frag = sql`SELECT * FROM t WHERE ${randFragment(rand, 0, expected)}`

  try {
    const a = pg(frag)
    const b = mysql(frag)

    const aValues = a.values || []
    const bValues = b.values || []

    // 1. values bound in order, and never inlined into the text.
    assert.deepStrictEqual(aValues, expected, 'pg values must match interpolation order')
    assert.deepStrictEqual(bValues, expected, 'mysql values must match interpolation order')
    for (const v of expected) {
      if (typeof v === 'string' && v.length > 3) {
        assert.ok(a.text.indexOf(v) === -1, `value leaked into pg text: ${v}`)
        assert.ok(b.text.indexOf(v) === -1, `value leaked into mysql text: ${v}`)
      }
    }

    // 2. pg renders exactly $1..$n in order.
    const holes = pgPlaceholders(a.text)
    assert.strictEqual(holes.length, expected.length, 'pg placeholder count')
    holes.forEach((h, idx) => assert.strictEqual(h, '$' + (idx + 1), 'pg placeholder order'))

    // 3. mysql renders exactly n `?` — minus the jsonb `?` operators the
    //    generator may emit, which are part of the literal text.
    const mysqlText = stripQuoted(b.text, 'mysql')
    const jsonbOps = (mysqlText.match(/data \?/g) || []).length
    const qs = (mysqlText.match(/\?/g) || []).length - jsonbOps
    assert.strictEqual(qs, expected.length, 'mysql placeholder count')

    // 4. rendering is pure.
    assert.deepStrictEqual(pg(frag), a, 'pg render must be repeatable')
    assert.deepStrictEqual(mysql(frag), b, 'mysql render must be repeatable')
  } catch (err) {
    console.error(`\nPROPERTY FAILURE at seed ${seed}:`)
    console.error('  pg    :', JSON.stringify(pg(frag)))
    console.error('  mysql :', JSON.stringify(mysql(frag)))
    console.error('  expect:', JSON.stringify(expected))
    throw err
  }
  propChecked++
}

console.log(`✓ property fuzz: ${propChecked} sql-tag scenarios hold all invariants`)
