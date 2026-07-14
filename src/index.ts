/**
 * simple-builder — a tiny SQL builder that keeps your SQL visible.
 *
 * Two ways to write the same query, both returning `{ text, values }` shaped
 * for the `pg`, `mysql`, and `mysql2` drivers:
 *
 *   pg(['SELECT * FROM users WHERE id = ?', id])   // partials + `?`
 *   pg(sql`SELECT * FROM users WHERE id = ${id}`)  // tagged template
 *
 * For `pg` the placeholders render as `$1, $2, …`; for `mysql` they stay `?`.
 *
 * SECURITY MODEL
 * - Values are ALWAYS parameterised — they never enter the SQL text.
 * - Identifiers cannot be parameterised by any driver, so object keys used by
 *   `VALUES ?` / `SET ?` / `WHERE ?` are validated against a strict identifier
 *   allow-list and rejected if they are anything else. Use `sql.id()` for
 *   dynamic identifiers; it quotes per dialect.
 * - `sql.raw()` is the only way to get unescaped text in, and is unsafe with
 *   user input by construction.
 */

/** Target driver dialect. `pg` renders `$1`-style placeholders; `mysql`
 *  (also `mysql2`) keeps `?`. */
export type Dialect = 'pg' | 'mysql'

/** A single bound value. Passed through to the driver untouched. */
export type Value = string | number | boolean | bigint | null | undefined | Date

/** An object whose keys are column names and values are bound parameters. */
export type Row = Record<string, unknown>

/** The result, shaped for `driver.query(text, values)`. `values` is omitted
 *  when the query bound no parameters. */
export interface BuildResult {
  text: string
  values?: unknown[]
}

// ─────────────────────────────────────────────────────────────────────────
// Identifiers
//
// No driver can bind an identifier — placeholders name data, never tables or
// columns (OWASP Query Parameterization Cheat Sheet). So identifiers are
// handled two ways: object keys are ALLOW-LISTED (a plain identifier passes
// through byte-for-byte, anything else throws), and `sql.id()` QUOTES per
// dialect for the dynamic case.
// ─────────────────────────────────────────────────────────────────────────

// A conservative allow-list: `col`, `tbl.col`, `a.b.c`. Deliberately narrower
// than what the engines accept — exotic names must go through `sql.id()`.
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)*$/

const assertPlainIdentifier = (key: string, clause: string): string => {
  if (!PLAIN_IDENTIFIER.test(key)) {
    throw new Error(
      `simple-builder: ${JSON.stringify(key)} is not a valid column name for the ` +
        `${clause} clause. Keys become SQL identifiers and cannot be parameterised, ` +
        'so only plain identifiers (`col`, `tbl.col`) are accepted here. ' +
        'Never pass user-controlled keys; for a dynamic identifier use sql.id().'
    )
  }
  return key
}

/** Quote one identifier part for the dialect: `pg` uses "double quotes" and
 *  doubles embedded quotes; `mysql` uses `backticks` and doubles embedded
 *  backticks. The quotes are added here — callers never add their own, which
 *  is what makes quote-mismatch injection impossible. */
