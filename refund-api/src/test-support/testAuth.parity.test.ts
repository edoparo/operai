/**
 * The mocked jwt middleware of `testAuth.ts` against the REAL `src/auth/jwt.middleware.ts` (eval round 4, specs/20261118; 1f44c2e5).
 *
 * Every route test runs behind the mock, so if the mock sets other context variables than the real middleware for the same token
 * (the way `userName` was missing from it for a while), the route tests prove something production does not do. Both middlewares
 * are mounted on a tiny app, and the same tokens go through each: the variables must be identical, key for key, and so must the
 * status of a token that is refused.
 */
import { afterAll, describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { FlattenedJWSInput, JWSHeaderParameters } from "jose";
import type { JwtVariables } from "../auth/jwt.middleware";
import { setupTestAuth } from "./testAuth";

const ENV_OVERRIDES: Record<string, string> = {
  ALLOWED_ORIGINS: "http://localhost:5173",
  AUTH_JWKS_URL: "http://localhost:3001/.well-known/jwks.json",
  AUTH_ISSUER: "http://localhost:3001",
  AUTH_AUDIENCE: "operai-suite",
  NODE_ENV: "test",
  NOTIFY_INTERNAL_URL: "http://localhost:8081",
  SERVICE_CLIENT_ID: "refund-api",
  SERVICE_CLIENT_SECRET: "test-service-client-secret-at-least-32-characters",
};
const savedEnv: Record<string, string | undefined> = {};
for (const key of ["DATABASE_URL", ...Object.keys(ENV_OVERRIDES)]) savedEnv[key] = process.env[key];
process.env["DATABASE_URL"] ??= "postgresql://test:test@localhost:5435/test";
for (const [key, value] of Object.entries(ENV_OVERRIDES)) process.env[key] = value;
afterAll(() => {
  for (const [key, previous] of Object.entries(savedEnv)) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

const harness = setupTestAuth();
await harness.init();

// The real middleware builds its JWKS at import time: point it at the harness's key set (as jwt.middleware.test.ts does).
mock.module("jose", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realJose = require("jose") as typeof import("jose");
  return {
    ...realJose,
    createRemoteJWKSet: () => (header?: JWSHeaderParameters, token?: FlattenedJWSInput) => harness.keySet()(header, token),
  };
});

// The mock, as every route test gets it; and a separate instance of the real one (query suffix: runtime-only cache-buster).
const { jwtMiddleware: mocked } = await import("../auth/jwt.middleware");
// @ts-expect-error -- the query suffix is a runtime-only cache-buster
const { jwtMiddleware: real } = (await import("../auth/jwt.middleware?real-parity")) as typeof import("../auth/jwt.middleware");
const { env } = await import("../lib/env");

type Mw = typeof real;
const app = (mw: Mw) => {
  const a = new Hono<{ Variables: JwtVariables }>();
  a.use("/who", mw);
  a.get("/who", (c) => c.json({ userId: c.get("userId"), email: c.get("email"), permEpoch: c.get("permEpoch"), userName: c.get("userName") ?? null, keys: (["userId", "email", "permEpoch", "userName"] as const).filter((k) => c.get(k) !== undefined) }));
  return a;
};
const through = async (mw: Mw, authorization?: string) => {
  const res = await app(mw).request("/who", { headers: authorization ? { Authorization: authorization } : {} });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

describe("testAuth's mocked jwt middleware sets the same context variables as the real one", () => {
  it("the environment the two share is the one the harness signs for", () => {
    expect([env.AUTH_ISSUER, env.AUTH_AUDIENCE]).toEqual(["http://localhost:3001", "operai-suite"]);
  });

  const cases: [string, { sub: string; email: string; permEpoch?: number; name?: string }][] = [
    ["a name and an epoch", { sub: "u1", email: "a@x.com", permEpoch: 7, name: "Ada Lovelace" }],
    ["no name claim", { sub: "u2", email: "b@x.com", permEpoch: 3 }],
    ["no epoch claim (defaults to 0)", { sub: "u3", email: "c@x.com", name: "Grace Hopper" }],
    ["a blank name (no userName at all)", { sub: "u4", email: "d@x.com", permEpoch: 1, name: "   " }],
    ["an empty name", { sub: "u5", email: "e@x.com", name: "" }],
    ["a name with a bidi override (both pass it through; the routes normalise)", { sub: "u6", email: "f@x.com", name: "Ada ‮Lovelace" }],
  ];
  for (const [label, claims] of cases) {
    it(`${label}: userId, email, permEpoch and userName are identical`, async () => {
      const token = await harness.signToken(claims);
      const a = await through(real, `Bearer ${token}`);
      const b = await through(mocked, `Bearer ${token}`);
      expect(a.status).toBe(200);
      expect(b).toEqual(a);
    });
  }

  it("a refused token (none, malformed, garbage) is the same 401 through both", async () => {
    for (const header of [undefined, "Basic abc", "Bearer ", "Bearer not.a.jwt"]) {
      const a = await through(real, header);
      const b = await through(mocked, header);
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
    }
  });
});
