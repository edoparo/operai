/**
 * `parseEnv` (specs/20261110-activities T3): the host URLs are required, the notifier's credentials are all
 * or none, and no error message ever carries a received value.
 */
import { describe, expect, it } from "bun:test";
import { parseEnv } from "./env";

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5435/activities",
  ALLOWED_ORIGINS: "http://localhost:5173",
  AUTH_JWKS_URL: "http://localhost:3001/auth/jwks",
  AUTH_ISSUER: "http://localhost:3001",
  AUTH_AUDIENCE: "operai-suite",
  AUTH_BASE_URL: "http://localhost:3001",
  CRM_API_URL: "http://localhost:8084",
  PROJECTS_API_URL: "http://localhost:8086",
} as const;

const SECRET = "s".repeat(32);

describe("parseEnv", () => {
  it("accepts the minimum: both host URLs, no notifier, no system audience", () => {
    const result = parseEnv(BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.CRM_API_URL).toBe("http://localhost:8084");
    expect(result.env.PROJECTS_API_URL).toBe("http://localhost:8086");
    expect(result.env.NOTIFY_INTERNAL_URL).toBeUndefined();
    expect(result.env.SERVICE_AUDIENCE).toBeUndefined();
  });

  for (const key of ["CRM_API_URL", "PROJECTS_API_URL"] as const) {
    it(`refuses a missing or malformed ${key}`, () => {
      const { [key]: _omitted, ...rest } = BASE;
      const missing = parseEnv(rest);
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(Object.keys(missing.errors)).toEqual([key]);

      const malformed = parseEnv({ ...BASE, [key]: "not a url" });
      expect(malformed.ok).toBe(false);
      // The message names the variable, never the value that was received.
      if (!malformed.ok) expect(JSON.stringify(malformed.errors)).not.toContain("not a url");
    });
  }

  it("accepts the notifier's three credentials together", () => {
    const result = parseEnv({
      ...BASE,
      NOTIFY_INTERNAL_URL: "http://localhost:8081",
      SERVICE_CLIENT_ID: "activities-api",
      SERVICE_CLIENT_SECRET: SECRET,
    });
    expect(result.ok).toBe(true);
  });

  const FULL = { NOTIFY_INTERNAL_URL: "http://localhost:8081", SERVICE_CLIENT_ID: "activities-api", SERVICE_CLIENT_SECRET: SECRET };
  for (const missing of Object.keys(FULL) as Array<keyof typeof FULL>) {
    it(`refuses the notifier's credentials without ${missing}`, () => {
      const { [missing]: _omitted, ...partial } = FULL;
      const result = parseEnv({ ...BASE, ...partial });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(Object.keys(result.errors)).toEqual([missing]);
    });
  }

  it("refuses a service secret shorter than 32 characters, without echoing it", () => {
    const result = parseEnv({ ...BASE, ...FULL, SERVICE_CLIENT_SECRET: "short-secret" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(["SERVICE_CLIENT_SECRET"]);
      expect(JSON.stringify(result.errors)).not.toContain("short-secret");
    }
  });

  it("refuses a SERVICE_AUDIENCE equal to AUTH_AUDIENCE and accepts a different one", () => {
    expect(parseEnv({ ...BASE, SERVICE_AUDIENCE: "operai-suite" }).ok).toBe(false);
    expect(parseEnv({ ...BASE, SERVICE_AUDIENCE: "operai-services" }).ok).toBe(true);
  });
});
