# Agent guide — simple-builder

Zero-dependency npm package: a tiny SQL builder. The implementation is one file,
`src/index.ts` (~540 lines with comments, ~16 kB compiled); everything else is
tests and packaging.

## Consumer API

See `llms.txt` for the complete API, lexing rules, security model, recipes, and
gotchas in one file. It is the primary surface for AI agents and ships in the
npm tarball, so it lands at `node_modules/simple-builder/llms.txt`. Keep it in
sync with the API — its examples are executed by `npm test`, so a wrong one
fails the build, but a *missing* one fails silently. The other two agent-facing
surfaces are the shipped `dist/index.d.ts` (JSDoc + `@example` blocks, which is
what an LSP hover shows) and the runtime error messages — all three should teach
the fix, not just state the problem.

## Working on this repo

- Build: `npm run build` (tsc → `dist/`). `dist/` is git-ignored; `prepare`
  builds on install/publish.
- Test: `npm test` — builds, compiles `test/types.test.ts` (exact-type
  assertions; a wrong inference is a build failure), runs the unit suite under
  `--unhandled-rejections=strict`, then runs the doc tests.
- Docs are executable: `test/docs.test.cjs` parses every ```javascript block in
  `README.md` and `llms.txt`, runs it, and compares against the documented
  result. Docs are what humans AND AI agents copy verbatim, so drift is a build
  failure. To be checked, an example must be a `pg(…)`/`mysql(…)` expression
  followed by a `// { … }` comment; anything else in the block is treated as
  setup and evaluated. Ellipses (`values: [...]`) are rejected — write the real
  value. A floor on the checked count guards against the parser silently
  matching nothing.
- Fuzz: `npm run fuzz -- [iterations] [seed]` — see below. Failures print the
  seed for exact reproduction.
- Integration: `npm run db:up` (docker Postgres + MySQL), then
  `npm run test:integration`; `npm run db:down` to clean up. CI runs this via
  service containers. **This is the only gate that checks the lexer against the
  engines rather than against our reading of their manuals** — every lexer bug
  found so far (pg `E'…'` escapes, MySQL's whitespace-after-`--` rule) was a
  grammar misreading that unit tests happily confirmed. Add a case here whenever
  you touch `lex()`.
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
   what survives all that is a placeholder.

   Lexing settings that differ per server (`Mode`) are threaded in via
   `withMode`; `makeBuild` closes over them. Defaults match a stock server, so
   the option is inert unless set.

   Every dialect difference here is load-bearing and verified against real
   servers by `test/integration.cjs` — do not "simplify" any of them:
   - Quote runs go through `consumeQuoted`, dialect-aware about backslash
     escapes: they apply in MySQL and in a Postgres `E'…'` escape string, but
     NOT in a standard pg string (`standard_conforming_strings` makes `\`
     ordinary). Getting this wrong binds a value *inside* a string literal.
   - `--` is a comment in MySQL only when followed by whitespace or EOF
     (`SELECT 1--2` is 3 there); Postgres always treats it as a comment.
   - `#` is a comment in MySQL only; in Postgres it starts `#>` / `#-`.
   - Under `ANSI_QUOTES`, MySQL `"…"` is an identifier (doubling only), and
     `"a\"b"` is a *syntax error* on the server — so backslash escaping must be
     off for `"` in that mode. Under `NO_BACKSLASH_ESCAPES`, `\` is ordinary in
     every literal.

## Facts measured against real servers (do not "correct" from memory)

MySQL 8.4 / PG 16, recorded because each one contradicts a plausible assumption:

- `''` doubling lexes identically in **every** mode of both engines. It is the
  only mode-proof escape. The `sql` tag never lexes, so it is mode-proof too.
- Placeholder-count strictness: **pg rejects both too-few and too-many** params;
  **MySQL `execute()` rejects too-few but silently ignores extras**. So the
  server is a full oracle for pg and only a half-oracle for MySQL — integration
  tests must assert on returned ROWS, not merely that the query ran.
- mysql2's `query()` escapes values client-side with backslashes, which is wrong
  under `NO_BACKSLASH_ESCAPES` (errors; round-trips `x\` as `x\\`). The
  integration suite therefore drives MySQL through `execute()`, which also means
  MySQL's own parser — not mysql2's scanner — validates our text.
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

Auth is an npm **trusted publisher** (OIDC): npmjs.com has the repo and the
workflow *filename* on record, and npm exchanges the Actions OIDC token for a
short-lived credential at publish time. Consequences worth knowing before you
touch the release path:

- There is no npm token, in repo secrets or anywhere else, and the package is
  set to *disallow* tokens — this workflow is the only way to publish.
- **Do not add `registry-url` to the `setup-node` step.** npm runs the OIDC
  exchange only when it finds no usable credential for the registry, and
  `registry-url` makes setup-node write `_authToken=${NODE_AUTH_TOKEN}` into an
  `.npmrc` unconditionally. Whether that line is harmless then turns on how the
  variable expands, which is much too subtle to rely on:
  - **undefined** (no `env:` at all) — the line survives as the literal string
    `${NODE_AUTH_TOKEN}`, npm reads it as a credential, skips OIDC, and the run
    dies with `E403` on `PUT` *after* all five gates have passed. That reads
    like a permissions problem on npmjs.com and is not one. It cost us a failed
    3.0.0 release.
  - **empty string** (an `env:` naming a secret that does not exist) — expands
    to an empty credential, npm falls through to OIDC, publish succeeds. This
    is what the sibling repo `await-parallel-limit` does.

  Omitting `registry-url` removes the question; npm defaults to
  registry.npmjs.org regardless. See actions/setup-node#1551. The guard step
  immediately before publish asserts no credential is configured and fails
  fast, so this can never again surface as a late 403.
- `npm install -g npm@latest` before publishing is load-bearing, not hygiene:
  Node 22 ships npm 10, which has no OIDC support at all and fails with
  `ENEEDAUTH`. That is the error `await-parallel-limit` hit on its first
  release attempt.
- Renaming `publish.yml`, or moving the publish step into a different workflow
  file, breaks publishing until the trusted publisher is updated to match.
- The tag must agree with `package.json` — a guard step fails the run otherwise.
  Workflows for a `release` event run from the *tagged* commit, so land any
  workflow change on `master` before you cut the tag.
