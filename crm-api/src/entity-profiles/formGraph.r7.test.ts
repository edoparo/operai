import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFArray, PDFDocument } from "pdf-lib";
import { checkLetterhead } from "./letterhead";
import { FORM_GRAPH_LIMITS, boundFormGraph } from "./formGraph";
import { boundPdf } from "./pdfBounds";
import { CATALOG, MIB, PAGES, build, deflateSync, latin, page, stream, type RawObject } from "../test-support/pdfBuild";

/**
 * Security round 7 (specs/20261115-crm-offer-wizard), M-10 and M-11: the walk itself must not be a lever on crm-api. A page may
 * list one content stream many times, and a resource dictionary may name one form many times; neither may cost more than the
 * file's own size says, and neither may end in an exception (an exception is a verdict nobody remembers, so every generate
 * would repeat the cost: security I-11).
 */

const letterheadA4 = readFileSync(new URL("../../../shell/e2e/fixtures/letterhead-a4.pdf", import.meta.url));
const REFUSED = { ok: false, reason: "too_complex" } as const;
/** A hang guard, never a measure: what a walk costs is its `work` (the steps it counted), which is the same on every machine. */
const SMOKE_MS = 5_000;
const verdictOf = async (bytes: Uint8Array) => boundFormGraph(await PDFDocument.load(bytes, { updateMetadata: false }));
const form = (n: number, content: string): RawObject => ({
  header: `${n} 0 obj`,
  body: stream("/Type /XObject /Subtype /Form /BBox [0 0 600 850]", latin(content)),
});
const AXIAL =
  "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 595 842] /Extend [true true] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>";

