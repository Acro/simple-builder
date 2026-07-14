/**
 * simple-builder — a tiny SQL string builder that keeps your SQL visible.
 *
 * You write SQL with `?` placeholders and interleave the bound values; the
 * builder returns `{ text, values }` shaped for the `pg`, `mysql`, and `mysql2`
 * drivers. For `pg` the `?` are rewritten to `$1, $2, …`; for `mysql` they are
 * left as `?`. Objects expand into `INSERT … VALUES`, `SET`, `WHERE`, and
 * `IN (…)` fragments.
 *
 * SECURITY: values are always parameterised and safe. Object *keys* become
 * column/identifier names and are interpolated into the SQL verbatim — never
 * pass user-controlled keys to `VALUES ?`, `SET ?`, or `WHERE ?`. See README.
 */

/** Target driver dialect. `pg` renders `$1`-style placeholders; `mysql`
 *  (also `mysql2`) keeps `?`. */
export type Dialect = 'pg' | 'mysql'

/** A single bound value. `Date`/`null`/`undefined` are passed through to the
 *  driver unchanged. */
export type Value = string | number | boolean | bigint | null | undefined | Date

/** An object whose keys are column names and values are bound parameters. Used
 *  by the `VALUES ?`, `SET ?`, and `WHERE ?` object forms. */
export type Row = Record<string, unknown>

/** One element of a partials array: an SQL fragment, a bound value, an object
 *  row, or an array (a projection list, or the value list for `IN ?`). */
export type Partial =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Date
  | Row
  | readonly unknown[]

/** The result, shaped for `driver.query(text, values)`. `values` is omitted
 *  when the query bound no parameters. */
export interface BuildResult {
  text: string
  values?: unknown[]
}

/** A dialect-bound builder. Accepts a partials array, an argument list of
 *  partials, or a single ready SQL string. */
export interface Build {
  (partials: readonly Partial[]): BuildResult
  (...partials: Partial[]): BuildResult
}

const isObject = (value: unknown): value is Row =>
  value !== null && typeof value === 'object'

const describe = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

// Markers that make the *next* partial an object (or, for IN, an array) that
// gets expanded. Kept case-insensitive; the whitespace-before-`in` guard stops
// words like "join"/"min" from matching.
const RE_VALUES = /values\s+\?/i
const RE_WHERE = /where\s+\?/i
const RE_IN = /(\sin\s+)\?/i
const RE_SET = /set\s+\?/i

type Action = 'insert' | 'where' | 'where_in' | 'update'

function build(dialect: Dialect, args: unknown[]): BuildResult {
  // Call shapes: build([...]) | build(a, b, c, …) | build("sql string").
  const query: unknown = args.length > 1 ? args : args[0]

  if (!Array.isArray(query)) {
    // A single ready string (or nothing) — nothing to bind.
    return { text: query == null ? '' : String(query) }
  }

  // Copy so we never mutate the caller's array (the projection join below
  // would otherwise clobber their input).
  const parts = query.slice() as Partial[]

  const values: unknown[] = []
  let paramIndex = 1
  const placeholder = (): string => (dialect === 'mysql' ? '?' : '$' + paramIndex++)

  const text: string[] = []
  const last = (): number => text.length - 1

  // How many upcoming partials are values consumed by the current fragment's
  // `?` count, and which object-expansion is pending. Flags persist until the
  // matching action fires, mirroring the original state machine.
  let ignore = 0
  const flags = { insert: false, where: false, where_in: false, update: false }

  // Highest-precedence pending action (update > where_in > where > insert),
  // matching the original's `.pop()` over insertion order.
  const currentAction = (): Action | null => {
    let action: Action | null = null
    if (flags.insert) action = 'insert'
    if (flags.where) action = 'where'
    if (flags.where_in) action = 'where_in'
    if (flags.update) action = 'update'
    return action
  }

  const columns = (row: Row, action: Action): string[] => {
    const keys = Object.keys(row)
    if (keys.length === 0) {
      throw new Error(
        `simple-builder: empty object passed to the ${action} clause — ` +
          'an object with at least one key is required.'
      )
    }
    return keys
  }

  const apply: Record<Action, (row: Row) => void> = {
    insert(row) {
      const keys = columns(row, 'insert')
      const placeholders = keys.map((key) => {
        values.push(row[key])
        return placeholder()
      })
      text[last()] = text[last()].replace(
        RE_VALUES,
        '(' + keys.join(',') + ') VALUES (' + placeholders.join(',') + ')'
      )
      flags.insert = false
    },
    where(row) {
      const keys = columns(row, 'where')
      const conditions = keys.map((key) => {
        values.push(row[key])
        return key + '=' + placeholder()
      })
      text[last()] = text[last()].replace('?', conditions.join(' AND '))
      flags.where = false
    },
    where_in(row) {
      // `row` is typically an array; Object.keys gives its indices.
      const keys = columns(row, 'where_in')
      const placeholders = keys.map((key) => {
        values.push(row[key])
        return placeholder()
      })
      // Preserve the author's `IN`/`in` casing and spacing; only swap the `?`.
      text[last()] = text[last()].replace(RE_IN, (_m, lead: string) => lead + '(' + placeholders.join(',') + ')')
      flags.where_in = false
    },
    update(row) {
      const keys = columns(row, 'update')
      const assignments = keys.map((key) => {
        values.push(row[key])
        return key + '=' + placeholder()
      })
      text[last()] = text[last()].replace('?', assignments.join(','))
      flags.update = false
    },
  }

  for (let i = 0; i < parts.length; i++) {
    if (ignore-- > 0) {
      const part = parts[i]
      const action = currentAction()

      if (isObject(part) && action) {
        apply[action](part)
      } else {
        // A plain bound value. For pg, consume the next `?` in place.
        if (dialect !== 'mysql') {
          text[last()] = text[last()].replace('?', placeholder())
        }
        values.push(part)
      }
      continue
    }

    let part = parts[i]

    // A bare array in fragment position is a projection list: "a","b" → "a,b".
    if (Array.isArray(part)) part = part.join(',')

    if (typeof part !== 'string') {
      throw new Error(
        'simple-builder: expected an SQL string fragment but got ' +
          `${describe(part)} near [..., ${JSON.stringify(parts[i - 1]) ?? 'start'}, ${JSON.stringify(parts[i])}, ...]. ` +
          'A value must follow a fragment containing a `?` placeholder.'
      )
    }

    const marks = part.match(/\?/g)
    if (marks) ignore = marks.length

    if (RE_VALUES.test(part)) flags.insert = true
    if (RE_WHERE.test(part)) flags.where = true
    if (RE_IN.test(part)) flags.where_in = true
    if (RE_SET.test(part)) flags.update = true

    text.push(part)
  }

  const result: BuildResult = { text: text.join(' ') }
  if (values.length > 0) result.values = values
  return result
}

/** Postgres (`pg`) builder — renders `$1, $2, …` placeholders. */
export const pg: Build = (...args: unknown[]) => build('pg', args)

/** MySQL (`mysql` / `mysql2`) builder — keeps `?` placeholders. */
export const mysql: Build = (...args: unknown[]) => build('mysql', args)

/** Default export: `{ pg, mysql }`, mirroring the classic
 *  `require('simple-builder')` shape. */
const simpleBuilder = { pg, mysql }
export default simpleBuilder
