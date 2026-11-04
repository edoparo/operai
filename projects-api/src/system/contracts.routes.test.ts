/**
 * GET /system/contracts (specs/022-projects-handoff T4 — AC-3.4; ADR-0060): the contracts of
 * the asked deals, with their project's name and Bexio order id, read service-to-service by
 * crm-api for the deal page — for users who may hold no `projects:access`. It trusts a scoped
 * SERVICE credential (`projects.contracts.read`), never a user JWT.
 *
 * Real Postgres (the `*_test` database); the JWKS is an in-memory one injected into the
 * middleware, so no live `auth` is needed. The credential matrix is crm-api's: every failure
 * answers the SAME 401, byte for byte. The last block goes through the ASSEMBLED app: the
 * route is mounted, a user JWT never opens it, and with SERVICE_AUDIENCE unset (as in the
 * test environment) every request is a 401.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { app as assembledApp, call, db } from "../test-support/world";
import { TEST_AUDIENCE, TEST_ISSUER } from "../test-support/testAuth";
import { createSystemAuthMiddleware } from "./systemAuth.middleware";
import { createSystemContractsRouter } from "./contracts.routes";

const SERVICE_AUD = "operai-system-test";
const KID = "svc-contracts-kid";
const RUN = crypto.randomUUID().slice(0, 8);
const PREFIX = `svc-contract-${RUN}`;
const URL_PATH = "/system/contracts";
const SCOPE = "projects.contracts.read";

let signingKey: CryptoKey;
let app: Hono;
let noAudienceApp: Hono;

const serviceJwt = (
  o: { sub?: string; scope?: string | null; aud?: string; exp?: string | number } = {},
): Promise<string> => {
  const claims: Record<string, unknown> = {};
  if (o.scope !== null) claims["scope"] = o.scope ?? SCOPE;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(TEST_ISSUER)
    .setAudience(o.aud ?? SERVICE_AUD)
    .setSubject(o.sub ?? "system:crm-api")
    .setExpirationTime(o.exp ?? "5m")
    .sign(signingKey);
};

const get = async (query = "", token?: string, target: Hono = app): Promise<Response> =>
  target.request(`${URL_PATH}${query}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

interface Item {
  dealId: string;
  contractId: string;
  project: { id: string; name: string };
  bexioOrderId: string | null;
}
const body = async (res: Response): Promise<{ items: Item[] }> => (await res.json()) as { items: Item[] };

/** A project with one `deal` contract made from `dealId`. */
const makeContract = async (dealId: string, o: { projectName?: string; bexioOrderId?: string | null } = {}) => {
  const project = await db.project.create({
    data: {
      name: o.projectName ?? `${PREFIX} project of ${dealId}`,
      type: "t_and_m",
      entity: "welld_ch",
      companyId: "co-system-test",
      projectManagerId: "user-pm-ch",
      createdById: "user-pm-ch",
    },
  });
  const contract = await db.contract.create({
    data: {
      projectId: project.id,
      type: "t_and_m",
      companyId: "co-system-test",
      origin: "deal",
      dealId,
      bexioOrderId: o.bexioOrderId ?? null,
      startDate: new Date("2026-12-01T00:00:00Z"),
    },
  });
  return { project, contract };
};

const cleanup = async () => {
  await db.contract.deleteMany({ where: { dealId: { startsWith: PREFIX } } });
  await db.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
};

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const jwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" }],
  });
  app = new Hono();
  app.route("/", createSystemContractsRouter(createSystemAuthMiddleware({ scope: SCOPE, jwks, audience: SERVICE_AUD })));
  noAudienceApp = new Hono();
  noAudienceApp.route(
    "/",
    createSystemContractsRouter(createSystemAuthMiddleware({ scope: SCOPE, jwks, audience: undefined })),
  );
  await cleanup();
});

afterAll(cleanup);

