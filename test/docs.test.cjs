'use strict'

/**
 * Executable documentation.
 *
 * Every ```javascript example in README.md and llms.txt that shows an expected
 * result is parsed out, run against the built library, and compared. Docs are
 * the surface both humans and AI agents copy from verbatim, so a drifted
 * example is a bug — this makes it a failing build instead.
 *
 * The convention an example must follow to be checked:
 *
 *     pg(['SELECT * FROM t WHERE id = ?', 1])
 *     // { text: 'SELECT * FROM t WHERE id = $1', values: [1] }
 *
 * i.e. a `pg(...)` / `mysql(...)` expression, followed by comment lines holding
 * the expected `{ … }` object literal (which may wrap across lines, and may be
 * introduced by `→` or `both →`). Lines the parser doesn't recognise as such a
 * pair are treated as setup code and evaluated, so `const x = …` in a block
 * works. Examples with no expected-result comment are still *evaluated* (they
 * must not throw), just not compared.
 */

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { pg, mysql, sql } = require('../dist/index')

const ROOT = path.join(__dirname, '..')

// Free variables the prose examples assume. Kept small and obvious; an example
// needing anything else should define it inline.
const fixtures = () => ({
  pg,
  mysql,
  sql,
  email: 'john@doe.wtf',
  id: 123,
  userId: 1,
  org: 'acme',
  onlyActive: true,
  user: { username: 'John Doe', email: 'john@doe.wtf' },
  // The security examples illustrate request-shaped input. A benign body keeps
  // them runnable; the prose covers what a hostile key does.
  req: { body: { username: 'John Doe', email: 'john@doe.wtf' } },
  // `await db.query(...)` / `conn.execute(...)` examples: record, don't hit a DB.
  db: { query: async () => [] },
  conn: { execute: async () => [[]], query: async () => [[]] },
  require: () => ({ pg, mysql, sql }),
  console: { log: () => {} },
})

const blocksOf = (md) =>
  [...md.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1])

// Does this line begin a checkable expression?
const startsExpression = (line) => /^\s*(?:pg|mysql)\s*[.(]/.test(line)

// Comment lines that carry the expected value.
const isExpectedComment = (line) => /^\s*\/\/\s*(?:both\s*→\s*|→\s*)?[{[]/.test(line)
const isContinuationComment = (line) => /^\s*\/\/\s+\S/.test(line)

const stripComment = (line) =>
  line.replace(/^\s*\/\/\s?/, '').replace(/^(?:both\s*)?→\s*/, '')

// Balance parens/brackets/braces so a multi-line expression is captured whole.
// Quote-aware (a `(` inside a SQL string must not count) and comment-aware (a
// trailing `// … { text }` must not count either).
const balanced = (src) => {
  let depth = 0
  let quote = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl === -1) break
      i = nl
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
  }
  return depth <= 0
}

let checked = 0
let evaluated = 0
const failures = []

const runBlock = (file, blockIndex, block) => {
  const lines = block.split('\n')
  const scope = fixtures()
  const names = Object.keys(scope)
  const values = Object.values(scope)
  const setup = []

  // Evaluated in THIS realm (not a vm context) so that a documented object
  // literal and a value returned by the library share an Object.prototype —
  // otherwise deepStrictEqual fails on realm mismatch for identical-looking
  // values. Setup statements are replayed so `const x = …` in a block works.
  // The closing paren goes on its own line so a trailing `// comment` in the
  // example cannot comment it out.
  const evalIn = (code) =>
    // eslint-disable-next-line no-new-func
    new Function(...names, setup.join('\n') + '\nreturn (' + code + '\n)')(...values)

  const evalStatement = (code) =>
    // eslint-disable-next-line no-new-func
    new Function(...names, setup.join('\n') + '\n' + code)(...values)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*\/\//.test(line)) continue

    if (!startsExpression(line)) {
      // Setup statement (const …, import …, etc.). Skip module syntax.
      if (/^\s*(?:import|export)\b/.test(line)) continue
      let stmt = line
      let j = i
      while (!balanced(stmt) && j + 1 < lines.length) { j++; stmt += '\n' + lines[j] }
      i = j
      try { evalStatement(stmt); setup.push(stmt) } catch (err) {
        // A prose-only line (e.g. `await db.query(...)`) that can't run is fine
        // as long as it isn't a checkable example.
        void err
      }
      continue
    }

    // Capture the full expression.
    let expr = line
    let j = i
    while (!balanced(expr) && j + 1 < lines.length) { j++; expr += '\n' + lines[j] }
    i = j

    // Collect the expected-value comment, if any.
    let expected = null
    if (j + 1 < lines.length && isExpectedComment(lines[j + 1])) {
      expected = stripComment(lines[j + 1])
      let k = j + 1
      while (!balanced(expected) && k + 1 < lines.length && isContinuationComment(lines[k + 1])) {
        k++
        expected += ' ' + stripComment(lines[k])
      }
      i = k
    }

    let actual
    try {
      actual = evalIn(expr)
      evaluated++
    } catch (err) {
      failures.push(`${file} block#${blockIndex}: example threw\n    ${expr}\n    ${err.message}`)
      continue
    }

    if (expected === null) continue

    if (/\.\.\./.test(expected)) {
      failures.push(
        `${file} block#${blockIndex}: expected value contains an ellipsis, so it is not a ` +
          `copy-pasteable result. Write the real value.\n    ${expr}\n    // ${expected}`
      )
      continue
    }

    let want
    try {
      want = evalIn(expected)
    } catch (err) {
      failures.push(`${file} block#${blockIndex}: expected value is not a literal\n    // ${expected}\n    ${err.message}`)
      continue
    }

    try {
      assert.deepStrictEqual(actual, want)
      checked++
    } catch (err) {
      failures.push(
        `${file} block#${blockIndex}: DOC DRIFT\n    ${expr}\n` +
          `    documented: ${JSON.stringify(want)}\n` +
          `    actual:     ${JSON.stringify(actual)}`
      )
    }
  }
}

for (const file of ['README.md', 'llms.txt']) {
  const md = fs.readFileSync(path.join(ROOT, file), 'utf8')
  blocksOf(md).forEach((block, idx) => runBlock(file, idx + 1, block))
}

if (failures.length) {
  console.error(`✗ ${failures.length} documentation problem(s):\n`)
  for (const f of failures) console.error('  ' + f + '\n')
  process.exit(1)
}

// Canary: if a refactor breaks the parser, every example silently "passes".
// This floor makes that fail loudly instead. Raise it as docs grow.
const FLOOR = 24
if (checked < FLOOR) {
  console.error(
    `✗ only ${checked} documented examples were checked (expected >= ${FLOOR}) — ` +
      'the parser probably stopped matching, so the docs are NOT actually verified.'
  )
  process.exit(1)
}

console.log(`✓ ${checked} documented examples verified (${evaluated} evaluated) across README.md + llms.txt`)
