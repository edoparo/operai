/** specs/029 (T2, AC-6.4): the web-push private key is a secret and never printed. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SECRET_VARS, isSecretVar } from "./manifest";
import { showValue } from "./check";

describe("notify-api web push env", () => {
  test("VAPID_PRIVATE_KEY is a secret, redacted when shown", () => {
    expect(isSecretVar("VAPID_PRIVATE_KEY")).toBe(true);
    expect(SECRET_VARS.has("VAPID_PRIVATE_KEY")).toBe(true);
    const key = "kQ3xYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-";
    expect(showValue("VAPID_PRIVATE_KEY", key)).not.toContain(key);
  });

  test("the public key and subject stay readable so drift is diagnosable", () => {
    expect(isSecretVar("VAPID_PUBLIC_KEY")).toBe(false);
    expect(isSecretVar("VAPID_SUBJECT")).toBe(false);
  });

  test("the production template ships push off and holds the private key only as a 1Password reference", () => {
    const t = readFileSync(resolve(import.meta.dir, "templates/production/notify-api.env"), "utf8");
    expect(t).toMatch(/^PUSH_ENABLED=false$/m);
    const priv = t.split("\n").filter((l) => l.includes("VAPID_PRIVATE_KEY="));
    expect(priv.length).toBeGreaterThan(0);
    for (const l of priv) expect(l).toMatch(/\$\{OP:/);
  });
});