describe("M-10: a page /Contents array that lists one stream many times", () => {
  /** One stream (object 4), `entries` times in the page's `/Contents` array. */
  const repeated = (entries: number, data: Buffer, filter = ""): Buffer =>
    build([
      CATALOG,
      PAGES,
      {
        header: "3 0 obj",
        body: latin(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents [${"4 0 R ".repeat(entries)}] /Resources << >> >>`),
      },
      { header: "4 0 obj", body: stream(filter, data) },
    ]);
  const spaces = (mib: number) => deflateSync(Buffer.alloc(mib * MIB, 0x20), { level: 9 });

  it("a real letterhead has a handful of content streams at most (what the cap is set against)", async () => {
    const doc = await PDFDocument.load(letterheadA4);
    const contents = doc.getPage(0).node.Contents();
    const count = contents instanceof PDFArray ? contents.size() : 1;
    console.log("content streams on the committed A4 letterhead:", count);
    expect(count * 4).toBeLessThanOrEqual(FORM_GRAPH_LIMITS.maxContentStreams);
  });

  it("refuses 200 entries of a 4 MiB stream (5.7 KB, 1.9 GB before) with a definite verdict, quickly", async () => {
    const bytes = repeated(200, spaces(4), "/Filter /FlateDecode");
    expect(bytes.length).toBeLessThan(10_000);
    const t = performance.now();
    const verdict = await verdictOf(bytes);
    const ms = performance.now() - t;
    console.log("M-10 repro (200 x 4 MiB):", Math.round(ms), "ms, peak RSS MB", Math.round(process.resourceUsage().maxRSS / 1024));
    expect(ms).toBeLessThan(SMOKE_MS);
    // exactly this object: no `fromException`, so letterheadUse remembers the answer instead of recomputing it per generate
    expect(verdict).toEqual(REFUSED);
    expect(await checkLetterhead(bytes)).toEqual(REFUSED);
  });

  it("refuses 100 000 entries without looking at one of them", async () => {
    const t = performance.now();
    expect(await verdictOf(repeated(100_000, latin("0 0 m 1 1 l S")))).toEqual(REFUSED);
    expect(performance.now() - t).toBeLessThan(SMOKE_MS);
  });

  it("accepts 16 entries and refuses 17 (the cap, as a literal)", async () => {
    const small = latin("0 0 m 10 10 l S");
    expect(FORM_GRAPH_LIMITS.maxContentStreams).toBe(16);
    expect((await verdictOf(repeated(16, small))).ok).toBe(true);
    expect(await verdictOf(repeated(17, small))).toEqual(REFUSED);
  });

  it("charges the decoded size once per occurrence: 3 x 3 MiB (9 MiB joined) is refused, 3 x 2 MiB (6 MiB) is not", async () => {
    expect(FORM_GRAPH_LIMITS.maxContentBytes).toBe(8 * MIB);
    expect(await verdictOf(repeated(3, spaces(3), "/Filter /FlateDecode"))).toEqual(REFUSED);
    expect((await verdictOf(repeated(3, spaces(2), "/Filter /FlateDecode"))).ok).toBe(true);
  });

  it("is not an exception that repeats: boundPdf and the walk agree on a file that is within its own bytes", async () => {
    const bytes = repeated(200, spaces(4), "/Filter /FlateDecode");
    expect((await boundPdf(bytes)).ok).toBe(true); // the stream object is counted once there, which is why the walk must charge the repeats
    expect(await verdictOf(bytes)).not.toHaveProperty("fromException");
  });
});

describe("M-11: the most expensive form in scope is computed once, not per unresolved Do", () => {
  /** A page whose resources name ONE empty form `names` times and whose content calls `calls` names that are not there. */
  const fanned = (names: number, calls: number): Buffer => {
    const xobjects = Array.from({ length: names }, (_, i) => `/F${i} 5 0 R`).join(" ");
    const content = Array.from({ length: calls }, (_, i) => `/U${i} Do`).join("\n");
    return build([
      CATALOG,
      PAGES,
      { header: "3 0 obj", body: page(`<< /XObject << ${xobjects} >> >>`) },
      { header: "4 0 obj", body: stream("", latin(content)) },
      form(5, ""),
    ]);
  };
  /** The walk's own verdict, with what it counted: `work` is the steps (FORM_GRAPH_LIMITS.maxWork), not milliseconds. */
  const walked = async (bytes: Buffer) => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const t = performance.now();
    const verdict = boundFormGraph(doc);
    return { verdict, ms: performance.now() - t };
  };
  const workOf = async (bytes: Buffer): Promise<number> => {
    const { verdict } = await walked(bytes);
    if (!verdict.ok) throw new Error("expected the walk to finish");
    return verdict.work;
  };

  it("answers the r7 repro (100 000 names for one form, 1 900 Do of absent names: 36 s before) in a few steps for each name and call", async () => {
    const { verdict, ms } = await walked(fanned(100_000, 1_900));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    console.log("M-11 repro: 100000 names x 1900 absent Do:", verdict.work, "steps,", Math.round(ms), "ms");
    // each name is read once and each call costs a few steps; 1 900 x 100 000 (the 36 s) would be 190 million
    expect(verdict.work).toBeLessThanOrEqual(100_000 + 10 * 1_900 + 1_000);
    expect(verdict.work).toBeLessThan(FORM_GRAPH_LIMITS.maxWork);
    expect(ms).toBeLessThan(SMOKE_MS);
  }, 120_000);

  it("a call costs steps, not steps times names: the same 100 000 names, 1 900 calls more, add a few per call", async () => {
    const none = await workOf(fanned(100_000, 1));
    const many = await workOf(fanned(100_000, 1_900));
    expect(many - none).toBeLessThanOrEqual(10 * 1_900);
  }, 120_000);

  it("is linear: twice the names and twice the calls take at most 2.2 times the steps (not 4)", async () => {
    const small = await workOf(fanned(25_000, 475));
    const large = await workOf(fanned(50_000, 950));
    console.log("M-11 scaling:", small, "steps ->", large, "steps, ratio", (large / small).toFixed(3));
    expect(small).toBeGreaterThan(25_000); // the names are really counted, or the ratio would divide nothing
    expect(large).toBeLessThanOrEqual(2.2 * small);
  }, 120_000);

  it("counts every name of a form once: the same form under 3 000 names is priced as one form, not 3 000", async () => {
    const withNames = (names: number) =>
      build([
        CATALOG,
        PAGES,
        { header: "3 0 obj", body: page(`<< /XObject << ${Array.from({ length: names }, (_, i) => `/F${i} 5 0 R`).join(" ")} >> >>`) },
        { header: "4 0 obj", body: stream("", latin("/Absent Do\n/F0 Do")) },
        form(5, "0 0 m 1 1 l S"),
      ]);
    const one = await verdictOf(withNames(1));
    const many = await verdictOf(withNames(3_000));
    // every figure of the price is the same; only `work` (the names read) differs, by the names
    expect(one.ok && many.ok).toBe(true);
    if (!one.ok || !many.ok) return;
    const { work: workOne, ...priceOne } = one;
    const { work: workMany, ...priceMany } = many;
    expect(priceMany).toEqual(priceOne);
    expect(workMany - workOne).toBeLessThanOrEqual(3_000);
  });

  it("still prices an absent name as the dearest form in scope", async () => {
    const dear: RawObject = {
      header: "6 0 obj",
      body: stream(`/Type /XObject /Subtype /Form /BBox [0 0 600 850] /Resources << /Shading << /S1 ${AXIAL} >> >>`, latin("/S1 sh\n".repeat(150))),
    };
    const bytes = (calls: number) =>
      build([
        CATALOG,
        PAGES,
        { header: "3 0 obj", body: page("<< /XObject << /Cheap 5 0 R /Dear 6 0 R >> >>") },
        { header: "4 0 obj", body: stream("", latin("/Absent Do\n".repeat(calls))) },
        form(5, ""),
        dear,
      ]);
    // one call of the dearest form is 150 x 600 units of the 100 000 budget; two are over it
    expect((await verdictOf(bytes(1))).ok).toBe(true);
    expect(await verdictOf(bytes(2))).toEqual(REFUSED);
  });

  it("a Do whose operand is no name is priced the same way, once", async () => {
    const content = "[1] Do\n".repeat(1_500);
    const bytes = build([
      CATALOG,
      PAGES,
      { header: "3 0 obj", body: page(`<< /XObject << ${Array.from({ length: 50_000 }, (_, i) => `/F${i} 5 0 R`).join(" ")} >> >>`) },
      { header: "4 0 obj", body: stream("", latin(content)) },
      form(5, ""),
    ]);
    const { verdict, ms } = await walked(bytes);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.work).toBeLessThanOrEqual(50_000 + 1_500 + 100); // the names once, the 1 500 operators scanned; the calls are one group's one entry
    expect(ms).toBeLessThan(SMOKE_MS);
  }, 60_000);
});