const quoteIdentifier = (dialect: Dialect, name: string): string => {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('simple-builder: sql.id() requires a non-empty string.')
  }
  // Rejected by both engines; also the classic quote-escape bypass.
  if (name.indexOf('\0') !== -1) {
    throw new Error('simple-builder: identifiers cannot contain a NUL character.')
  }
  return dialect === 'mysql'
    ? '`' + name.replace(/`/g, '``') + '`'
    : '"' + name.replace(/"/g, '""') + '"'
}

// ─────────────────────────────────────────────────────────────────────────
// Fragment nodes — the shared representation behind both APIs.
// ─────────────────────────────────────────────────────────────────────────

type Node =
  | { k: 'text'; v: string }
  | { k: 'value'; v: unknown }
  | { k: 'id'; v: string[] }

/** A composable, dialect-agnostic SQL fragment produced by the `sql` tag.
 *  Render it by passing it to `pg()` or `mysql()`. Fragments nest. */
export class Sql {
  /** @internal */
  readonly nodes: Node[]
  /** @internal */
  constructor(nodes: Node[]) {
    this.nodes = nodes
  }
}

/** A dynamic identifier, quoted for the dialect at render time. */
class Identifier {
  /** @internal */
  readonly parts: string[]
  /** @internal */
  constructor(parts: string[]) {
    this.parts = parts
  }
}

/** Unescaped SQL text. Unsafe with user input by construction. */
class Raw {
  /** @internal */
  readonly text: string
  /** @internal */
  constructor(text: string) {
    this.text = text
  }
}

/** Forces a single bound parameter (arrays would otherwise expand to a list). */
class Single {
  /** @internal */
  readonly value: unknown
  /** @internal */
  constructor(value: unknown) {
    this.value = value
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Lexer for the `?` partials API.
//
// A naive scan for `?` corrupts real SQL: Postgres' jsonb operators `?`, `?|`
// and `?&` are bare question marks, and a `?` can sit inside a string literal,
// a quoted identifier, a comment, or a dollar-quoted body. (pgx shipped a
// security fix for exactly the dollar-quote case.) So we lex instead of count:
// everything below is skipped verbatim, and only a real placeholder is bound.
// ─────────────────────────────────────────────────────────────────────────

type Piece = { text: string } | { placeholder: true }

const lex = (fragment: string, dialect: Dialect): Piece[] => {
  const pieces: Piece[] = []
  let buf = ''
  const flush = (): void => {
    if (buf) { pieces.push({ text: buf }); buf = '' }
  }

  let i = 0
  const n = fragment.length

  while (i < n) {
    const c = fragment[i]

    // `\?` — escape hatch for a literal `?` (e.g. the jsonb existence operator).
    if (c === '\\' && fragment[i + 1] === '?') {
      buf += '?'
      i += 2
      continue
    }

    // Single-quoted string literal. `''` escapes everywhere; MySQL also honours
    // backslash escapes unless NO_BACKSLASH_ESCAPES is set.
    if (c === "'") {
      buf += c
      i++
      while (i < n) {
        if (dialect === 'mysql' && fragment[i] === '\\' && i + 1 < n) {
          buf += fragment[i] + fragment[i + 1]
          i += 2
          continue
        }
        if (fragment[i] === "'") {
          if (fragment[i + 1] === "'") { buf += "''"; i += 2; continue }
          buf += "'"
          i++
          break
        }
        buf += fragment[i]
        i++
      }
      continue
    }

    // Quoted identifier: "..." (pg, and MySQL under ANSI_QUOTES) or `...` (MySQL).
    if (c === '"' || c === '`') {
      const q = c
      buf += c
      i++
      while (i < n) {
        if (fragment[i] === q) {
          if (fragment[i + 1] === q) { buf += q + q; i += 2; continue }
          buf += q
          i++
          break
        }
        buf += fragment[i]
        i++
      }
      continue
    }

    // Line comment.
    if (c === '-' && fragment[i + 1] === '-') {
      while (i < n && fragment[i] !== '\n') { buf += fragment[i]; i++ }
      continue
    }

    // Block comment — Postgres allows nesting.
    if (c === '/' && fragment[i + 1] === '*') {
      let depth = 0
      while (i < n) {
        if (fragment[i] === '/' && fragment[i + 1] === '*') { depth++; buf += '/*'; i += 2; continue }
        if (fragment[i] === '*' && fragment[i + 1] === '/') {
          depth--
          buf += '*/'
          i += 2
          if (depth === 0) break
          continue
        }
        buf += fragment[i]
        i++
      }
      continue
    }

    // Dollar-quoted string: $$...$$ or $tag$...$tag$ (Postgres).
    if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(fragment.slice(i))
      if (tag) {
        const delim = tag[0]
        const end = fragment.indexOf(delim, i + delim.length)
        if (end === -1) {
          // Unterminated — consume the rest verbatim rather than guess.
          buf += fragment.slice(i)
          i = n
          continue
        }
        buf += fragment.slice(i, end + delim.length)
        i = end + delim.length
        continue
      }
      buf += c
      i++
      continue
    }

    // `?` — a placeholder only when it is not part of a `?`-family operator.
    if (c === '?') {
      const next = fragment[i + 1]
      if (next === '|' || next === '&' || next === '?') {
        buf += c + next
        i += 2
        continue
      }
      flush()
      pieces.push({ placeholder: true })
      i++
      continue
    }

    buf += c
    i++
  }

  flush()
  return pieces
}

// ─────────────────────────────────────────────────────────────────────────
// Clause markers — classified positionally, from the text immediately before
// each placeholder. `\b` keeps `offset ?` from reading as `SET ?` and `JOIN ?`
// from reading as `IN ?`.
// ─────────────────────────────────────────────────────────────────────────

type Clause = 'insert' | 'update' | 'where' | 'where_in' | null

const RE_VALUES = /\bVALUES\s+$/i
const RE_SET = /\bSET\s+$/i
const RE_WHERE = /\bWHERE\s+$/i
const RE_IN = /\bIN\s+$/i

const classify = (before: string): Clause =>
  RE_VALUES.test(before) ? 'insert' :
  RE_SET.test(before) ? 'update' :
  RE_WHERE.test(before) ? 'where' :
  RE_IN.test(before) ? 'where_in' :
  null

const isObject = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !(value instanceof Date)

const describe = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value

// ─────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────

class Renderer {
  private readonly dialect: Dialect
  private paramIndex = 1
  readonly values: unknown[] = []

  constructor(dialect: Dialect) {
    this.dialect = dialect
  }

  /** Bind a value and return its placeholder. */
  bind(value: unknown): string {
    this.values.push(value)
    return this.dialect === 'mysql' ? '?' : '$' + this.paramIndex++
  }

  id(parts: string[]): string {
    return parts.map((p) => quoteIdentifier(this.dialect, p)).join('.')
  }

  /** Expand an object/array at a clause marker. `before` is the text emitted so
   *  far for this fragment; the insert form rewrites its tail. */
  expand(before: string, clause: Exclude<Clause, null>, row: Row): string {
    const keys = Object.keys(row)
    if (keys.length === 0) {
      throw new Error(
        `simple-builder: empty object passed to the ${clause} clause — ` +
          'an object with at least one key is required.'
      )
    }

    if (clause === 'where_in') {
      // Array (or object) of values — keys are indices, not identifiers.
      const list = keys.map((k) => this.bind(row[k])).join(',')
      return before + '(' + list + ')'
    }

    if (clause === 'insert') {
      const cols = keys.map((k) => assertPlainIdentifier(k, 'VALUES')).join(',')
      const list = keys.map((k) => this.bind(row[k])).join(',')
      return before.replace(RE_VALUES, '') + '(' + cols + ') VALUES (' + list + ')'
    }

    const sep = clause === 'where' ? ' AND ' : ','
    const label = clause === 'where' ? 'WHERE' : 'SET'
    const assignments = keys
      .map((k) => assertPlainIdentifier(k, label) + '=' + this.bind(row[k]))
      .join(sep)
    return before + assignments
  }

  result(text: string): BuildResult {
    const out: BuildResult = { text }
    if (this.values.length > 0) out.values = this.values
    return out
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The `?` partials API
// ─────────────────────────────────────────────────────────────────────────

const buildPartials = (dialect: Dialect, parts: unknown[]): BuildResult => {
  const r = new Renderer(dialect)
  const text: string[] = []

  let i = 0
  while (i < parts.length) {
    let part = parts[i]

    // A dynamic identifier in fragment position.
    if (part instanceof Identifier) {
      text.push(r.id(part.parts))
      i++
      continue
    }
    if (part instanceof Raw) {
      text.push(part.text)
      i++
      continue
    }

    // A bare array in fragment position is a projection list: "a","b" → "a,b".
    if (Array.isArray(part)) part = part.join(',')

    if (typeof part !== 'string') {
      throw new Error(
        'simple-builder: expected an SQL string fragment but got ' +
          `${describe(part)} at position ${i}. A value must follow a fragment ` +
          'containing a `?` placeholder.'
      )
    }

    const pieces = lex(part, dialect)
    const holes = pieces.filter((p) => 'placeholder' in p).length
    const available = parts.length - i - 1
    if (holes > available) {
      throw new Error(
        `simple-builder: fragment ${JSON.stringify(part)} has ${holes} placeholder(s) ` +
          `but only ${available} value(s) follow it.`
      )
    }

    let out = ''
    let k = 0
    for (const piece of pieces) {
      if ('text' in piece) { out += piece.text; continue }

      const value = parts[i + 1 + k]
      k++
      const clause = classify(out)
      if (clause && isObject(value)) {
        out = r.expand(out, clause, value as Row)
      } else if (value instanceof Identifier) {
        out += r.id(value.parts)
      } else if (value instanceof Raw) {
        out += value.text
      } else {
        out += r.bind(value instanceof Single ? value.value : value)
      }
    }

    text.push(out)
    i += 1 + holes
  }

  return r.result(text.join(' '))
}

// ─────────────────────────────────────────────────────────────────────────
// The `sql` tagged-template API
//
// Nothing here scans for `?`: the literal chunks are yours verbatim and every
// ${interpolation} is a value unless it is explicitly an Sql / id / raw. That
// makes accidental injection structurally impossible, and sidesteps the
// jsonb-operator ambiguity entirely.
// ─────────────────────────────────────────────────────────────────────────

const interpolate = (value: unknown, nodes: Node[]): void => {
  if (value instanceof Sql) { for (const nd of value.nodes) nodes.push(nd); return }
  if (value instanceof Identifier) { nodes.push({ k: 'id', v: value.parts }); return }
  if (value instanceof Raw) { nodes.push({ k: 'text', v: value.text }); return }
  if (value instanceof Single) { nodes.push({ k: 'value', v: value.value }); return }

  // An array becomes a parenthesised list — the `IN ${ids}` form.
  if (Array.isArray(value)) {
    nodes.push({ k: 'text', v: '(' })
    value.forEach((item, idx) => {
      if (idx > 0) nodes.push({ k: 'text', v: ',' })
      interpolate(item, nodes)
    })
    nodes.push({ k: 'text', v: ')' })
    return
  }

  nodes.push({ k: 'value', v: value })
}

interface SqlTag {
  (strings: TemplateStringsArray, ...values: unknown[]): Sql
  /** A dynamic identifier, quoted for the dialect: `sql.id('users')`,
   *  `sql.id('public', 'users')` → `"public"."users"`. */
  id(...parts: string[]): Identifier
  /** Unescaped SQL text. NEVER pass user input. */
  raw(text: string): Raw
  /** Bind a value as a single parameter (arrays would otherwise expand). */
  value(value: unknown): Single
  /** Join fragments/values with a separator. */
  join(items: readonly unknown[], separator?: string): Sql
  /** A fragment that renders to nothing. */
  readonly empty: Sql
}

const tag = (strings: TemplateStringsArray, ...values: unknown[]): Sql => {
  const nodes: Node[] = []
  for (let i = 0; i < strings.length; i++) {
    if (strings[i]) nodes.push({ k: 'text', v: strings[i] })
    if (i < values.length) interpolate(values[i], nodes)
  }
  return new Sql(nodes)
}

export const sql: SqlTag = Object.assign(tag, {
  id: (...parts: string[]): Identifier => new Identifier(parts),
  raw: (text: string): Raw => new Raw(text),
  value: (value: unknown): Single => new Single(value),
  join: (items: readonly unknown[], separator = ', '): Sql => {
    const nodes: Node[] = []
    items.forEach((item, idx) => {
      if (idx > 0) nodes.push({ k: 'text', v: separator })
      interpolate(item, nodes)
    })
    return new Sql(nodes)
  },
  empty: new Sql([]),
})

const buildSql = (dialect: Dialect, fragment: Sql): BuildResult => {
  const r = new Renderer(dialect)
  let text = ''
  for (const node of fragment.nodes) {
    if (node.k === 'text') text += node.v
    else if (node.k === 'id') text += r.id(node.v)
    else text += r.bind(node.v)
  }
  return r.result(text)
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────────────

/** A dialect-bound builder. Accepts a `sql` fragment, a partials array, an
 *  argument list of partials, or a single ready SQL string. */
export interface Build {
  (fragment: Sql): BuildResult
  (partials: readonly unknown[]): BuildResult
  (...partials: unknown[]): BuildResult
}

const build = (dialect: Dialect, args: unknown[]): BuildResult => {
  if (args.length === 1) {
    const only = args[0]
    if (only instanceof Sql) return buildSql(dialect, only)
    if (Array.isArray(only)) return buildPartials(dialect, only.slice())
    if (!(only instanceof Identifier) && !(only instanceof Raw)) {
      // A single ready string (or nothing) — nothing to bind.
      return { text: only == null ? '' : String(only) }
    }
  }
  return buildPartials(dialect, args)
}

/** Postgres (`pg`) builder — renders `$1, $2, …` placeholders. */
export const pg: Build = (...args: unknown[]) => build('pg', args)

/** MySQL (`mysql` / `mysql2`) builder — keeps `?` placeholders. */
export const mysql: Build = (...args: unknown[]) => build('mysql', args)

/** Default export: `{ pg, mysql, sql }`, mirroring the classic
 *  `require('simple-builder')` shape. */
const simpleBuilder = { pg, mysql, sql }
export default simpleBuilder
