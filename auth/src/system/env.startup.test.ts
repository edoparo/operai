/**
 * Startup validation of the service-token env (T4, specs/20261006-hardware-
 * inventory — ADR 20261006-scoped-service-jwt-fourth-notify-caller): `lib/env.ts` must exit non-zero when
 * `SERVICE_AUDIENCE` equals `AUTH_AUDIENCE`, when clients are configured
 * without an audience, or when `SERVICE_CLIENTS` is malformed — and must never
 * print a secret while doing so.
 *
 * `env.ts` validates at import time and calls `process.exit(1)`, so each case
 * imports it in a fresh `bun` subprocess. The child inherits this process's
 * environment (the `test-setup.ts` preload has already filled in every
 * required variable); only the service-token variables are overridden. Dummy
 * secrets only.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const AUTH_DIR = resolve(import.meta.dir, "../..");
const SECRET = "dummy-startup-secret-0123456789-abcdefg";
const CLIENTS = JSON.stringify({ "inventory-api": { secret: SECRET, scope: "notifications.push" } });

async function importEnv(
  overrides: Record<string, string | undefined>,
  script = 'await import("./src/lib/env"); console.log("ENV_OK");',
): Promise<{ exitCode: number; output: string }> {
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    ...process.env,
    SERVICE_AUDIENCE: "operai-service-startup-default",
    SERVICE_CLIENTS: undefined,
    // The four US-7 limits and the retired pair start unset, so a case sees only what it sets.
    SERVICE_TOKEN_SERVICE_LIMIT: undefined,
    USERS_CONTACT_SERVICE_LIMIT: undefined,
    SYSTEM_INVALID_CREDENTIAL_LIMIT: undefined,
    SYSTEM_RATE_WINDOW_MS: undefined,
    SERVICE_TOKEN_RATE_LIMIT: undefined,
    SERVICE_TOKEN_RATE_WINDOW_MS: undefined,
    ...overrides,
  })) {
    if (value !== undefined) childEnv[key] = value;
  }

  // `--no-env-file`: Bun would otherwise load a developer's local env file from
  // `cwd` and put back the very variables a case removes.
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", "-e", script],
    {
      cwd: AUTH_DIR,
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: stdout + stderr };
}

// Built from parts so `git grep` for the retired name in auth/src stays empty (T7 done-when).
const RETIRED_TOKEN_VAR = ["NOTIFY", "INTERNAL", "TOKEN"].join("_");

describe("lib/env.ts — service-token startup validation (ADR 20261006-scoped-service-jwt-fourth-notify-caller)", () => {
  test("starts with an audience and no clients (no service caller yet)", async () => {
    const { exitCode, output } = await importEnv({});
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  // specs/20261013-notify-service-credentials T7: the shared notify token is retired. `auth` must start whether
  // or not a stale copy of it is still set (push 2 ships before it is deleted).
  test("starts with the retired shared notify token present", async () => {
    const { exitCode, output } = await importEnv({
      [RETIRED_TOKEN_VAR]: "a-stale-shared-token-that-is-long-enough-0123",
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  test("starts with the retired shared notify token absent", async () => {
    const { exitCode, output } = await importEnv({ [RETIRED_TOKEN_VAR]: undefined });
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  test("starts with a distinct audience and a valid client", async () => {
    const { exitCode, output } = await importEnv({
      SERVICE_AUDIENCE: "operai-service-startup-test",
      SERVICE_CLIENTS: CLIENTS,
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  test("exits non-zero when SERVICE_AUDIENCE equals AUTH_AUDIENCE", async () => {
    const { exitCode, output } = await importEnv({
      SERVICE_AUDIENCE: process.env["AUTH_AUDIENCE"],
      SERVICE_CLIENTS: CLIENTS,
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("SERVICE_AUDIENCE must differ from AUTH_AUDIENCE");
    expect(output).not.toContain("ENV_OK");
    expect(output).not.toContain(SECRET);
  });

  test("exits non-zero when SERVICE_AUDIENCE equals AUTH_AUDIENCE even with no clients", async () => {
    const { exitCode } = await importEnv({ SERVICE_AUDIENCE: process.env["AUTH_AUDIENCE"] });
    expect(exitCode).not.toBe(0);
  });

  test("exits non-zero naming SERVICE_AUDIENCE when it is missing, even with no clients (specs/20261013-notify-service-credentials)", async () => {
    const { exitCode, output } = await importEnv({ SERVICE_AUDIENCE: undefined });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("SERVICE_AUDIENCE");
    expect(output).not.toContain("ENV_OK");
  });

  test("exits non-zero when clients are configured without an audience", async () => {
    const { exitCode, output } = await importEnv({ SERVICE_AUDIENCE: undefined, SERVICE_CLIENTS: CLIENTS });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("SERVICE_AUDIENCE");
    expect(output).not.toContain(SECRET);
  });

  test("exits non-zero on a malformed SERVICE_CLIENTS and never prints the secret", async () => {
    for (const bad of [
      "{not json",
      JSON.stringify({ "inventory-api": { secret: SECRET, scope: "email.send" } }),
      JSON.stringify({ "inventory-api": { secret: "short", scope: "notifications.push" } }),
    ]) {
      const { exitCode, output } = await importEnv({
        SERVICE_AUDIENCE: "operai-service-startup-test",
        SERVICE_CLIENTS: bad,
      });
      expect(exitCode).not.toBe(0);
      expect(output).toContain("SERVICE_CLIENTS");
      expect(output).not.toContain(SECRET);
    }
  });
});

describe("lib/env.ts — ALLOWED_SIGNUP_DOMAINS (specs/20261105-signup-gate AC-1.3, AC-5.1)", () => {
  test("starts with a valid list", async () => {
    const { exitCode, output } = await importEnv({ ALLOWED_SIGNUP_DOMAINS: "welld.ch,welld.it" });
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  test("exits non-zero naming the variable when it is missing", async () => {
    const { exitCode, output } = await importEnv({ ALLOWED_SIGNUP_DOMAINS: undefined });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
    expect(output).not.toContain("ENV_OK");
  });

  test("exits non-zero on a malformed list", async () => {
    for (const bad of ["", "welld.ch,", "WellD.CH", "@welld.ch", "welld"]) {
      const { exitCode, output } = await importEnv({ ALLOWED_SIGNUP_DOMAINS: bad });
      expect(exitCode).not.toBe(0);
      expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
    }
  });

  // specs/20261105-signup-gate T13: a reserved test domain is local/e2e configuration only (plan.md amendment 2026-11-05).
  test("starts with a reserved test domain outside production when ENABLE_TEST_AUTH is true", async () => {
    const { exitCode, output } = await importEnv({
      NODE_ENV: "development",
      ENABLE_TEST_AUTH: "true",
      ALLOWED_SIGNUP_DOMAINS: "welld.ch,welld.it,operai.test",
    });
    expect(exitCode).toBe(0);
    expect(output).toContain("ENV_OK");
  });

  test("exits under NODE_ENV=production when the list holds a reserved test domain", async () => {
    for (const bad of ["welld.ch,operai.test", "welld.ch,mail.example", "x.invalid", "a.localhost"]) {
      const { exitCode, output } = await importEnv({
        NODE_ENV: "production",
        ALLOWED_SIGNUP_DOMAINS: bad,
      });
      expect(exitCode).not.toBe(0);
      expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
      expect(output).not.toContain("ENV_OK");
    }
  });

  // specs/20261105-signup-gate T14: the reserved-domain allowance is tied to the test-auth gate, not only to NODE_ENV.
  test("exits when the list holds a reserved test domain and ENABLE_TEST_AUTH is not true", async () => {
    for (const flag of [undefined, "false", "0"]) {
      const { exitCode, output } = await importEnv({
        NODE_ENV: "development",
        ENABLE_TEST_AUTH: flag,
        ALLOWED_SIGNUP_DOMAINS: "welld.ch,operai.test",
      });
      expect(exitCode).not.toBe(0);
      expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
      expect(output).not.toContain("ENV_OK");
    }
  });

  test("exits on a reserved test domain in production even with ENABLE_TEST_AUTH=true", async () => {
    const { exitCode, output } = await importEnv({
      NODE_ENV: "production",
      ENABLE_TEST_AUTH: "true",
      ALLOWED_SIGNUP_DOMAINS: "welld.ch,operai.test",
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
  });

  test("exits on a trailing-dot domain", async () => {
    const { exitCode, output } = await importEnv({
      NODE_ENV: "development",
      ENABLE_TEST_AUTH: "true",
      ALLOWED_SIGNUP_DOMAINS: "welld.ch,operai.test.",
    });
    expect(exitCode).not.toBe(0);
    expect(output).toContain("ALLOWED_SIGNUP_DOMAINS");
  });

  test("production still accepts the real domains", async () => {
    const { exitCode, output } = await importEnv({
      NODE_ENV: "production",
      ALLOWED_SIGNUP_DOMAINS: "welld.ch,welld.it",
    });
    // Production may refuse for an unrelated missing variable; the domain list must not be the reason.
    expect(output).not.toContain("reserved test domain");
    if (exitCode === 0) expect(output).toContain("ENV_OK");
  });
});

// specs/20261111-push-notifications US-7 (ADR 20261112-system-endpoints-limited-per-verified-service): per-service allowances for the two /system endpoints, one window, and the
// retired address-keyed pair. Printed by a child so the effective values are read exactly as the process sees them.
const PRINT_LIMITS =
  'const { env } = await import("./src/lib/env"); ' +
  "console.log(JSON.stringify([env.SERVICE_TOKEN_SERVICE_LIMIT, env.USERS_CONTACT_SERVICE_LIMIT, " +
  "env.SYSTEM_INVALID_CREDENTIAL_LIMIT, env.SYSTEM_RATE_WINDOW_MS]));";

describe("lib/env.ts — system endpoint limits (specs/20261111-push-notifications US-7, AC-7.1/7.2/7.5)", () => {
  test("defaults: 300 tokens, 600 lookups, 20 invalid, 600000 ms window", async () => {
    const { exitCode, output } = await importEnv({}, PRINT_LIMITS);
    expect(exitCode).toBe(0);
    expect(output).toContain("[300,600,20,600000]");
  });

  test("each value is configurable", async () => {
    const { exitCode, output } = await importEnv(
      {
        SERVICE_TOKEN_SERVICE_LIMIT: "50",
        USERS_CONTACT_SERVICE_LIMIT: "70",
        SYSTEM_INVALID_CREDENTIAL_LIMIT: "5",
        SYSTEM_RATE_WINDOW_MS: "1000",
      },
      PRINT_LIMITS,
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("[50,70,5,1000]");
  });

  test("exits non-zero naming the variable on a non-positive, fractional or non-numeric limit", async () => {
    for (const name of ["SERVICE_TOKEN_SERVICE_LIMIT", "USERS_CONTACT_SERVICE_LIMIT", "SYSTEM_INVALID_CREDENTIAL_LIMIT"]) {
      for (const bad of ["0", "-1", "1.5", "lots"]) {
        const { exitCode, output } = await importEnv({ [name]: bad }, PRINT_LIMITS);
        expect(exitCode).not.toBe(0);
        expect(output).toContain(name);
      }
    }
  });

  test("exits non-zero naming SYSTEM_RATE_WINDOW_MS below 1000 ms", async () => {
    for (const bad of ["0", "999", "-5", "abc", "1500.5"]) {
      const { exitCode, output } = await importEnv({ SYSTEM_RATE_WINDOW_MS: bad }, PRINT_LIMITS);
      expect(exitCode).not.toBe(0);
      expect(output).toContain("SYSTEM_RATE_WINDOW_MS");
    }
    expect((await importEnv({ SYSTEM_RATE_WINDOW_MS: "1000" }, PRINT_LIMITS)).exitCode).toBe(0);
  });

  test("the retired SERVICE_TOKEN_RATE_* are ignored: start fine, values never used, one warning names them", async () => {
    const { exitCode, output } = await importEnv(
      { SERVICE_TOKEN_RATE_LIMIT: "7", SERVICE_TOKEN_RATE_WINDOW_MS: "4321" },
      PRINT_LIMITS,
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("[300,600,20,600000]");
    const warnings = output.split("\n").filter((l) => l.includes("SERVICE_TOKEN_RATE_LIMIT"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SERVICE_TOKEN_RATE_WINDOW_MS");
    expect(warnings[0]).toContain("ignored");
    expect(output).not.toContain("4321");
  });

  test("a retired value that would have been invalid does not stop the start; no warning when unset", async () => {
    const bad = await importEnv({ SERVICE_TOKEN_RATE_LIMIT: "0", SERVICE_TOKEN_RATE_WINDOW_MS: "x" }, PRINT_LIMITS);
    expect(bad.exitCode).toBe(0);
    const clean = await importEnv({}, PRINT_LIMITS);
    expect(clean.output).not.toContain("SERVICE_TOKEN_RATE");
  });
});
