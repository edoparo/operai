/**
 * The letterhead upload is retired with the switch (specs/20261116-letterhead-service T30; AC-10.11): the routes that start,
 * confirm or read an upload answer 410 `letterhead_upload_retired`, `letterhead_unusable` cannot be answered, and nothing
 * reads or writes the bucket. Until the switch the routes are what they were.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { bucket, call, db, putEntityProfile, resetWorld } from "../test-support/world";
import { env } from "../lib/env";

const switchWas = env.LETTERHEAD_SERVICE_ENABLED;

beforeEach(async () => {
  await resetWorld();
  await putEntityProfile("welld_ch");
  await putEntityProfile("welld_it");
});
afterEach(() => {
  env.LETTERHEAD_SERVICE_ENABLED = switchWas;
});

async function onePageA4(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
  return doc.save();
}

const UPLOAD_KEY = () => `letterheads/welld_ch/${crypto.randomUUID()}.pdf`;

describe("with the switch on", () => {
  beforeEach(() => {
    env.LETTERHEAD_SERVICE_ENABLED = true;
  });

  it("answers 410 letterhead_upload_retired to the start, the confirm and the read, and says it is not to be cached", async () => {
    const key = UPLOAD_KEY();
    const bytes = await onePageA4();
    bucket.objects.set(key, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
    const before = { objects: [...bucket.objects.keys()], deleted: [...bucket.deleted] };

    const calls = [
      await call("POST", "/entity-profiles/welld_ch/letterhead"),
      await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { body: { key } }),
      await call("GET", "/entity-profiles/welld_ch/letterhead"),
    ];
    for (const res of calls) {
      expect(res.status).toBe(410);
      expect(res.json).toMatchObject({ status: 410, code: "letterhead_upload_retired" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    // nothing was read, minted, written or deleted, and the profile is as it was
    expect(bucket.reads).toEqual([]);
    expect([...bucket.objects.keys()]).toEqual(before.objects);
    expect(bucket.deleted).toEqual(before.deleted);
    expect(await db.entityProfile.findUniqueOrThrow({ where: { entity: "welld_ch" } })).toMatchObject({ letterheadKey: null, letterheadBy: null, letterheadAt: null });
  });

  it("answers 410 before the body is read: a malformed or missing confirm body is 410 too, not 422", async () => {
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { body: { nope: 1 } })).status).toBe(410);
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead/confirm")).status).toBe(410);
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { body: { key: "offers/x/y.pdf" } })).status).toBe(410);
  });

  it("never answers letterhead_unusable: a stored letterhead that fails the check, or is gone, is 410 on the read", async () => {
    const key = UPLOAD_KEY();
    bucket.objects.set(key, { bytes: new TextEncoder().encode("not a pdf"), contentType: "application/pdf", sizeBytes: 9 });
    await db.entityProfile.update({ where: { entity: "welld_ch" }, data: { letterheadKey: key, letterheadBy: "user-admin", letterheadAt: new Date() } });
    for (const as of ["admin", "salesCh"] as const) {
      const res = await call("GET", "/entity-profiles/welld_ch/letterhead", { as });
      expect(res.status).toBe(410);
      expect(res.json.code).toBe("letterhead_upload_retired");
    }
    bucket.objects.delete(key);
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead")).status).toBe(410);
    expect(bucket.reads).toEqual([]);
  });

  it("is behind the guards: 401 without a token, 403 without the capability, never a 410 to someone who may not use the route", async () => {
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead", { as: null })).status).toBe(401);
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead", { as: null })).status).toBe(401);
    // `consultant` holds crm:access only: no deal:manage, no deal:financials
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead", { as: "consultant" })).status).toBe(403);
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { as: "consultant", body: { key: UPLOAD_KEY() } })).status).toBe(403);
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead", { as: "consultant" })).status).toBe(403);
  });

  it("leaves the offer details alone: the profile is still listed and saved", async () => {
    expect((await call("GET", "/entity-profiles")).status).toBe(200);
    const put = await call("PUT", "/entity-profiles/welld_ch", {
      body: { legalName: "wellD SA", addressLines: ["Via Example 1"], vatNumber: null, iban: null, offerTermsEn: null, offerTermsIt: null },
    });
    expect(put.status).toBe(200);
  });

  it("documents the 410 on the three routes", async () => {
    const paths = (await call("GET", "/openapi.json", { as: null })).json.paths;
    for (const [path, method] of [
      ["/entity-profiles/{entity}/letterhead", "post"],
      ["/entity-profiles/{entity}/letterhead/confirm", "post"],
      ["/entity-profiles/{entity}/letterhead", "get"],
    ] as const) {
      expect(paths[path][method].responses["410"].description).toContain("letterhead_upload_retired");
    }
  });
});

describe("with the switch off", () => {
  beforeEach(() => {
    env.LETTERHEAD_SERVICE_ENABLED = false;
  });

  it("the upload works as it always did", async () => {
    const started = await call("POST", "/entity-profiles/welld_ch/letterhead");
    expect(started.status).toBe(201);
    const key: string = started.json.key;
    const bytes = await onePageA4();
    bucket.objects.set(key, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
    const confirmed = await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { body: { key } });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.letterhead).not.toBeNull();
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead")).status).toBe(200);
    expect((await call("GET", "/entity-profiles/welld_it/letterhead")).status).toBe(404);
  });

  it("a stored letterhead that fails the check is still 409 letterhead_unusable", async () => {
    const key = UPLOAD_KEY();
    bucket.objects.set(key, { bytes: new TextEncoder().encode("not a pdf"), contentType: "application/pdf", sizeBytes: 9 });
    await db.entityProfile.update({ where: { entity: "welld_ch" }, data: { letterheadKey: key, letterheadBy: "user-admin", letterheadAt: new Date() } });
    const res = await call("GET", "/entity-profiles/welld_ch/letterhead");
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("letterhead_unusable");
  });
});
