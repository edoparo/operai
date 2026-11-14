/**
 * `POST /system/meeting-host/v1/notices` (specs/20261104-meetings T8, specs/20261110-activities T12; AC-14.1 .. AC-14.9, AC-11.8,
 * AC-1.4; ADR 20261104-meeting-host-contract-resolve-and-notices): crm-api verifies the notice and the deal, then forwards it to activities-api's
 * meeting mirror and relays `{ applied }`. The mirror itself (one `meeting` activity per meeting,
 * the `seq` guard, relink, unlink, delete) is tested where it lives, in activities-api.
 *
 * The service JWT is verified for real (RS256, issuer, audience, scope, sub allowlist); only the
 * key set is local, and activities-api is the stub of test-support/world.ts.
 */
import { TEST_ISSUER } from "../test-support/testAuth"; // sets the environment before ../lib/env is read
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { __setDefaultJwksForTests } from "../auth/systemAuth.middleware";
import { env } from "../lib/env";
import { PERSONAS, activitiesApi, app, call, makeCompany, makeDeal, resetWorld } from "../test-support/world";

const PATH = "/system/meeting-host/v1/notices";
// `bun test` shares one process, so `../lib/env` may have been evaluated by an earlier file before
// testAuth set SERVICE_AUDIENCE; the route reads the audience from that same object, so use it.
env.SERVICE_AUDIENCE ??= "operai-system";
const SERVICE_AUDIENCE = env.SERVICE_AUDIENCE;
const KID = "svc-notices-test";

let key: CryptoKey;
let previousJwks: ReturnType<typeof __setDefaultJwksForTests>;
beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256", use: "sig" };
  // The route verifies against a process-wide key set that an earlier file may already have filled from
  // the network (the matrix posts user tokens here), so swap it for ours instead of stubbing fetch.
  previousJwks = __setDefaultJwksForTests(createLocalJWKSet({ keys: [jwk] }));
});
afterAll(() => {
  __setDefaultJwksForTests(previousJwks);
});
beforeEach(resetWorld);

const serviceToken = (o: { sub?: string; aud?: string; scope?: string } = {}) =>
  new SignJWT({ scope: o.scope ?? "host-notices.send" })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(TEST_ISSUER)
    .setSubject(o.sub ?? "system:meetings-api")
    .setAudience(o.aud ?? SERVICE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

interface Notice {
  noticeId: string;
  seq: number;
  event: "linked" | "changed" | "unlinked" | "deleted";
  meeting: { id: string; title: string | null; startsAt: string | null; creatorId: string };
  entity: { type: string; id: string };
}

const CREATOR = PERSONAS.consultant.sub;
const STARTS = "2026-11-10T09:30:00.000Z";

function notice(meetingId: string, dealId: string, seq: number, event: Notice["event"], extra: { title?: string; startsAt?: string } = {}): Notice {
  const carries = event === "linked" || event === "changed";
  return {
    noticeId: crypto.randomUUID(),
    seq,
    event,
    meeting: {
      id: meetingId,
      title: carries ? (extra.title ?? "Discovery call") : null,
      startsAt: carries ? (extra.startsAt ?? STARTS) : null,
      creatorId: CREATOR,
    },
    entity: { type: "deal", id: dealId },
  };
}

async function send(body: unknown, token?: string) {
  const res = await app.request(PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const post = async (body: unknown) => send(body, await serviceToken());

async function seed() {
  const company = await makeCompany();
  const deal = await makeDeal(company.id, { title: "Platform rebuild" });
  return { company, deal, meetingId: crypto.randomUUID() };
}

describe("who may post a notice (AC-11.8)", () => {
  it("401 without a token, with a user JWT, with another service, with the wrong scope or audience; nothing is forwarded", async () => {
    const { deal, meetingId } = await seed();
    const body = notice(meetingId, deal.id, 1, "linked");
    expect((await send(body)).status).toBe(401);
    for (const token of [
      await serviceToken({ sub: "system:refund-api" }),
      await serviceToken({ scope: "notifications.push" }),
      await serviceToken({ aud: "operai-suite" }),
    ]) {
      expect((await send(body, token)).status).toBe(401);
    }
    const asUser = await call("POST", PATH, { as: "admin", body });
    expect(asUser.status).toBe(401);
    expect(activitiesApi.calls).toHaveLength(0);
  });
});

describe("forwarded to activities-api (AC-1.4, AC-14.1 .. AC-14.7)", () => {
  it("linked: the deal's company travels with the notice, which is sent as crm-api and relayed", async () => {
    const { company, deal, meetingId } = await seed();
    const body = notice(meetingId, deal.id, 1, "linked", { title: "Kick-off" });
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ applied: true });
    expect(activitiesApi.calls).toHaveLength(1);
    expect(activitiesApi.calls[0]).toMatchObject({ op: "mirror", id: null });
    expect(activitiesApi.calls[0]!.authorization).toMatch(/^Bearer svc-token-/);
    expect(activitiesApi.calls[0]!.body).toEqual({
      noticeId: body.noticeId,
      seq: 1,
      event: "linked",
      meeting: { id: meetingId, title: "Kick-off", startsAt: STARTS, creatorId: CREATOR },
      deal: { id: deal.id, companyId: company.id },
    });
  });

  it("changed, unlinked and deleted are forwarded as they are, with no company lookup", async () => {
    const { deal, meetingId } = await seed();
    const changed = notice(meetingId, deal.id, 2, "changed", { title: "Renamed", startsAt: "2026-11-12T14:00:00.000Z" });
    const unlinked = notice(meetingId, deal.id, 3, "unlinked");
    // A deal this service does not know: only `linked` needs to look it up.
    const deleted = notice(meetingId, "gone-deal", 4, "deleted");
    for (const body of [changed, unlinked, deleted]) expect((await post(body)).json).toEqual({ applied: true });
    expect(activitiesApi.calls.map((c) => [c.body.event, c.body.deal])).toEqual([
      ["changed", { id: deal.id }],
      ["unlinked", { id: deal.id }],
      ["deleted", { id: "gone-deal" }],
    ]);
    expect(activitiesApi.calls[0]!.body.meeting).toEqual(changed.meeting);
    expect(activitiesApi.calls[1]!.body.meeting).toEqual(unlinked.meeting);
    expect(activitiesApi.calls[2]!.body.meeting.title).toBeNull();
  });

  it("relays activities-api's `applied: false` (a duplicate or an older notice) unchanged", async () => {
    const { deal, meetingId } = await seed();
    activitiesApi.mirrorApplied = false;
    const res = await post(notice(meetingId, deal.id, 1, "linked"));
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ applied: false });
  });

  it("a deal that does not exist is 422 entity_not_found and nothing is forwarded, so the same seq can be retried", async () => {
    const { deal, meetingId } = await seed();
    const missing = await post(notice(meetingId, "no-such-deal", 5, "linked"));
    expect(missing.status).toBe(422);
    expect(missing.json.code).toBe("entity_not_found");
    expect(activitiesApi.calls).toHaveLength(0);
    expect((await post(notice(meetingId, deal.id, 5, "linked"))).json).toEqual({ applied: true });
  });
});