describe("GET /system/contracts?dealIds= — the deal page's source (AC-3.4)", () => {
  it("returns the contract of each asked deal with its project's name and Bexio order id, and omits deals without one", async () => {
    const a = await makeContract(`${PREFIX}-a`, { projectName: `${PREFIX} Alpha`, bexioOrderId: "BX-1001" });
    const b = await makeContract(`${PREFIX}-b`, { projectName: `${PREFIX} Beta` });
    await makeContract(`${PREFIX}-not-asked`);

    const res = await get(`?dealIds=${PREFIX}-b,${PREFIX}-a,${PREFIX}-none`, await serviceJwt());

    expect(res.status).toBe(200);
    expect((await body(res)).items).toEqual([
      { dealId: `${PREFIX}-b`, contractId: b.contract.id, project: { id: b.project.id, name: `${PREFIX} Beta` }, bexioOrderId: null },
      {
        dealId: `${PREFIX}-a`,
        contractId: a.contract.id,
        project: { id: a.project.id, name: `${PREFIX} Alpha` },
        bexioOrderId: "BX-1001",
      },
    ]);
  });

  it("answers an empty list when none of the asked deals has a contract", async () => {
    const res = await get(`?dealIds=${PREFIX}-nothing`, await serviceJwt());
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ items: [] });
  });

  it("carries nothing beyond dealId, contractId, project and bexioOrderId", async () => {
    await makeContract(`${PREFIX}-shape`, { bexioOrderId: "BX-7" });
    const res = await get(`?dealIds=${PREFIX}-shape`, await serviceJwt());
    const [item] = (await body(res)).items;
    expect(Object.keys(item ?? {}).sort()).toEqual(["bexioOrderId", "contractId", "dealId", "project"]);
    expect(Object.keys(item?.project ?? {}).sort()).toEqual(["id", "name"]);
  });

  it("accepts exactly 100 ids and refuses 101 (400)", async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => `${PREFIX}-x${i}`);
    expect((await get(`?dealIds=${hundred.join(",")}`, await serviceJwt())).status).toBe(200);
    expect((await get(`?dealIds=${[...hundred, `${PREFIX}-x100`].join(",")}`, await serviceJwt())).status).toBe(400);
  });

  it("refuses a missing, empty or malformed dealIds (400)", async () => {
    const token = await serviceJwt();
    expect((await get("", token)).status).toBe(400);
    expect((await get("?dealIds=", token)).status).toBe(400);
    expect((await get("?dealIds=a,,b", token)).status).toBe(400);
    expect((await get(`?dealIds=${"x".repeat(65)}`, token)).status).toBe(400);
  });
});

describe("GET /system/contracts — only a scoped service credential opens it (AC-3.4)", () => {
  it("answers the identical 401 for a user JWT, another scope, no token and every JWT defect", async () => {
    const q = `?dealIds=${PREFIX}-a`;
    const attempts: Array<[string, Promise<Response>]> = [
      ["no token", get(q)],
      ["garbage", get(q, "not.a.jwt")],
      ["another scope", serviceJwt({ scope: "crm.deals.read" }).then((t) => get(q, t))],
      ["no scope", serviceJwt({ scope: null }).then((t) => get(q, t))],
      ["a user audience", serviceJwt({ aud: TEST_AUDIENCE }).then((t) => get(q, t))],
      ["a user subject", serviceJwt({ sub: "user-admin" }).then((t) => get(q, t))],
      ["expired", serviceJwt({ exp: Math.floor(Date.now() / 1000) - 60 }).then((t) => get(q, t))],
      ["audience unset", serviceJwt().then((t) => get(q, t, noAudienceApp))],
    ];
    const bodies = new Set<string>();
    for (const [label, pending] of attempts) {
      const res = await pending;
      expect({ label, status: res.status }).toEqual({ label, status: 401 });
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
  });

  it("is mounted on the assembled app, which refuses every user JWT and, with SERVICE_AUDIENCE unset, every credential", async () => {
    const q = `?dealIds=${PREFIX}-a`;
    const user = await call("GET", `${URL_PATH}${q}`, { as: "admin" });
    expect(user.status).toBe(401);
    const none = await call("GET", `${URL_PATH}${q}`, { as: null });
    expect(none.status).toBe(401);
    expect(none.json).toEqual(user.json);
    const service = await assembledApp.request(`${URL_PATH}${q}`, {
      headers: { Authorization: `Bearer ${await serviceJwt()}` },
    });
    expect(service.status).toBe(401);
  });
});
