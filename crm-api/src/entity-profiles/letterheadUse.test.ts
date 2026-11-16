/**
 * A stored letterhead is used only once checked in this process (specs/20261115-crm-offer-wizard T71, security M-4;
 * DD-75, DD-76; AC-11.4, AC-11.7): the link route and both generate routes answer 409 `letterhead_unusable` for a
 * stored file that fails the check, with a body that depends on entity and reason only; the verdict is remembered per
 * key; confirm stores a copy of the bytes it checked.
 */

import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { bucket, call, db, makeDraftTemplate, memoryStorage, offerBody, readyDealWithProfiles, resetWorld } from "../test-support/world";
import * as isolated from "./isolatedPdfCheck";
import { LETTERHEAD_MEMO_LIMIT, resetLetterheadMemoForTests } from "./letterheadUse";

const A4: [number, number] = [595.28, 841.89];

async function goodPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(A4).drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
  return doc.save();
}

/** One A4 page whose content stream inflates to `mib` MiB from a few KiB. */
async function bomb(mib = 64): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(deflateSync(Buffer.alloc(mib * 1024 * 1024)), { Filter: "FlateDecode" })));
  return doc.save();
}

/** Writes `bytes` straight under a fresh key of the entity's letterhead shape and points the profile at it. */
async function store(bytes: Uint8Array, entity: "welld_ch" | "welld_it" = "welld_ch"): Promise<string> {
  const key = `letterheads/${entity}/${crypto.randomUUID()}.pdf`;
  bucket.objects.set(key, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
  await db.entityProfile.update({ where: { entity }, data: { letterheadKey: key, letterheadBy: "user-admin", letterheadAt: new Date() } });
  return key;
}

const link = (entity = "welld_ch") => call("GET", `/entity-profiles/${entity}/letterhead`, { as: "salesCh" });
const noMatch = { "If-None-Match": "*" };

async function wizardDraft() {
  const { deal } = await readyDealWithProfiles();
  const template = await makeDraftTemplate({ entity: "welld_ch", language: "it" });
  const created = await call("POST", `/deals/${deal.id}/offer-draft`, { body: { templateId: template.id }, headers: noMatch });
  if (created.status !== 201) throw new Error(`draft: ${created.status} ${JSON.stringify(created.json)}`);
  return { dealId: deal.id, draft: created.json };
}
const wizardGenerate = (s: { dealId: string; draft: { version: number } }) =>
  call("POST", `/deals/${s.dealId}/offer-draft/generate`, { ifMatch: s.draft.version });

beforeEach(async () => {
  await resetWorld();
  resetLetterheadMemoForTests();
});

describe("GET /entity-profiles/{entity}/letterhead for a stored letterhead that fails the check (DD-76)", () => {
  it("is 409 letterhead_unusable { entity, reason }, no-store, no link minted and no key in the body", async () => {
    await readyDealWithProfiles();
    const key = await store(await bomb());
    const mint = spyOn(memoryStorage, "mintPresignedGet");
    const res = await link();
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ status: 409, code: "letterhead_unusable", entity: "welld_ch", reason: "decoded_too_large" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mint).not.toHaveBeenCalled();
    expect(JSON.stringify(res.json)).not.toContain(key);
    expect(Object.keys(res.json).sort()).toEqual(["code", "detail", "entity", "instance", "reason", "status", "title", "type"]);
    mint.mockRestore();
  });

  it("answers the same body for any file with the same reason, and names the reason of each refusal", async () => {
    await readyDealWithProfiles();
    await store(await bomb(48));
    const first = (await link()).json;
    await store(await bomb(96));
    expect((await link()).json).toEqual(first);
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    await store(await doc.save());
    expect((await link()).json).toMatchObject({ code: "letterhead_unusable", reason: "not_a4" });
    await store(new TextEncoder().encode("not a pdf"));
    expect((await link()).json).toMatchObject({ reason: "not_pdf" });
  });

  it("logs the entity and the reason only: never the key, a link or the bytes", async () => {
    await readyDealWithProfiles();
    const key = await store(await bomb());
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    await link();
    const logged = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("welld_ch");
    expect(logged).toContain("decoded_too_large");
    expect(logged).not.toContain(key);
    expect(logged).not.toContain(key.split("/")[2]!);
    warn.mockRestore();
    log.mockRestore();
    error.mockRestore();
  });

  it("answers a caller without deal:financials 403 before it reads or reveals anything about the file", async () => {
    await readyDealWithProfiles();
    await store(await bomb());
    for (const as of ["consultant", "outsider"] as const) {
      const res = await call("GET", "/entity-profiles/welld_ch/letterhead", { as });
      expect(res.status).toBe(403);
      expect(res.json.code).not.toBe("letterhead_unusable");
    }
    expect((await call("GET", "/entity-profiles/welld_ch/letterhead", { as: null })).status).toBe(401);
    expect(bucket.reads).toEqual([]);
  });

  it("is still 404 without a letterhead and a link for a usable one", async () => {
    await readyDealWithProfiles();
    expect((await link()).status).toBe(404);
    const key = await store(await goodPdf());
    const res = await link();
    expect(res.status).toBe(200);
    expect(res.json.url).toBe(`http://bucket.test/${key}?signed`);
  });
});