describe("activities-api cannot answer (AC-1.4)", () => {
  it.each([
    ["is unreachable", () => (activitiesApi.down = true)],
    ["is in maintenance (503)", () => (activitiesApi.fail = { mirror: 503 })],
    ["answers 500", () => (activitiesApi.fail = { mirror: 500 })],
    ["rejects the notice (422)", () => (activitiesApi.fail = { mirror: 422 })],
  ])("when it %s the answer is 503 activities_unavailable, so meetings-api keeps the notice and retries", async (_label, setup) => {
    const { deal, meetingId } = await seed();
    setup();
    for (const event of ["linked", "changed", "unlinked", "deleted"] as const) {
      const res = await post(notice(meetingId, deal.id, 1, event));
      expect(res.status).toBe(503);
      expect(res.json.code).toBe("activities_unavailable");
    }

    // The same notice, once it is back, goes through.
    activitiesApi.down = false;
    activitiesApi.fail = {};
    expect((await post(notice(meetingId, deal.id, 1, "linked"))).json).toEqual({ applied: true });
  });

  it("a 401 on the service JWT drops the token and retries once with a fresh one", async () => {
    const { deal, meetingId } = await seed();
    activitiesApi.refuseTokens = 1;
    const res = await post(notice(meetingId, deal.id, 1, "linked"));
    expect(res.json).toEqual({ applied: true });
    expect(activitiesApi.calls).toHaveLength(2);
    expect(activitiesApi.calls[1]!.authorization).not.toBe(activitiesApi.calls[0]!.authorization);
  });

  it("a credential activities-api keeps refusing is a 503, not a loop", async () => {
    const { deal, meetingId } = await seed();
    activitiesApi.refuseTokens = 5;
    const res = await post(notice(meetingId, deal.id, 1, "linked"));
    expect(res.status).toBe(503);
    expect(activitiesApi.calls).toHaveLength(2);
  });
});

describe("a strict body (AC-14.9)", () => {
  it("rejects an extra key at any level with 422", async () => {
    const { deal, meetingId } = await seed();
    const ok = notice(meetingId, deal.id, 1, "linked");
    for (const body of [
      { ...ok, extra: 1 },
      { ...ok, meeting: { ...ok.meeting, agenda: "x" } },
      { ...ok, entity: { ...ok.entity, name: "x" } },
    ]) {
      expect((await post(body)).status).toBe(422);
    }
    expect(activitiesApi.calls).toHaveLength(0);
  });

  it("rejects a malformed notice with 422", async () => {
    const { deal, meetingId } = await seed();
    const ok = notice(meetingId, deal.id, 1, "linked");
    const bad: unknown[] = [
      { ...ok, noticeId: "not-a-uuid" },
      { ...ok, seq: -1 },
      { ...ok, seq: 1.5 },
      { ...ok, event: "renamed" },
      { ...ok, entity: { type: "company", id: deal.id } },
      { ...ok, meeting: { ...ok.meeting, title: null } }, // linked needs a title
      { ...ok, meeting: { ...ok.meeting, startsAt: null } }, // and a start
      { ...ok, meeting: { ...ok.meeting, title: "x".repeat(201) } },
      { ...ok, meeting: { ...ok.meeting, startsAt: "tomorrow" } },
      { ...notice(meetingId, deal.id, 1, "unlinked"), meeting: { id: meetingId, title: "Still here", startsAt: null, creatorId: CREATOR } },
      { ...notice(meetingId, deal.id, 1, "deleted"), meeting: { id: meetingId, title: null, startsAt: STARTS, creatorId: CREATOR } },
      { seq: 1 },
    ];
    for (const body of bad) expect((await post(body)).status).toBe(422);
    expect(activitiesApi.calls).toHaveLength(0);
  });
});
