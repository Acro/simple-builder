# Agent guide — simple-builder

Zero-dependency npm package: a tiny SQL string builder. The implementation is
~250 lines of TypeScript in `src/index.ts`; everything else is tests and
packaging.

## Consumer API

See `llms.txt` (shipped in the npm tarball) for the complete API, rules,
security notes, and gotchas in one file.

## Working on this repo

- Build: `npm run build` (tsc → `dist/`). `dist/` is git-ignored; `prepare`
  builds on install/publish.
- Test: `npm test` — builds, compiles `test/types.test.ts` (exact-type
  assertions; a wrong inference is a build failure), then runs the unit suite
  under `--unhandled-rejections=strict`.
- Fuzz: `npm run fuzz -- [iterations] [seed]` — a differential fuzzer
  (`test/fuzz.cjs`) that checks the current build against the vendored 2.4.2
  builder (`test/legacy-oracle.cjs`) for byte-identical output. Failures print
  the seed for exact reproduction.

## Architecture

- One `build(dialect, args)` core in `src/index.ts`. `pg`/`mysql` are thin
  wrappers that bind the dialect. `pg` renders `$1`-style placeholders; `mysql`
  keeps `?`.
- The core walks the flattened partials once. An `ignore` counter tracks how
  many upcoming partials are values (from the preceding fragment's `?` count);
  per-clause flags (`insert`/`where`/`where_in`/`update`) drive object/array
  expansion.
- ESM entry is a static wrapper (`esm/index.mjs`) re-exporting the CJS build —
  do NOT introduce a second compiled implementation (dual-package hazard).

## Invariants you must not break (enforced by tests + fuzzer + CI)

1. Output is byte-identical to 2.4.2 for all documented usage (the differential
   fuzzer is the guard — keep it green).
2. Values are always parameterised; only object keys are interpolated.
3. The caller's partials array is never mutated.
4. `values` is omitted from the result when no value was bound.
5. Both CJS `require` and ESM `import` resolve to the same `{ pg, mysql }`.

## Intentional 2.4.2 → 3.0.0 behaviour changes

Kept OUT of the differential fuzzer's domain (covered by unit tests instead):

- Lowercase `in ?` now expands (was left as a literal placeholder).
- An empty object to `VALUES ?`/`SET ?`/`WHERE ?` now throws.

## Releasing

Bump `version` in `package.json`, then publish a GitHub Release tagged
`vX.Y.Z`. The publish workflow re-runs the full gate and publishes to npm with
provenance. See `.github/workflows/publish.yml`.
