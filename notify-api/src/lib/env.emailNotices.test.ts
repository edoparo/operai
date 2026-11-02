/**
 * specs/019 (ADR-0056): the email-notice env group is optional but all-or-none.
 * env.ts runs process.exit(1) at import time, so each case boots it in a child
 * process. Failures name the missing variables, never a value.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const GROUP = ["APP_BASE_URL", "AUTH_BASE_URL", "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET"] as const;
const SECRET = "s".repeat(40);
const FULL: Record<string, string> = {
  APP_BASE_URL: "https://operai.example.test",
  AUTH_BASE_URL: "https://auth.example.test",
  SERVICE_CLIENT_ID: "notify-api",
  SERVICE_CLIENT_SECRET: SECRET,
};

async function boot(group: Record<string, string>) {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const k of GROUP) delete childEnv[k];
  Object.assign(childEnv, group);
  const proc = Bun.spawn(
    [
      process.execPath,
      "-e",
      `const { env } = await import("./src/lib/env.ts"); console.log("BOOT_OK:" + (env.APP_BASE_URL !== undefined));`,
    ],
    { cwd: ROOT, env: childEnv, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

describe("email-notice env group", () => {
  test("none set: boots, warns once that email notices are disabled", async () => {
    const { out, err, code } = await boot({});
    expect(code).toBe(0);
    expect(out).toContain("BOOT_OK:false");
    expect(err).toContain("email notices are disabled");
  });

  test("all four set: boots without the warning", async () => {
    const { out, err, code } = await boot(FULL);
    expect(code).toBe(0);
    expect(out).toContain("BOOT_OK:true");
    expect(err).not.toContain("email notices are disabled");
  });

  for (const missing of GROUP) {
    test(`only ${missing} missing: exits, naming it and no value`, async () => {
      const group = { ...FULL };
      delete group[missing];
      const { err, code } = await boot(group);
      expect(code).toBe(1);
      expect(err).toContain(missing);
      expect(err).not.toContain(SECRET);
      expect(err).not.toContain("example.test");
    });
  }

  test("a short secret is refused without echoing it", async () => {
    const { err, code } = await boot({ ...FULL, SERVICE_CLIENT_SECRET: "short-secret" });
    expect(code).toBe(1);
    expect(err).toContain("SERVICE_CLIENT_SECRET");
    expect(err).not.toContain("short-secret");
  });

  test("a non-http(s) APP_BASE_URL is refused", async () => {
    const { err, code } = await boot({ ...FULL, APP_BASE_URL: "ftp://operai.example.test" });
    expect(code).toBe(1);
    expect(err).toContain("APP_BASE_URL");
  });
});
