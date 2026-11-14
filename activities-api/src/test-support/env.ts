/**
 * `bun test` preload (bunfig.toml): the test environment, set before any module reads
 * `src/lib/env` (which validates at import and exits the process on failure).
 *
 * DATABASE_URL: the suite TRUNCATEs tables, so it must never run against the dev
 * database. Whatever DATABASE_URL the shell provides (direnv builds it for `activities`),
 * the tests use the same server's `<name>_test` database; with none, the local compose
 * Postgres' `activities_test`. Create it once with `bun run db:deploy` pointed at it.
 *
 * Everything else is set unconditionally: a developer's real AUTH_* values must not leak
 * into assertions.
 */

export const TEST_ISSUER = "http://localhost:3001";
export const TEST_AUDIENCE = "operai-suite";
export const TEST_KID = "operai-auth-rs256-v1-test";

function testDatabaseUrl(): string {
  const url = new URL(process.env["DATABASE_URL"] ?? "postgresql://postgres:postgres@localhost:5435/activities_test");
  const name = url.pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) url.pathname = `/${name || "activities"}_test`;
  return url.toString();
}

process.env["DATABASE_URL"] = testDatabaseUrl();
process.env["ALLOWED_ORIGINS"] = "http://localhost:5173";
process.env["AUTH_JWKS_URL"] = `${TEST_ISSUER}/auth/jwks`;
process.env["AUTH_ISSUER"] = TEST_ISSUER;
process.env["AUTH_AUDIENCE"] = TEST_AUDIENCE;
process.env["AUTH_BASE_URL"] = TEST_ISSUER;
// Host URLs: placeholders. Tests that reach a host build the registry from a test host's own
// URL (test-support/hosts.ts); nothing may listen on these ports.
process.env["CRM_API_URL"] = "http://127.0.0.1:1";
process.env["PROJECTS_API_URL"] = "http://127.0.0.1:2";
// The notifier and the system audience are unset unless a test sets them (T6, T10): a
// developer's real credentials must not leak into the suite.
for (const key of ["NOTIFY_INTERNAL_URL", "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET", "SERVICE_AUDIENCE"]) delete process.env[key];
// The task files bucket (ADR 20261113-task-description-files-in-activities-api-bucket) is unset too: the file tests swap in a fake storage
// (setStorageForTests), and a developer's MinIO or Railway credentials must never be reached.
for (const key of [
  "ACTIVITIES_S3_ENDPOINT",
  "ACTIVITIES_S3_REGION",
  "ACTIVITIES_S3_BUCKET",
  "ACTIVITIES_S3_ACCESS_KEY_ID",
  "ACTIVITIES_S3_SECRET_ACCESS_KEY",
  "ACTIVITIES_S3_EU_ENDPOINT_HOSTS",
]) delete process.env[key];
process.env["NODE_ENV"] = "test";
// A developer's maintenance switch must never leak into the suite; tests flip it on `env`.
process.env["ACTIVITIES_MAINTENANCE"] = "false";
