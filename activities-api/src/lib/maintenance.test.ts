/**
 * The maintenance switch (specs/20261110-activities AC-2.5, ADR 20261110-activities-migration-write-pause): while the CRM activities are being
 * copied in, nothing may read or write. Every route but GET /health answers 503
 * `maintenance`, whoever asks and whatever they ask.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { app, call, resetWorld, withMaintenance } from "../test-support/world";

afterEach(resetWorld);

// Routes that do not exist yet (T7+) are fine here: the gate sits in front of the router, so
// a path that would be 404 off is still 503 on. That is also the point: no route added later
// can forget the gate.
const ROUTES: ReadonlyArray<readonly [string, string]> = [
  ["GET", "/activities"],
  ["POST", "/activities"],
  ["PATCH", "/activities/a1"],
  ["DELETE", "/activities/a1"],
  ["POST", "/activities/a1/complete"],
  ["GET", "/tasks"],
  ["PUT", "/system/v1/activities/a1"],
  ["POST", "/system/v1/meeting-mirror"],
  ["POST", "/system/v1/contacts/k1/erase"],
  ["GET", "/openapi.json"],
  ["GET", "/docs"],
  ["GET", "/nothing-at-all"],
];

describe("ACTIVITIES_MAINTENANCE=true", () => {
  it.each(ROUTES)("%s %s answers 503 `maintenance` with a valid token", async (method, path) => {
    await withMaintenance(async () => {
      const res = await call(method, path, method === "GET" || method === "DELETE" ? {} : { body: {} });
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ status: 503, code: "maintenance", instance: path });
    });
  });

  it("answers 503 before authentication: no token is still `maintenance`, not 401", async () => {
    await withMaintenance(async () => {
      const res = await call("GET", "/activities", { as: null });
      expect(res.status).toBe(503);
      expect(res.json.code).toBe("maintenance");
    });
  });

  it("refuses a write other than GET /health on the health path itself", async () => {
    await withMaintenance(async () => {
      const res = await call("POST", "/health", { body: {} });
      expect(res.status).toBe(503);
      expect(res.json.code).toBe("maintenance");
    });
  });

  it("lets the CORS preflight through, so the browser can read the 503", async () => {
    await withMaintenance(async () => {
      const res = await app.request("/activities", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });
  });

  it("carries the CORS headers on the 503 itself", async () => {
    await withMaintenance(async () => {
      const res = await app.request("/activities", { headers: { Origin: "http://localhost:5173" } });
      expect(res.status).toBe(503);
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    });
  });

  it("is read per request: switching it off restores the routes", async () => {
    await withMaintenance(async () => {
      expect((await call("GET", "/nothing-at-all")).status).toBe(503);
    });
    const res = await call("GET", "/nothing-at-all");
    expect(res.status).toBe(404);
    expect(res.json.code).toBeUndefined();
  });
});

describe("ACTIVITIES_MAINTENANCE parsing", () => {
  // env.ts validates at import and exits the process, so each case runs a fresh process.
  const run = (value: string | undefined) => {
    const base: Record<string, string> = {
      DATABASE_URL: "postgresql://x:x@localhost:5435/activities_test",
      ALLOWED_ORIGINS: "http://localhost:5173",
      AUTH_JWKS_URL: "http://localhost:3001/auth/jwks",
      AUTH_ISSUER: "http://localhost:3001",
      AUTH_AUDIENCE: "aud",
      AUTH_BASE_URL: "http://localhost:3001",
      CRM_API_URL: "http://localhost:8084",
      PROJECTS_API_URL: "http://localhost:8086",
      PATH: process.env["PATH"] ?? "",
    };
    if (value !== undefined) base["ACTIVITIES_MAINTENANCE"] = value;
    const proc = Bun.spawnSync(
      ["bun", "-e", 'const { env } = await import("./src/lib/env"); console.log(JSON.stringify(env.ACTIVITIES_MAINTENANCE));'],
      { cwd: import.meta.dir + "/../..", env: base },
    );
    return { code: proc.exitCode, out: proc.stdout.toString().trim(), err: proc.stderr.toString() };
  };

  it.each([
    [undefined, "false"],
    ["false", "false"],
    ["true", "true"],
    [" TRUE ", "true"],
  ])("%p reads as %s", (value, expected) => {
    const r = run(value);
    expect(r.code).toBe(0);
    expect(r.out).toBe(expected);
  });

  it.each(["1", "yes", "", "tru"])("%p stops the start instead of reading as off", (value) => {
    const r = run(value);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ACTIVITIES_MAINTENANCE");
  });
});
