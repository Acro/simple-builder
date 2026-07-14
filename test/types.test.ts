/**
 * Type-level regression tests. Compiled (never executed) by `npm test` via
 * `tsc --noEmit`; a wrong inference is a build failure.
 */
import simpleBuilder, { pg, mysql, Build, BuildResult, Partial, Row } from '../src/index'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
declare function expectType<T extends true>(): void

function cases(): void {
  // Both dialect exports share the Build signature.
  expectType<Equal<typeof pg, Build>>()
  expectType<Equal<typeof mysql, Build>>()

  // Default export carries both dialects.
  expectType<Equal<typeof simpleBuilder.pg, Build>>()
  expectType<Equal<typeof simpleBuilder.mysql, Build>>()

  // Array-of-partials call shape.
  const a = pg(['SELECT * FROM t WHERE id = ?', 1])
  expectType<Equal<typeof a, BuildResult>>()

  // Varargs call shape.
  const b = pg('SELECT * FROM t WHERE id = ?', 1)
  expectType<Equal<typeof b, BuildResult>>()

  // Heterogeneous partials: strings, numbers, booleans, Date, null, objects,
  // and arrays are all assignable to Partial without casts.
  const row: Row = { username: 'x', active: true }
  const mixed: Partial[] = [
    'UPDATE t SET ?', row,
    'WHERE id = ? AND created_at > ?', 1, new Date(),
    'AND flag = ?', false,
    'AND tag IS ?', null,
  ]
  const c = mysql(mixed)
  expectType<Equal<typeof c, BuildResult>>()

  // Result shape: text required, values optional.
  const r = pg(['SELECT 1'])
  const text: string = r.text
  const values: unknown[] | undefined = r.values
  void [text, values]

  // A projection array literal is a valid partial.
  pg(['SELECT', ['id', 'name'], 'FROM t'])

  void [a, b, c]
}

void cases
