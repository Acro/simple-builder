/**
 * Type-level regression tests. Compiled (never executed) by `npm test` via
 * `tsc --noEmit`; a wrong inference is a build failure.
 */
import simpleBuilder, { pg, mysql, sql, Build, BuildResult, Mode, Row, Sql } from '../src/index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
declare function expectType<T extends true>(): void

function cases(): void {
  // Both dialect exports share the Build signature.
  expectType<Equal<typeof pg, Build>>()
  expectType<Equal<typeof mysql, Build>>()

  // Default export carries both dialects and the tag.
  expectType<Equal<typeof simpleBuilder.pg, Build>>()
  expectType<Equal<typeof simpleBuilder.mysql, Build>>()
  expectType<Equal<typeof simpleBuilder.sql, typeof sql>>()

  // ── partials API ──
  const a = pg(['SELECT * FROM t WHERE id = ?', 1])
  expectType<Equal<typeof a, BuildResult>>()

  const b = pg('SELECT * FROM t WHERE id = ?', 1)
  expectType<Equal<typeof b, BuildResult>>()

  // Heterogeneous partials need no casts.
  const row: Row = { username: 'x', active: true }
  const c = mysql([
    'UPDATE t SET ?', row,
    'WHERE id = ? AND created_at > ?', 1, new Date(),
    'AND flag = ?', false,
    'AND tag IS ?', null,
  ])
  expectType<Equal<typeof c, BuildResult>>()

  // A projection array literal is a valid partial.
  pg(['SELECT', ['id', 'name'], 'FROM t'])

  // sql.id is usable in fragment position of the partials API.
  pg(['SELECT * FROM', sql.id('users'), 'WHERE id = ?', 1])

  // ── sql tag ──
  const frag = sql`SELECT * FROM t WHERE id = ${1}`
  expectType<Equal<typeof frag, Sql>>()

  const d = pg(frag)
  expectType<Equal<typeof d, BuildResult>>()
  const e = mysql(sql`SELECT * FROM t WHERE id = ${1}`)
  expectType<Equal<typeof e, BuildResult>>()

  // Helpers compose and are accepted as interpolations.
  pg(sql`SELECT * FROM ${sql.id('public', 'users')} WHERE id IN ${[1, 2, 3]}`)
  pg(sql`SELECT * FROM t WHERE ${sql.join([sql`a = ${1}`, sql`b = ${2}`], ' AND ')}`)
  pg(sql`SELECT * FROM t ORDER BY id ${sql.raw('DESC')}`)
  pg(sql`SELECT * FROM t WHERE tags = ${sql.value([1, 2])}`)
  pg(sql`SELECT * FROM t ${sql.empty}`)

  // Nesting a fragment inside a fragment is allowed.
  const nested: Sql = sql`SELECT * FROM t WHERE ${sql`a = ${1}`}`
  void nested

  // ── withMode ──
  // Returns a Build, so it chains and accepts every call shape.
  const configured: Build = mysql.withMode({ ansiQuotes: true })
  expectType<Equal<typeof configured, Build>>()
  const chained: Build = mysql.withMode({ ansiQuotes: true }).withMode({ noBackslashEscapes: true })
  const m: BuildResult = chained(['SELECT ? AS n', 1])
  const m2: BuildResult = pg.withMode({ standardConformingStrings: false })(sql`SELECT ${1}`)

  // Mode is exported and all fields are optional.
  const mode: Mode = {}
  const full: Mode = { ansiQuotes: true, noBackslashEscapes: false, standardConformingStrings: true }
  void [configured, m, m2, mode, full]

  // Result shape: text required, values optional.
  const r = pg(sql`SELECT 1`)
  const text: string = r.text
  const values: unknown[] | undefined = r.values
  void [text, values]

  void [a, b, c, d, e]
}

void cases
