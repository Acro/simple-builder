// Static ESM wrapper over the CJS build. Node's ESM loader exposes a CJS
// module's `module.exports` as the default import, so re-export the named
// bindings explicitly. Single implementation — no dual-package hazard.
import cjs from '../dist/index.js'

export default cjs.default
export const pg = cjs.pg
export const mysql = cjs.mysql
export const sql = cjs.sql
export const Sql = cjs.Sql
