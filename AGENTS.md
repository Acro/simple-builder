# Agent guide — simple-builder

Zero-dependency npm package: a tiny SQL builder. The implementation is one file,
`src/index.ts` (~540 lines with comments, ~16 kB compiled); everything else is
tests and packaging.

## Consumer API

See `llms.txt` (shipped in the npm tarball) for the complete API, lexing rules,
security model, and gotchas in one file.

## Working on this repo

- Build: `npm run build` (tsc → `dist/`). `dist/` is git-ignored; `prepare`
  builds on install/publish.
- Test: `npm test` — builds, compiles `test/types.test.ts` (exact-type
  assertions; a wrong inference is a build failure), then runs the unit suite
  under `--unhandled-rejections=strict`.
- Fuzz: `npm run fuzz -- [iterations] [seed]` — see below. Failures print the
  seed for exact reproduction.
- Package surface: `npx publint --strict` and `npx @arethetypeswrong/cli --pack .`
  must both stay clean; CI gates on them.

## Architecture

`src/index.ts`, in dependency order:

1. **Identifiers** — `assertPlainIdentifier` (allow-list for object keys) and
   `quoteIdentifier` (dialect quoting for `sql.id`). Identifiers can never be
   parameterised, so these are the only things that write non-value text.
2. **Nodes / `Sql`** — the shared representation: `text` | `value` | `id` nodes.
   Both APIs lower to this.
3. **`lex()`** — the reason the `?` API is correct. Skips string literals,
   quoted identifiers, line/block comments, and dollar-quoted bodies; treats
   `?|`/`?&`/`??` as operators; honours `\?` as an escaped literal `?`. Only
   what survives all that is a placeholder. Quote runs go through
   `consumeQuoted`, which is dialect-aware about backslash escapes: they apply
   in MySQL and in a Postgres `E'…'` escape string, but NOT in a standard pg
   string (`standard_conforming_strings` makes `\` ordinary) — getting this
   wrong binds a value *inside* a string literal.
4. **`classify()`** — positional clause detection from the text immediately
   before each placeholder (`\bVALUES\s+$` etc). `\b` is load-bearing: it keeps
   `OFFSET ?` from reading as `SET ?` and `JOIN ?` from reading as `IN ?`.
5. **`Renderer`** — owns placeholder numbering and the values array; `pg` emits
   `$n`, `mysql` emits `?`.
6. **`buildPartials`** / **`buildSql`** — the two front ends.
7. **`pg` / `mysql`** — dialect-bound entry points that accept either API.

ESM entry is a static wrapper (`esm/index.mjs`) re-exporting the CJS build — do
NOT introduce a second compiled implementation (dual-package hazard). When you
add an export, update `esm/index.mjs` AND `esm/index.d.mts`.

## Invariants you must not break (enforced by tests + fuzzers + CI)

1. **The `?` API's output is byte-identical to 2.4.2** for all documented usage.
   The differential fuzzer is the guard — keep it green.
2. Values are ALWAYS parameterised and never appear in `text`, in both APIs.
   Only identifiers (allow-listed keys, or quoted `sql.id`) and `sql.raw` write
   text.
3. `pg` renders exactly `$1..$n` in interpolation order; `mysql` renders `n` `?`.
4. Rendering is pure: the same `Sql` fragment renders identically, repeatedly,
   for either dialect.
5. The caller's partials array is never mutated.
6. `values` is omitted from the result when no value was bound.
7. Both CJS `require` and ESM `import` resolve to the same `{ pg, mysql, sql }`.

## The two fuzzers (`test/fuzz.cjs`)

- **Differential** — random well-formed queries through both the current build
  and the vendored 2.4.2 builder (`test/legacy-oracle.cjs`); output must match
  byte-for-byte. Its generator deliberately stays inside the domain where the
  two MUST agree.
- **Property** — the `sql` tag and lexer have no 2.4.2 counterpart, so they are
  checked against invariants 2–4 above using injection-shaped "poison" strings.
  Value poison and identifier poison are kept DISJOINT, and placeholder counting
  strips quoted identifiers **dialect-aware** (backticks are not quotes in pg) —
  both are checker correctness requirements, not cosmetics.
- **Marker** — routes the marker classes through `buildPartials` (the tag fuzzer
  never does), asserting that a marker's internal field names (`parts`, `nodes`,
  `value`, `text`) never surface as SQL identifiers. This guards a real bug:
  markers are objects, so a clause marker before the `?` used to enumerate them
  as a Row and emit `WHERE parts=$1`. Verify changes here by reintroducing that
  bug and confirming the fuzzer fails.

## Intentional 2.4.2 → 3.0.0 behaviour changes

Kept OUT of the differential fuzzer's domain (covered by unit tests instead):

- Lowercase `in ?` now expands (was left as a literal placeholder).
- An empty object to `VALUES ?`/`SET ?`/`WHERE ?` now throws.
- A non-identifier object key now throws.
- Fewer values than placeholders now throws (was binding `undefined`).
- `OFFSET ?` is no longer misread as `SET ?`.
- `?` inside literals/identifiers/comments/dollar-quotes is no longer a
  placeholder; `?|`/`?&` are operators.

## Releasing

Bump `version` in `package.json`, then publish a GitHub Release tagged `vX.Y.Z`.
The publish workflow re-runs the full gate and publishes to npm with provenance.
See `.github/workflows/publish.yml`.
