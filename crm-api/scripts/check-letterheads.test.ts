import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName } from "pdf-lib";
import { bucket, db, memoryStorage, resetWorld } from "../src/test-support/world";
import { runCheck } from "./check-letterheads";

/** specs/20261115-crm-offer-wizard T71 (DD-78): the read-only release audit of the stored letterheads. */
const PROFILE = { legalName: "wellD", addressLines: ["Via Example 1"] };
const A4: [number, number] = [595.28, 841.89];

async function goodPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage(A4).drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
  return doc.save();
}
async function bomb(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage(A4);
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(deflateSync(Buffer.alloc(64 * 1024 * 1024)), { Filter: "FlateDecode" })));
  return doc.save();
}

async function profile(entity: "welld_ch" | "welld_it", bytes: Uint8Array | null | "missing"): Promise<string | null> {
  let key: string | null = null;
  if (bytes !== null) {
    key = `letterheads/${entity}/${crypto.randomUUID()}.pdf`;
    if (bytes !== "missing") bucket.objects.set(key, { bytes, contentType: "application/pdf", sizeBytes: bytes.byteLength });
  }
  await db.entityProfile.create({
    data: { entity, ...PROFILE, updatedBy: "user-admin", ...(key ? { letterheadKey: key, letterheadBy: "user-admin", letterheadAt: new Date() } : {}) },
  });
  return key;
}

function run() {
  const out: string[] = [];
  const err: string[] = [];
  const io = { log: (l: string) => void out.push(l), error: (l: string) => void err.push(l) };
  return { out, err, io, check: () => runCheck({ storage: memoryStorage, io }) };
}

beforeEach(resetWorld);

describe("check-letterheads (DD-78)", () => {
  it("prints one line per profile with its verdict and figures, exits 0 when every stored letterhead is usable", async () => {
    await profile("welld_ch", await goodPdf());
    await profile("welld_it", null);
    const r = run();
    expect(await r.check()).toBe(0);
    expect(r.out).toHaveLength(2);
    expect(r.out[0]).toMatch(/^welld_ch +ok +decodedBytes=\d+ nonImageBytes=\d+ objects=\d+ streams=\d+ imagePixels=\d+$/);
    expect(r.out[1]).toMatch(/^welld_it +none/);
    expect(r.err).toEqual([]);
  });

  it("exits 1 for a refusal, naming the entity and the reason, and still lists every other profile", async () => {
    await profile("welld_ch", await bomb());
    await profile("welld_it", await goodPdf());
    const r = run();
    expect(await r.check()).toBe(1);
    expect(r.out[0]).toMatch(/^welld_ch +REFUSED +decoded_too_large/);
    expect(r.out[1]).toMatch(/^welld_it +ok/);
    expect(r.err.join("\n")).toContain("welld_ch");
  });

  it("exits 1 for a letterhead it cannot read: an offer of that entity could not be generated either", async () => {
    await profile("welld_ch", "missing");
    const r = run();
    expect(await r.check()).toBe(1);
    expect(r.out[0]).toMatch(/^welld_ch +UNREADABLE/);
  });

  it("is read-only and never prints a key, a link or bytes", async () => {
    const goodKey = (await profile("welld_ch", await goodPdf()))!;
    const badKey = (await profile("welld_it", await bomb()))!;
    const before = await db.entityProfile.findMany({ orderBy: { entity: "asc" } });
    const put = spyOn(memoryStorage, "putObject");
    const del = spyOn(memoryStorage, "deleteObject");
    const mint = spyOn(memoryStorage, "mintPresignedGet");
    const r = run();
    await r.check();
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
    put.mockRestore();
    del.mockRestore();
    mint.mockRestore();
    expect(await db.entityProfile.findMany({ orderBy: { entity: "asc" } })).toEqual(before);
    expect(bucket.objects.has(goodKey) && bucket.objects.has(badKey)).toBe(true);
    const printed = [...r.out, ...r.err].join("\n");
    for (const key of [goodKey, badKey]) {
      expect(printed).not.toContain(key);
      expect(printed).not.toContain(key.split("/")[2]!);
    }
    expect(printed).not.toContain("letterheads/");
  });

  it("says so, and exits 0, when no entity has a profile", async () => {
    const r = run();
    expect(await r.check()).toBe(0);
    expect(r.out.join(" ")).toContain("No entity profile");
  });
});