describe("the verdict is remembered per key (DD-76)", () => {
  it("reads and checks a key once: a second link call and a refusal repeat nothing", async () => {
    await readyDealWithProfiles();
    const key = await store(await goodPdf());
    await link();
    await link();
    expect(bucket.reads.filter((k) => k === key)).toHaveLength(1);

    const bad = await store(await bomb());
    expect((await link()).status).toBe(409);
    expect((await link()).status).toBe(409);
    expect(bucket.reads.filter((k) => k === bad)).toHaveLength(1);
  });

  it("does not remember a refusal that came from an exception (security I-11): a good file is not condemned until restart", async () => {
    await readyDealWithProfiles();
    const key = await store(await goodPdf());
    // pdf-lib failing for a reason that is not the file (memory pressure while another request inflates a bomb): the check runs in a
    // child process now, so the exception is what the child reports (`fromException`), simulated at the seam
    const check = spyOn(isolated, "checkLetterheadIsolated").mockResolvedValueOnce({ ok: false, reason: "not_pdf", fromException: true });
    try {
      expect((await link()).json).toMatchObject({ code: "letterhead_unusable", reason: "not_pdf" });
    } finally {
      check.mockRestore();
    }
    expect((await link()).status).toBe(200);
    expect(bucket.reads.filter((k) => k === key)).toHaveLength(2);

    const second = await store(await goodPdf());
    const embed = spyOn(isolated, "checkLetterheadIsolated").mockResolvedValueOnce({ ok: false, reason: "unembeddable", fromException: true });
    try {
      expect((await link()).json).toMatchObject({ code: "letterhead_unusable", reason: "unembeddable" });
    } finally {
      embed.mockRestore();
    }
    expect((await link()).status).toBe(200);
    expect(bucket.reads.filter((k) => k === second)).toHaveLength(2);
  });

  it("a child that cannot answer is a 503 and nothing is remembered: the same file is checked again, and passes", async () => {
    await readyDealWithProfiles();
    const key = await store(await goodPdf());
    const check = spyOn(isolated, "checkLetterheadIsolated").mockRejectedValueOnce(new isolated.PdfCheckUnavailableError());
    try {
      const res = await link();
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ code: "pdf_check_unavailable" });
    } finally {
      check.mockRestore();
    }
    expect((await link()).status).toBe(200);
    expect(bucket.reads.filter((k) => k === key)).toHaveLength(2);
  });

  it("a check killed for time or memory is a verdict (`too_complex`), remembered like a count: the file is not checked again", async () => {
    await readyDealWithProfiles();
    const key = await store(await goodPdf());
    const check = spyOn(isolated, "checkLetterheadIsolated").mockResolvedValueOnce({ ok: false, reason: "too_complex" });
    try {
      expect((await link()).json).toMatchObject({ code: "letterhead_unusable", reason: "too_complex" });
      expect((await link()).json).toMatchObject({ code: "letterhead_unusable", reason: "too_complex" });
      expect(check).toHaveBeenCalledTimes(1);
    } finally {
      check.mockRestore();
    }
    expect(bucket.reads.filter((k) => k === key)).toHaveLength(1);
  });

  it("still remembers a definite verdict of the check: not A4, and a refusal of the bound", async () => {
    await readyDealWithProfiles();
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const letter = await store(await doc.save());
    expect((await link()).json.reason).toBe("not_a4");
    expect((await link()).json.reason).toBe("not_a4");
    expect(bucket.reads.filter((k) => k === letter)).toHaveLength(1);
  });

  it("is seeded by confirm: the key it stored is not read again for its first link (DD-75)", async () => {
    await readyDealWithProfiles();
    const bytes = await goodPdf();
    const started = await call("POST", "/entity-profiles/welld_ch/letterhead");
    const uploadKey: string = started.json.key;
    bucket.objects.set(uploadKey, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
    expect((await call("POST", "/entity-profiles/welld_ch/letterhead/confirm", { body: { key: uploadKey } })).status).toBe(200);
    expect(bucket.reads).toEqual([uploadKey]);
    expect((await link()).status).toBe(200);
    expect(bucket.reads).toEqual([uploadKey]);
  });

  it("checks a new key again, and a concurrent first use reads once", async () => {
    await readyDealWithProfiles();
    const first = await store(await goodPdf());
    await link();
    const second = await store(await bomb());
    expect((await link()).status).toBe(409);
    expect(bucket.reads).toEqual([first, second]);

    const third = await store(await goodPdf());
    const both = await Promise.all([link(), link(), link()]);
    expect(both.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(bucket.reads.filter((k) => k === third)).toHaveLength(1);
  });

  it("does not remember a read that failed: the next call tries again", async () => {
    await readyDealWithProfiles();
    const key = await store(await goodPdf());
    const object = bucket.objects.get(key)!;
    bucket.objects.delete(key);
    const error = spyOn(console, "error").mockImplementation(() => {});
    expect((await link()).status).toBe(500);
    error.mockRestore();
    bucket.objects.set(key, object);
    expect((await link()).status).toBe(200);
  });

  it("holds at most LETTERHEAD_MEMO_LIMIT keys: the oldest is checked again", async () => {
    await readyDealWithProfiles();
    const pdf = await goodPdf();
    const first = await store(pdf);
    await link();
    for (let i = 0; i < LETTERHEAD_MEMO_LIMIT; i++) {
      await store(pdf);
      await link();
    }
    await db.entityProfile.update({ where: { entity: "welld_ch" }, data: { letterheadKey: first } });
    bucket.reads = [];
    await link();
    expect(bucket.reads).toEqual([first]);
  });
});

