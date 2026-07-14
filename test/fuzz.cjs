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
