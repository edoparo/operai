/**
 * Contract test (T2, specs/019): a token minted by `POST /system/service-token`
 * with scope `users.contact` is accepted by `POST /system/users/contact` using
 * the REAL in-process key source (`jwksFromAuth(auth)` — better-auth's key
 * set), and a user JWT is refused. Lives in `src/auth/` for the same reason as
 * `service-token.contract.test.ts` (it needs the real `auth.config`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../lib/db";

const { env } = await import("../lib/env");
const { auth } = await import("./auth.config");
const { createServiceTokenRouter, signWithAuth } = await import("../system/serviceToken.routes");
const { createSystemRateLimits } = await import("../system/systemRateLimits");
const { createUserContactRouter, jwksFromAuth } = await import("../system/userContact.routes");

const tokenRouter = createServiceTokenRouter({ signJwt: signWithAuth(auth), limits: createSystemRateLimits() });
const contactRouter = createUserContactRouter({ getJwks: jwksFromAuth(auth), limits: createSystemRateLimits() });

const SERVICE_AUDIENCE = "operai-user-contact-contract-test";
const SECRET = "dummy-contact-contract-secret-0123456789";
const RUN_ID = crypto.randomUUID().slice(0, 8);
const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { audience: env.SERVICE_AUDIENCE, clients: env.SERVICE_CLIENTS };
let userId = "";

beforeAll(async () => {
  mutableEnv["SERVICE_AUDIENCE"] = SERVICE_AUDIENCE;
  mutableEnv["SERVICE_CLIENTS"] = new Map([
    ["notify-api", { secret: SECRET, scopes: ["users.contact"] }],
    ["inventory-api", { secret: SECRET, scopes: ["notifications.push"] }],
  ]);
  userId = (await db.user.create({ data: { name: `T2c ${RUN_ID}`, email: `t2c-${RUN_ID}@operai.test` } })).id;
});
afterAll(async () => {
  mutableEnv["SERVICE_AUDIENCE"] = saved.audience;
  mutableEnv["SERVICE_CLIENTS"] = saved.clients;
  await db.user.deleteMany({ where: { id: userId } });
});

async function mint(clientId: string, ip: string): Promise<string> {
  const res = await tokenRouter.request("/system/service-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ clientId, clientSecret: SECRET }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const lookup = (token: string, ip: string) =>
  contactRouter.request("/system/users/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Forwarded-For": ip },
    body: JSON.stringify({ userId }),
  });

describe("users.contact accepts what service-token mints", () => {
  test("a notify-api token with users.contact resolves the user", async () => {
    const res = await lookup(await mint("notify-api", "198.51.100.31"), "198.51.100.32");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: userId, email: `t2c-${RUN_ID}@operai.test`, name: `T2c ${RUN_ID}` });
  });

  test("a genuine service token without the scope is refused", async () => {
    const res = await lookup(await mint("inventory-api", "198.51.100.33"), "198.51.100.34");
    expect(res.status).toBe(401);
  });

  test("a user session JWT (aud AUTH_AUDIENCE) is refused", async () => {
    const { token } = await auth.api.signJWT({
      body: {
        payload: {
          iss: env.BETTER_AUTH_URL,
          sub: userId,
          aud: env.AUTH_AUDIENCE,
          scope: "users.contact",
          exp: Math.floor(Date.now() / 1000) + 300,
        },
      },
    });
    expect((await lookup(token, "198.51.100.35")).status).toBe(401);
  });
});