describe("a stored letterhead that fails the check refuses both generate routes (DD-76, AC-11.4)", () => {
  it("wizard draft generate: 409 before any render, no offer row, no object, the draft kept", async () => {
    const s = await wizardDraft();
    await store(await bomb());
    const objectsBefore = [...bucket.objects.keys()].sort();
    const res = await wizardGenerate(s);
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "letterhead_unusable", entity: "welld_ch", reason: "decoded_too_large" });
    expect(await db.dealOffer.count()).toBe(0);
    expect([...bucket.objects.keys()].sort()).toEqual(objectsBefore);
    expect(await db.offerDraft.count()).toBe(1);
    // the same body as the link route's, apart from the request path
    const { instance: _a, ...generateBody } = res.json;
    const { instance: _b, ...linkBody } = (await link()).json;
    expect(generateBody).toEqual(linkBody);
  });

  it("wizard draft generate with a usable letterhead still makes the offer", async () => {
    const s = await wizardDraft();
    await store(await goodPdf());
    expect((await wizardGenerate(s)).status).toBe(201);
  });

  it("POST /deals/{id}/offers: the same 409, nothing written", async () => {
    const { deal } = await readyDealWithProfiles();
    const request = await offerBody(deal.id, "welld_ch", "Training");
    await store(await bomb());
    const objectsBefore = [...bucket.objects.keys()].sort();
    const res = await call("POST", `/deals/${deal.id}/offers`, { body: request });
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "letterhead_unusable", entity: "welld_ch", reason: "decoded_too_large" });
    expect(await db.dealOffer.count()).toBe(0);
    expect([...bucket.objects.keys()].sort()).toEqual(objectsBefore);
  });

  it("POST /deals/{id}/offers with a usable letterhead still makes the offer", async () => {
    const { deal } = await readyDealWithProfiles();
    const request = await offerBody(deal.id, "welld_ch", "Training");
    await store(await goodPdf());
    expect((await call("POST", `/deals/${deal.id}/offers`, { body: request })).status).toBe(201);
  });
});

describe("OpenAPI documents the 409 and the new confirm reasons (DD-76)", () => {
  it("lists letterhead_unusable on the link route and both generate routes, and the bounds reasons on confirm", async () => {
    const doc = (await call("GET", "/openapi.json", { as: null })).json;
    const paths = doc.paths;
    for (const [path, method] of [
      ["/entity-profiles/{entity}/letterhead", "get"],
      ["/deals/{id}/offer-draft/generate", "post"],
      ["/deals/{id}/offers", "post"],
    ] as const) {
      expect(paths[path][method].responses["409"].description).toContain("letterhead_unusable");
    }
    const confirm: string = paths["/entity-profiles/{entity}/letterhead/confirm"].post.responses["422"].description;
    for (const reason of ["not_pdf", "page_count", "not_a4", "unembeddable", "too_large", "too_complex", "decoded_too_large", "image_too_large", "unbounded_stream"]) {
      expect(confirm).toContain(reason);
    }
    expect(JSON.stringify(paths["/entity-profiles/{entity}/letterhead"].get.responses["409"])).toContain("reason");
  });
});
