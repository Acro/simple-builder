/**
 * Package-boundary TypeScript consumer. CI compiles this against the INSTALLED
 * package's d.ts with both an older compiler and the latest, so a typings
 * change that breaks consumers fails the build.
 */
import simpleBuilder, { pg, mysql, BuildResult, Partial, Row } from 'simple-builder'

function main(): void {
  const a: BuildResult = pg(['SELECT * FROM t WHERE id = ?', 1])
  const b: BuildResult = mysql('SELECT * FROM t WHERE id = ?', 1)

  const row: Row = { username: 'x', active: true }
  const partials: Partial[] = ['UPDATE t SET ?', row, 'WHERE id = ?', 1]
  const c: BuildResult = simpleBuilder.pg(partials)

  const text: string = a.text
  const values: unknown[] | undefined = a.values

  void [b, c, text, values]
}

void main
