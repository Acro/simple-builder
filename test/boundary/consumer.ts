/**
 * Package-boundary TypeScript consumer. CI compiles this against the INSTALLED
 * package's d.ts with the latest compiler, so a typings change that breaks
 * consumers fails the build.
 */
import simpleBuilder, { pg, mysql, sql, Build, BuildResult, Mode, Row, Sql } from 'simple-builder'

function main(): void {
  // partials API
  const a: BuildResult = pg(['SELECT * FROM t WHERE id = ?', 1])
  const b: BuildResult = mysql('SELECT * FROM t WHERE id = ?', 1)

  const row: Row = { username: 'x', active: true }
  const c: BuildResult = simpleBuilder.pg(['UPDATE t SET ?', row, 'WHERE id = ?', 1])

  // sql tag
  const frag: Sql = sql`SELECT * FROM t WHERE id = ${1}`
  const d: BuildResult = pg(frag)
  const e: BuildResult = mysql(sql`SELECT * FROM ${sql.id('users')} WHERE id IN ${[1, 2]}`)
  const f: BuildResult = pg(sql`SELECT * FROM t WHERE ${sql.join([sql`a = ${1}`], ' AND ')} ${sql.empty}`)
  const g: BuildResult = pg(sql`SELECT * FROM t ORDER BY id ${sql.raw('DESC')}`)
  const h: BuildResult = pg(sql`SELECT * FROM t WHERE tags = ${sql.value([1, 2])}`)

  // withMode
  const mode: Mode = { ansiQuotes: true, noBackslashEscapes: true }
  const configured: Build = mysql.withMode(mode)
  const i: BuildResult = configured(['SELECT ? AS n', 1])
  const j: BuildResult = pg.withMode({ standardConformingStrings: false })(sql`SELECT ${1}`)

  const text: string = a.text
  const values: unknown[] | undefined = a.values

  void [b, c, d, e, f, g, h, i, j, text, values]
}

void main
