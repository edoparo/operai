/**
 * The `activities.write` service scope end to end through the token endpoint
 * (specs/028-activities, T1 — AC-1.2, AC-1.3, AC-1.4, AC-8.4): a client parsed from
 * `SERVICE_CLIENTS` with the scope gets it in its minted JWT, and an unknown scope
 * never reaches a token because the entry does not parse.
 *
 * Same shape as `serviceClients.hostNotices.test.ts` (injected signer over a throwaway
 * in-memory key; secrets are obvious dummies).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { decodeJwt, generateKeyPair, SignJWT } from "jose";
import type { ServiceJwtPayload } from "./serviceToken.routes";
import { DOCUMENTED_CLIENT_SCOPES, parseServiceClients } from "./serviceClients";

const { env } = await import("../lib/env");
const { createServiceTokenRouter } = await import("./serviceToken.routes");

const { privateKey } = await generateKeyPair("RS256");
const signJwt = async (payload: ServiceJwtPayload): Promise<string> =>
  new SignJWT({ scope: payload.scope })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(payload.iss)
    .setSubject(payload.sub)
    .setAudience(payload.aud)
    .setIssuedAt(payload.iat)
    .setExpirationTime(payload.exp)
    .setJti(payload.jti)
    .sign(privateKey);

const router = createServiceTokenRouter({ signJwt });

const SERVICE_AUDIENCE = "operai-activities-test";
const SECRET = "dummy-activities-write-secret-0123456789-abcd";

const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { audience: env.SERVICE_AUDIENCE, clients: env.SERVICE_CLIENTS };

const documentedClients = () =>
  JSON.stringify({
    "crm-api": { secret: SECRET, scope: DOCUMENTED_CLIENT_SCOPES["crm-api"] },
    "activities-api": { secret: SECRET, scope: DOCUMENTED_CLIENT_SCOPES["activities-api"] },
  });

function configureFrom(rawClients: string): void {
  const parsed = parseServiceClients(rawClients);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  mutableEnv["SERVICE_AUDIENCE"] = SERVICE_AUDIENCE;
  mutableEnv["SERVICE_CLIENTS"] = parsed.clients;
}

beforeAll(() => configureFrom(documentedClients()));
afterAll(() => {
  mutableEnv["SERVICE_AUDIENCE"] = saved.audience;
  mutableEnv["SERVICE_CLIENTS"] = saved.clients;
});

let ipCounter = 0;
const mint = (clientId: string) =>
  router.request("/system/service-token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${(ipCounter += 1)}` },
    body: JSON.stringify({ clientId, clientSecret: SECRET }),
  });

const scopesOf = async (clientId: string): Promise<string[]> => {
  const res = await mint(clientId);
  expect(res.status).toBe(200);
  const claims = decodeJwt(((await res.json()) as { token: string }).token);
  expect(claims.aud).toBe(SERVICE_AUDIENCE);
  expect(claims.sub).toBe(`system:${clientId}`);
  return String(claims["scope"]).split(" ");
};

describe("activities.write (specs/028 — AC-1.2, AC-1.3, AC-1.4, AC-8.4)", () => {
  test("a token minted for crm-api carries activities.write beside its existing scopes", async () => {
    const scopes = await scopesOf("crm-api");
    expect(scopes).toContain("activities.write");
    expect(scopes).toContain("notifications.push");
  });

  test("activities-api gets notifications.push and emails.send: it pushes email notices but cannot write to itself", async () => {
    const scopes = await scopesOf("activities-api");
    expect([...scopes].sort()).toEqual(["emails.send", "notifications.push"]);
    expect(scopes).not.toContain("activities.write");
  });

  test("an unknown scope never reaches a token: the entry does not parse, so no client exists to mint for", async () => {
    const parsed = parseServiceClients(
      JSON.stringify({ "crm-api": { secret: SECRET, scope: "activities.write activities.admin" } }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join("\n")).toContain('"crm-api"');

    mutableEnv["SERVICE_CLIENTS"] = new Map();
    try {
      expect((await mint("crm-api")).status).toBe(401);
    } finally {
      configureFrom(documentedClients());
    }
  });
});
