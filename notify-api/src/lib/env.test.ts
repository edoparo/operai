/**
 * specs/029 (T2, AC-6.1/6.4): the web-push env group. env.ts runs process.exit(1)
 * at import time, so each case boots it in a child process (as env.emailNotices.test.ts
 * does) — the shared `@/lib/db` singleton in THIS process is never touched.
 * Failures name the variables, never a value.
 */
import { describe, expect, test } from "bun:test";
import { createECDH } from "node:crypto";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const MANAGED = [
  "PUSH_ENABLED",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
  "PUSH_EXCLUDED_ORIGINS",
  "APP_BASE_URL",
  "AUTH_BASE_URL",
  "SERVICE_CLIENT_ID",
  "SERVICE_CLIENT_SECRET",
] as const;

function keyPair() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    pub: ecdh.getPublicKey().toString("base64url"),
    priv: ecdh.getPrivateKey().toString("base64url"),
  };
}
const A = keyPair();
const B = keyPair();

const NOTICES: Record<string, string> = {
  APP_BASE_URL: "https://operai.example.test",
  AUTH_BASE_URL: "https://auth.example.test",
  SERVICE_CLIENT_ID: "notify-api",
  SERVICE_CLIENT_SECRET: "s".repeat(40),
};
const PUSH_ON: Record<string, string> = {
  PUSH_ENABLED: "true",
  VAPID_PUBLIC_KEY: A.pub,
  VAPID_PRIVATE_KEY: A.priv,
  VAPID_SUBJECT: "mailto:ops@example.test",
  ...NOTICES,
};

async function boot(vars: Record<string, string>) {
  const childEnv: Record<string, string | undefined> = { ...process.env };
  for (const k of MANAGED) delete childEnv[k];
  Object.assign(childEnv, vars);
  const proc = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `const { env } = await import("./src/lib/env.ts"); console.log("BOOT_OK:" + JSON.stringify({ on: env.PUSH_ENABLED, ex: env.PUSH_EXCLUDED_ORIGINS }));`,
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

describe("push env group", () => {
  test("unset: off, boots, no VAPID needed", async () => {
    const { out, code } = await boot({});
    expect(code).toBe(0);
    expect(out).toContain(`BOOT_OK:{"on":false,"ex":[]}`);
  });

  for (const v of ["false", "0", "", "TRUE-ish", "yes"]) {
    test(`PUSH_ENABLED=${JSON.stringify(v)} is off`, async () => {
      const { out, code } = await boot({ PUSH_ENABLED: v });
      expect(code).toBe(0);
      expect(out).toContain(`"on":false`);
    });
  }

  test("enabled with everything valid: boots on", async () => {
    const { out, code } = await boot(PUSH_ON);
    expect(code).toBe(0);
    expect(out).toContain(`"on":true`);
  });

  test("PUSH_ENABLED=TRUE is on (same parsing as EMAIL_ENABLED)", async () => {
    const { code, out } = await boot({ ...PUSH_ON, PUSH_ENABLED: "TRUE" });
    expect(code).toBe(0);
    expect(out).toContain(`"on":true`);
  });

  for (const missing of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    test(`enabled without ${missing}: exits naming it`, async () => {
      const vars = { ...PUSH_ON };
      delete vars[missing];
      const { err, code } = await boot(vars);
      expect(code).toBe(1);
      expect(err).toContain(missing);
      expect(err).not.toContain(A.priv);
    });
  }

  test("enabled without any VAPID var or subject: names all three", async () => {
    const { err, code } = await boot({ PUSH_ENABLED: "true", ...NOTICES });
    expect(code).toBe(1);
    for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) expect(err).toContain(k);
  });

  for (const missing of ["APP_BASE_URL", "AUTH_BASE_URL", "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET"]) {
    test(`enabled without email-notice var ${missing}: exits naming it`, async () => {
      const vars = { ...PUSH_ON };
      delete vars[missing];
      const { err, code } = await boot(vars);
      expect(code).toBe(1);
      expect(err).toContain(missing);
    });
  }

  test("enabled with no email-notice group at all: names all four", async () => {
    const vars = { ...PUSH_ON };
    for (const k of Object.keys(NOTICES)) delete vars[k];
    const { err, code } = await boot(vars);
    expect(code).toBe(1);
    for (const k of Object.keys(NOTICES)) expect(err).toContain(k);
  });

  test("disabled: the email-notice group stays optional and the VAPID vars are ignored", async () => {
    const { code } = await boot({ VAPID_PRIVATE_KEY: "garbage" });
    expect(code).toBe(0);
  });

  test("private key that does not derive the public key: exits, no key echoed", async () => {
    const { err, code } = await boot({ ...PUSH_ON, VAPID_PRIVATE_KEY: B.priv });
    expect(code).toBe(1);
    expect(err).toContain("VAPID_PRIVATE_KEY");
    expect(err).not.toContain(B.priv);
    expect(err).not.toContain(A.priv);
  });

  for (const [name, patch] of [
    ["private key not base64url", { VAPID_PRIVATE_KEY: "not a key!!" }],
    ["private key of the wrong length", { VAPID_PRIVATE_KEY: "AAAA" }],
    ["public key of the wrong length", { VAPID_PUBLIC_KEY: "AAAA" }],
    ["public key padded with =", { VAPID_PUBLIC_KEY: `${A.pub}=` }],
    ["a public key off the curve", { VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url") }],
  ] as const) {
    test(`${name}: exits`, async () => {
      const { err, code } = await boot({ ...PUSH_ON, ...patch });
      expect(code).toBe(1);
      expect(err).toContain("VAPID_");
    });
  }

  for (const subject of ["ops@example.test", "http://example.test", "mailto:", "https://", "ftp://x.test"]) {
    test(`VAPID_SUBJECT ${JSON.stringify(subject)} is refused`, async () => {
      const { err, code } = await boot({ ...PUSH_ON, VAPID_SUBJECT: subject });
      expect(code).toBe(1);
      expect(err).toContain("VAPID_SUBJECT");
    });
  }

  test("VAPID_SUBJECT as an https URL is accepted", async () => {
    const { code } = await boot({ ...PUSH_ON, VAPID_SUBJECT: "https://operai.example.test/contact" });
    expect(code).toBe(0);
  });

  test("PUSH_EXCLUDED_ORIGINS: CSV of known origins, trimmed, blanks dropped", async () => {
    const { out, code } = await boot({ ...PUSH_ON, PUSH_EXCLUDED_ORIGINS: " crm , meetings,," });
    expect(code).toBe(0);
    expect(out).toContain(`"ex":["crm","meetings"]`);
  });

  test("PUSH_EXCLUDED_ORIGINS with an unknown origin: exits naming the variable", async () => {
    const { err, code } = await boot({ ...PUSH_ON, PUSH_EXCLUDED_ORIGINS: "crm,nope" });
    expect(code).toBe(1);
    expect(err).toContain("PUSH_EXCLUDED_ORIGINS");
  });

  test("PUSH_EXCLUDED_ORIGINS is validated even when push is off", async () => {
    const { err, code } = await boot({ PUSH_EXCLUDED_ORIGINS: "nope" });
    expect(code).toBe(1);
    expect(err).toContain("PUSH_EXCLUDED_ORIGINS");
  });
});
