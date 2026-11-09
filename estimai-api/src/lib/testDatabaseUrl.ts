/**
 * The database the DB-backed test files connect to, captured ONCE, before any
 * test file runs (preloaded by bunfig.toml's `[test] preload`).
 *
 * bun runs every test file in one process, and several files set a fake
 * DATABASE_URL for their own env validation, so a file that reads
 * process.env later may see another file's value. Those files used to
 * recover by re-reading DATABASE_URL from the dotenv file, which pointed them
 * at the dev database even when the caller had set a test one. The value is
 * now the one the process STARTED with: what the caller exported (e.g. a
 * `_test` database), or else what bun loaded from the dotenv file.
 */
export const TEST_DATABASE_URL: string | undefined = process.env["DATABASE_URL"];
