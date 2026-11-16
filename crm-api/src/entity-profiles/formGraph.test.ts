import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { checkLetterhead } from "./letterhead";
import { FORM_GRAPH_LIMITS, RENDER_WEIGHTS, boundFormGraph } from "./formGraph";
import { CATALOG, PAGES, build, formFanOutPdf, latin, page, stream, type RawObject } from "../test-support/pdfBuild";

/**
 * Security round 6, M-6 (specs/20261115-crm-offer-wizard): `boundPdf` counts bytes of stream data; the cost of drawing a
 * page is also operators executed. A 1.6 KB letterhead of nested Form XObjects made pdf.js produce 2.49 million
 * operators in 6.6 s at 1.75 GB. The `Do` graph is walked before the letterhead is accepted.
 */

/** A 1 x 1 PNG: what a letterhead's logo costs the reader is its draw, not its size. */
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const letterheadA4 = readFileSync(new URL("../../../shell/e2e/fixtures/letterhead-a4.pdf", import.meta.url));
const verdictOf = async (bytes: Uint8Array) => boundFormGraph(await PDFDocument.load(bytes, { updateMetadata: false }));

/** A page whose content (object 4) is `content`, with the given resources and further objects from 5 on. */
function pageWith(content: string | Buffer, resources: string, ...more: RawObject[]): Buffer {
  const body = typeof content === "string" ? latin(content) : content;
  return build([CATALOG, PAGES, { header: "3 0 obj", body: page(resources) }, { header: "4 0 obj", body: stream("", body) }, ...more]);
}
const form = (n: number, content: string, resources = "") => ({
  header: `${n} 0 obj`,
  body: stream(`/Type /XObject /Subtype /Form /BBox [0 0 600 850] ${resources}`, latin(content)),
});

describe("the figures of real letterheads (what the caps are set against)", () => {
  it("measures the committed A4 letterhead and a pdf-lib page with a logo and text", async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([595.28, 841.89]);
    p.drawText("wellD SA", { x: 40, y: 740, size: 12 });
    p.drawRectangle({ x: 40, y: 700, width: 100, height: 20 });
    // A logo, as a person's letterhead has one: a PNG drawn at the top, a rule, an address block in a smaller size.
    const logo = await doc.embedPng(Buffer.from(TINY_PNG, "base64"));
    p.drawImage(logo, { x: 40, y: 760, width: 120, height: 60 });
    p.drawLine({ start: { x: 40, y: 690 }, end: { x: 555, y: 690 }, thickness: 0.5 });
    for (const [k, line] of ["wellD SA", "Via Example 1", "6900 Lugano", "info@welld.ch"].entries()) p.drawText(line, { x: 40, y: 60 - k * 11, size: 8 });
    const real = [await verdictOf(letterheadA4), await verdictOf(await doc.save()), await verdictOf(await doc.save({ useObjectStreams: false }))];
    console.log("form graph, real letterheads", JSON.stringify(real));
    for (const verdict of real) {
      expect(verdict.ok).toBe(true);
      if (!verdict.ok) continue;
      expect(verdict.depth * 4).toBeLessThanOrEqual(FORM_GRAPH_LIMITS.maxDepth);
      expect(verdict.invocations * 4).toBeLessThan(FORM_GRAPH_LIMITS.maxInvocations);
      expect(verdict.operators * 4).toBeLessThan(FORM_GRAPH_LIMITS.maxOperators);
      // what drawing them costs: a few milliseconds, against a budget of about a second
      expect(verdict.renderCost * 4).toBeLessThan(FORM_GRAPH_LIMITS.maxRenderCost);
    }
    expect(await checkLetterhead(letterheadA4)).toEqual({ ok: true });
  });
});

describe("the r6 fan-out (`forms.pdf`)", () => {
  it("refuses 4 levels of 30 calls (810 000 invocations) as too_complex, here and in the confirm-time check", async () => {
    const bytes = formFanOutPdf(4, 30);
    expect(bytes.length).toBeLessThan(3000);
    expect(await verdictOf(bytes)).toEqual({ ok: false, reason: "too_complex" });
    expect(await checkLetterhead(bytes)).toEqual({ ok: false, reason: "too_complex" });
  });

  it("accepts a modest nesting: 3 levels of 4 calls", async () => {
    expect(await verdictOf(formFanOutPdf(3, 4))).toMatchObject({ ok: true, invocations: 4 + 16 + 64, depth: 3 });
  });
});

describe("the caps", () => {
  it("refuses a nesting deeper than the cap, accepts the cap itself", async () => {
    const chain = (depth: number) => {
      const objs: RawObject[] = [];
      for (let l = 0; l < depth; l++) {
        objs.push(form(5 + l, l === depth - 1 ? "0 0 m 1 1 l S" : "/F Do", l === depth - 1 ? "" : `/Resources << /XObject << /F ${6 + l} 0 R >> >>`));
      }
      return pageWith("/F Do", "<< /XObject << /F 5 0 R >> >>", ...objs);
    };
    expect((await verdictOf(chain(FORM_GRAPH_LIMITS.maxDepth))).ok).toBe(true);
    expect(await verdictOf(chain(FORM_GRAPH_LIMITS.maxDepth + 1))).toEqual({ ok: false, reason: "too_complex" });
    // the cap itself, as a literal: a test that follows the constant follows a cap that is raised
    expect(FORM_GRAPH_LIMITS.maxDepth).toBe(8);
    expect(FORM_GRAPH_LIMITS.maxInvocations).toBe(2_000);
    expect(FORM_GRAPH_LIMITS.maxOperators).toBe(100_000);
    expect(FORM_GRAPH_LIMITS.maxRenderCost).toBe(100_000);
    expect(FORM_GRAPH_LIMITS.maxInlineImagePixels).toBe(4_000_000);
  });

  it("refuses more invocations than the cap, accepts the cap itself", async () => {
    const calls = (n: number) => pageWith("/F Do\n".repeat(n), "<< /XObject << /F 5 0 R >> >>", form(5, "q Q"));
    expect(await verdictOf(calls(FORM_GRAPH_LIMITS.maxInvocations))).toMatchObject({ ok: true, invocations: FORM_GRAPH_LIMITS.maxInvocations });
    expect(await verdictOf(calls(FORM_GRAPH_LIMITS.maxInvocations + 1))).toEqual({ ok: false, reason: "too_complex" });
  });

  it("refuses more expanded operators than the cap: a big form called a few times", async () => {
    const big = "q\nQ\n".repeat(Math.ceil(FORM_GRAPH_LIMITS.maxOperators / 2 / 4));
    const calls = (n: number) => pageWith("/F Do\n".repeat(n), "<< /XObject << /F 5 0 R >> >>", form(5, big));
    expect((await verdictOf(calls(3))).ok).toBe(true);
    expect(await verdictOf(calls(5))).toEqual({ ok: false, reason: "too_complex" });
  });

  it("refuses a flat page of more operators than the cap, with no form at all", async () => {
    const flat = (n: number) => pageWith("q\nQ\n".repeat(n), "<< >>");
    expect((await verdictOf(flat(Math.floor(FORM_GRAPH_LIMITS.maxOperators / 2) - 10))).ok).toBe(true);
    expect(await verdictOf(flat(Math.ceil(FORM_GRAPH_LIMITS.maxOperators / 2) + 10))).toEqual({ ok: false, reason: "too_complex" });
  });
});

describe("what a reader would run that a naive scan misses", () => {
  const fan = (resources: string, content: string, ...more: RawObject[]) => pageWith(content, resources, ...more);
  const heavy = form(5, "q\nQ\n".repeat(Math.ceil(FORM_GRAPH_LIMITS.maxOperators / 2 / 4)));

  it("a form with no /Resources of its own uses its caller's", async () => {
    // F is big, G (no /Resources) calls it 5 times: only resolving /F through the page's resources reaches the cap.
    const bytes = fan("<< /XObject << /F 5 0 R /G 6 0 R >> >>", "/G Do", heavy, form(6, "/F Do\n".repeat(5)));
    expect(await verdictOf(bytes)).toEqual({ ok: false, reason: "too_complex" });
    const once = fan("<< /XObject << /F 5 0 R /G 6 0 R >> >>", "/G Do", heavy, form(6, "/F Do\n"));
    expect((await verdictOf(once)).ok).toBe(true);
  });

  it("names are read through #xx escapes", async () => {
    const bytes = fan("<< /XObject << /F1 5 0 R >> >>", "/F#31 Do\n".repeat(FORM_GRAPH_LIMITS.maxInvocations + 1), form(5, "q Q"));
    expect(await verdictOf(bytes)).toEqual({ ok: false, reason: "too_complex" });
  });

  it("a name split across the content streams of a page still counts", async () => {
    const split = build([
      CATALOG,
      PAGES,
      { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents [4 0 R 5 0 R] /Resources << /XObject << /F 6 0 R >> >> >>") },
      { header: "4 0 obj", body: stream("", latin("/F")) },
      { header: "5 0 obj", body: stream("", latin(`Do\n${"/F Do\n".repeat(FORM_GRAPH_LIMITS.maxInvocations)}`)) },
      form(6, "q Q"),
    ]);
    expect(await verdictOf(split)).toEqual({ ok: false, reason: "too_complex" });
  });

  it("an unresolved Do is charged as the most expensive form in scope", async () => {
    const withMissing = (n: number) => fan("<< /XObject << /F 5 0 R >> >>", "/Nope Do\n".repeat(n), heavy);
    expect((await verdictOf(withMissing(2))).ok).toBe(true);
    expect(await verdictOf(withMissing(20))).toEqual({ ok: false, reason: "too_complex" });
    // a Do whose operand is not a name is the same
    const unnamed = fan("<< /XObject << /F 5 0 R >> >>", "1 Do\n".repeat(20), heavy);
    expect(await verdictOf(unnamed)).toEqual({ ok: false, reason: "too_complex" });
  });

  it("a form that calls itself, directly or through another, is refused", async () => {
    const direct = fan("<< /XObject << /F 5 0 R >> >>", "/F Do", form(5, "/F Do", "/Resources << /XObject << /F 5 0 R >> >>"));
    expect(await verdictOf(direct)).toEqual({ ok: false, reason: "too_complex" });
    const indirect = fan(
      "<< /XObject << /A 5 0 R >> >>",
      "/A Do",
      form(5, "/B Do", "/Resources << /XObject << /B 6 0 R >> >>"),
      form(6, "/A Do", "/Resources << /XObject << /A 5 0 R >> >>"),
    );
    expect(await verdictOf(indirect)).toEqual({ ok: false, reason: "too_complex" });
  });

  it("a soft-mask group runs a form on every `gs`: counted like a Do", async () => {
    const resources = "<< /ExtGState << /M << /Type /ExtGState /SMask << /Type /Mask /S /Alpha /G 5 0 R >> >> >> >>";
    const calls = (n: number) => fan(resources, "/M gs\n".repeat(n), form(5, "0 0 m 1 1 l S"));
    expect((await verdictOf(calls(10))).ok).toBe(true);
    expect(await verdictOf(calls(FORM_GRAPH_LIMITS.maxInvocations + 1))).toEqual({ ok: false, reason: "too_complex" });
  });

  it("a Type 3 font runs glyph procedures per glyph: refused outright in a letterhead", async () => {
    const font = "<< /Font << /T3 << /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [1 0 0 1 0 0] /CharProcs << >> /Encoding << /Type /Encoding /Differences [] >> /FirstChar 0 /LastChar 0 /Widths [0] >> >> >>";
    expect(await verdictOf(fan(font, "BT /T3 12 Tf (a) Tj ET"))).toEqual({ ok: false, reason: "too_complex" });
  });

  it("does not count Do and gs written inside strings, comments, hex strings, or an inline image's data", async () => {
    const noise =
      ["(/F Do /F Do /M gs)", "% /F Do /F Do\n", "<2f4620446f>"].join("\n").repeat(20_000) +
      "\nBI /W 1 /H 1 /CS /G /BPC 8 ID \u0000 /F Do \n/F Do EI";
    const bytes = pageWith(noise, "<< /XObject << /F 5 0 R >> >>", form(5, "q Q"));
    expect((await verdictOf(bytes)).ok).toBe(true);
  });

  it("counts a Do after an inline image, and an operator written without spaces around brackets", async () => {
    const after = "BI /W 1 /H 1 /CS /G /BPC 8 ID x EI\n" + "/F Do\n".repeat(FORM_GRAPH_LIMITS.maxInvocations + 1);
    expect(await verdictOf(pageWith(after, "<< /XObject << /F 5 0 R >> >>", form(5, "q Q")))).toEqual({ ok: false, reason: "too_complex" });
    const tight = "[/F]TJ<<>>BDC".concat("/F Do".repeat(1)) + "q/F Do\n".repeat(FORM_GRAPH_LIMITS.maxInvocations + 1);
    expect(await verdictOf(pageWith(tight, "<< /XObject << /F 5 0 R >> >>", form(5, "q Q")))).toEqual({ ok: false, reason: "too_complex" });
  });

  it("fails closed when the page has contents this walk cannot read (it never counts them as nothing)", async () => {
    const odd = build([
      CATALOG,
      PAGES,
      { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 42 /Resources << >> >>") },
    ]);
    expect(await verdictOf(odd)).toMatchObject({ ok: false, reason: "too_complex" });
    const none = build([CATALOG, PAGES, { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>") }]);
    expect((await verdictOf(none)).ok).toBe(true);
  });

  it("walks a compressed content stream the way the page's reader does", async () => {
    const z = (s: string) => deflateSync(latin(s));
    const bytes = build([
      CATALOG,
      PAGES,
      { header: "3 0 obj", body: page("<< /XObject << /F 5 0 R >> >>") },
      { header: "4 0 obj", body: stream("/Filter /FlateDecode", z("/F Do\n".repeat(FORM_GRAPH_LIMITS.maxInvocations + 1))) },
      form(5, "q Q"),
    ]);
    expect(await verdictOf(bytes)).toEqual({ ok: false, reason: "too_complex" });
  });
});

/**
 * D23 (QE round 5): a one-page A4 letterhead of 1.2 to 16 KB passed every bound and froze the viewer's tab: `/S1 sh`
 * repeated 100 / 1 000 / 10 000 times drew in pdf.js in 0.7 / 5 / 50 s as ONE main-thread task, so the 10 s budget of
 * the preview could not fire. The decoded-size bound does not bound the work of drawing.
 *
 * Each case below is the largest count the budget accepts and a count that it refuses, as LITERALS (a test that derives
 * them from the weights would follow a weight that drifts), with the time pdf.js 6.4.299 took for the accepted one in
 * Chromium at 1600 px (2026-11-15, headless software raster, `renderLetterhead`'s own options; the figure per operator
 * is in the header of RENDER_WEIGHTS).
 */
const AXIAL =
  "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 595 842] /Extend [true true] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>";
const GRAY_IMAGE = (n: number): RawObject => ({
  header: `${n} 0 obj`,
  body: stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8", latin("abcd")),
});
const MASK_GROUP = (n: number): RawObject => form(n, "0.5 g 0 0 600 850 re f", "/Group << /S /Transparency /CS /DeviceGray >>");
const PAGE_FILL = "0 0 595 842 re f\n";
const SOFT_MASK = "<< /ExtGState << /G1 << /SMask << /Type /Mask /S /Luminosity /G 5 0 R >> >> >> >>";
const gradientPattern = `<< /Pattern << /P1 << /PatternType 2 /Shading ${AXIAL} >> >> >>`;
const tilingCell = (n: number, content = "1 0 0 rg 0 0 4 4 re f"): RawObject => ({
  header: `${n} 0 obj`,
  body: stream("/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>", latin(content)),
});
const REFUSED = { ok: false, reason: "too_complex" } as const;

interface RenderCase {
  readonly name: string;
  readonly build: (n: number) => Buffer;
  /** Accepted by the budget, and drawn in pdf.js in about this long. */
  readonly ok: number;
  readonly drawn: string;
  /** Refused. */
  readonly refused: number;
}

const renderCases: readonly RenderCase[] = [
  { name: "sh (axial shading, QE sh*.pdf)", build: (n) => pageWith("/S1 sh\n".repeat(n), `<< /Shading << /S1 ${AXIAL} >> >>`), ok: 160, drawn: "0.85 s", refused: 170 },
  {
    name: "an image, drawn page-sized",
    build: (n) => pageWith("q 595 0 0 842 0 0 cm /Im Do Q\n".repeat(n), "<< /XObject << /Im 5 0 R >> >>", GRAY_IMAGE(5)),
    ok: 160,
    drawn: "0.9 s",
    refused: 170,
  },
  {
    name: "an inline image, drawn page-sized",
    build: (n) => pageWith("q 595 0 0 842 0 0 cm BI /W 2 /H 2 /CS /G /BPC 8 ID abcd EI Q\n".repeat(n), "<< >>"),
    ok: 160,
    drawn: "0.3 s",
    refused: 170,
  },
  {
    name: "a soft mask set by gs (25 to 30 ms and 24 MB each)",
    build: (n) => pageWith("/G1 gs\n".repeat(n), SOFT_MASK, MASK_GROUP(5)),
    ok: 15,
    drawn: "0.45 s, 390 MB",
    refused: 20,
  },
  {
    name: "paints with a gradient pattern set",
    build: (n) => pageWith("/Pattern cs /P1 scn\n" + PAGE_FILL.repeat(n), gradientPattern),
    ok: 160,
    drawn: "0.9 s",
    refused: 170,
  },
  {
    name: "paints with a tiling pattern set (its cell drawn again at each, 6.5 ms)",
    build: (n) => pageWith("/Pattern cs /P1 scn\n" + PAGE_FILL.repeat(n), "<< /Pattern << /P1 5 0 R >> >>", tilingCell(5)),
    ok: 130,
    drawn: "0.85 s",
    refused: 145,
  },
  { name: "page-sized fills", build: (n) => pageWith(PAGE_FILL.repeat(n), "<< >>"), ok: 3000, drawn: "0.8 s", refused: 3300 },
  {
    name: "page-sized fills under a Luminosity blend (7.5 ms each)",
    build: (n) => pageWith("/G1 gs\n" + PAGE_FILL.repeat(n), "<< /ExtGState << /G1 << /BM /Luminosity >> >> >>"),
    ok: 100,
    drawn: "0.75 s",
    refused: 115,
  },
  {
    name: "images under a Multiply blend (9 ms each)",
    build: (n) =>
      pageWith("/G1 gs\n" + "q 595 0 0 842 0 0 cm /Im Do Q\n".repeat(n), "<< /XObject << /Im 5 0 R >> /ExtGState << /G1 << /BM /Multiply >> >> >>", GRAY_IMAGE(5)),
    ok: 100,
    drawn: "0.9 s",
    refused: 110,
  },
  {
    name: "page-sized fills under a soft mask (5 ms each)",
    build: (n) => pageWith("/G1 gs\n" + PAGE_FILL.repeat(n), SOFT_MASK, MASK_GROUP(5)),
    ok: 170,
    drawn: "0.9 s",
    refused: 195,
  },
  {
    name: "forms run under alpha (drawn as groups, 2.5 ms each)",
    build: (n) => pageWith("/G1 gs\n" + "/F Do\n".repeat(n), "<< /XObject << /F 5 0 R >> /ExtGState << /G1 << /ca 0.5 >> >> >>", form(5, "0.5 g 0 0 10 10 re f")),
    ok: 320,
    drawn: "0.8 s",
    refused: 370,
  },
];

describe("D23: the render cost of a letterhead is bounded, not only its bytes", () => {
  it.each(renderCases)("$name: $ok pass ($drawn), $refused are refused", async ({ build: make, ok, refused }) => {
    expect((await verdictOf(make(ok))).ok).toBe(true);
    expect(await verdictOf(make(refused))).toEqual(REFUSED);
  });

  it("refuses the QE probes sh1000 and sh10000 (5 s and 50 s in pdf.js) end to end, and accepts sh100 (0.6 s)", async () => {
    const probe = (n: number) => pageWith("/S1 sh\n".repeat(n), `<< /Shading << /S1 ${AXIAL} >> >>`);
    expect(await checkLetterhead(probe(100))).toEqual({ ok: true });
    for (const n of [1_000, 10_000]) {
      const bytes = probe(n);
      expect(bytes.length).toBeLessThan(80_000);
      expect(await checkLetterhead(bytes)).toEqual(REFUSED);
    }
  });

  it("refuses the QE probe shgs10000 (Multiply, ca 0.5: 70 s) and accepts shgs100 (0.7 s)", async () => {
    const resources = `<< /Shading << /S1 ${AXIAL} >> /ExtGState << /G1 << /ca 0.5 /CA 0.5 /BM /Multiply >> >> >>`;
    expect((await verdictOf(pageWith("/G1 gs\n" + "/S1 sh\n".repeat(100), resources))).ok).toBe(true);
    expect(await verdictOf(pageWith("/G1 gs\n" + "/S1 sh\n".repeat(10_000), resources))).toEqual(REFUSED);
  });

  it("the graphics state a form is CALLED under makes it dearer: a form of fills is cheap alone and refused under a soft mask", async () => {
    const fills = form(6, PAGE_FILL.repeat(190));
    const resources = "<< /XObject << /F 6 0 R >> /ExtGState << /G1 << /SMask << /Type /Mask /S /Luminosity /G 5 0 R >> >> >> >>";
    expect((await verdictOf(pageWith("/F Do", resources, MASK_GROUP(5), fills))).ok).toBe(true);
    expect(await verdictOf(pageWith("/G1 gs /F Do", resources, MASK_GROUP(5), fills))).toEqual(REFUSED);
    // the same form called both ways is priced for each, never once from the memo
    expect(await verdictOf(pageWith("/F Do /G1 gs /F Do", resources, MASK_GROUP(5), fills))).toEqual(REFUSED);
  });

  it("a Do that cannot be resolved is priced as the dearest form in scope, under the state it is called in", async () => {
    const fills = form(6, PAGE_FILL.repeat(190));
    const resources = "<< /XObject << /F 6 0 R >> /ExtGState << /G1 << /SMask << /Type /Mask /S /Luminosity /G 5 0 R >> >> >> >>";
    expect((await verdictOf(pageWith("/Nope Do", resources, MASK_GROUP(5), fills))).ok).toBe(true);
    expect(await verdictOf(pageWith("/G1 gs /Nope Do", resources, MASK_GROUP(5), fills))).toEqual(REFUSED);
  });

  it("one form reached under two different states is priced under each: the first, cheap, call is not remembered for the second", async () => {
    // A runs F with no state set; B sets a soft mask and then runs F. Neither has /Resources of its own, so both read the page's.
    const fills = form(6, PAGE_FILL.repeat(190));
    const plain = form(7, "/F Do");
    const masked = form(8, "/G1 gs /F Do");
    const resources = "<< /XObject << /A 7 0 R /B 8 0 R /F 6 0 R >> /ExtGState << /G1 << /SMask << /Type /Mask /S /Luminosity /G 5 0 R >> >> >> >>";
    expect((await verdictOf(pageWith("/A Do", resources, MASK_GROUP(5), fills, plain, masked))).ok).toBe(true);
    expect(await verdictOf(pageWith("/A Do /B Do", resources, MASK_GROUP(5), fills, plain, masked))).toEqual(REFUSED);
    expect(await verdictOf(pageWith("/B Do /A Do", resources, MASK_GROUP(5), fills, plain, masked))).toEqual(REFUSED);
  });

  it("text shows are paints: a line of text drawn 3 100 times is refused, 2 800 are not", async () => {
    const lines = (n: number) => pageWith("BT /F1 12 Tf (x) Tj ET\n".repeat(n), "<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>");
    expect((await verdictOf(lines(2_800))).ok).toBe(true);
    expect(await verdictOf(lines(3_100))).toEqual(REFUSED);
  });

  it("a mask group is drawn from a fresh state, not the caller's, and costs its own content", async () => {
    expect(await verdictOf(pageWith("/G1 gs", SOFT_MASK, MASK_GROUP(5)))).toMatchObject({ ok: true, invocations: 1 });
    const heavyGroup = form(5, PAGE_FILL.repeat(3_500), "/Group << /S /Transparency /CS /DeviceGray >>");
    expect(await verdictOf(pageWith("/G1 gs", SOFT_MASK, heavyGroup))).toEqual(REFUSED);
  });

  describe("a tiling pattern's cell is drawn again at EVERY paint made with it (20 sh in a cell: 25 ms a fill)", () => {
    const cellOfShadings = (shadings: number): RawObject => ({
      header: "5 0 obj",
      body: stream(
        `/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 300 300] /XStep 300 /YStep 300 /Resources << /Shading << /S1 ${AXIAL} >> >>`,
        latin("/S1 sh\n".repeat(shadings)),
      ),
    });
    const withCell = (content: string, cell: RawObject) => pageWith(content, "<< /Pattern << /P1 5 0 R >> >>", cell);

    it("charges the whole cell to each paint: the cell once is cheap, and so are 6 paints; 9 are not", async () => {
      const fills = (n: number) => withCell("/Pattern cs /P1 scn\n" + PAGE_FILL.repeat(n), cellOfShadings(20));
      expect((await verdictOf(fills(1))).ok).toBe(true);
      expect((await verdictOf(fills(6))).ok).toBe(true);
      expect(await verdictOf(fills(9))).toEqual(REFUSED);
    });

    it("prices the tile canvas each paint allocates: 136 fills with a 1 100 pt step held 4.8 GB in Chromium, so 10 are enough", async () => {
      const bigStep = (step: string, extra = ""): RawObject => ({
        header: "5 0 obj",
        body: stream(`/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] ${step} ${extra} /Resources << >>`, latin("1 0 0 rg 0 0 4 4 re f")),
      });
      const fills = (n: number, cell: RawObject, resources = "<< /Pattern << /P1 5 0 R >> >>") => pageWith("/Pattern cs /P1 scn\n" + PAGE_FILL.repeat(n), resources, cell);
      expect((await verdictOf(fills(9, bigStep("/XStep 1100 /YStep 1100")))).ok).toBe(true);
      expect(await verdictOf(fills(12, bigStep("/XStep 1100 /YStep 1100")))).toEqual(REFUSED);
      // a step of 8 pt is a tile of 22 px; the Matrix scales it, and a missing or zero step is read as the largest tile
      expect((await verdictOf(fills(130, bigStep("/XStep 8 /YStep 8")))).ok).toBe(true);
      expect(await verdictOf(fills(40, bigStep("/XStep 8 /YStep 8", "/Matrix [100 0 0 100 0 0]")))).toEqual(REFUSED);
      expect(await verdictOf(fills(40, bigStep("/YStep 8")))).toEqual(REFUSED);
      expect(await verdictOf(fills(40, bigStep("/XStep 0 /YStep 0")))).toEqual(REFUSED);
    });

    it("a pattern used inside a form is scaled by whatever led to the form, so it is priced as the largest tile", async () => {
      const cell: RawObject = {
        header: "5 0 obj",
        body: stream("/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>", latin("1 0 0 rg 0 0 4 4 re f")),
      };
      const inForm = (n: number) => form(6, "/Pattern cs /P1 scn\n" + PAGE_FILL.repeat(n), "/Resources << /Pattern << /P1 5 0 R >> >>");
      const call = (n: number) => pageWith("/F Do", "<< /XObject << /F 6 0 R >> >>", cell, inForm(n));
      expect((await verdictOf(call(9))).ok).toBe(true);
      expect(await verdictOf(call(12))).toEqual(REFUSED);
    });

    it("a pattern that is set and never painted with costs nothing, whichever operator sets it, fill or stroke", async () => {
      for (const set of ["/Pattern cs /P1 scn", "/Pattern CS /P1 SCN", "/P1 sc", "/P1 SC"]) {
        expect((await verdictOf(withCell(set, cellOfShadings(150)))).ok).toBe(true);
      }
    });

    it("a stroke paints with the stroke pattern and a fill with the fill pattern, and either charges the cell", async () => {
      const strokes = (n: number) => withCell("/Pattern CS /P1 SCN\n" + "0 0 m 9 9 l S\n".repeat(n), cellOfShadings(20));
      expect((await verdictOf(strokes(6))).ok).toBe(true);
      expect(await verdictOf(strokes(9))).toEqual(REFUSED);
    });

    it("the cell of a form's paints is charged too: a form called with a pattern set draws it again at each of its paints", async () => {
      const fills = form(6, PAGE_FILL.repeat(8));
      const resources = "<< /XObject << /F 6 0 R >> /Pattern << /P1 5 0 R >> >>";
      expect((await verdictOf(pageWith("/F Do", resources, cellOfShadings(20), fills))).ok).toBe(true);
      expect(await verdictOf(pageWith("/Pattern cs /P1 scn /F Do", resources, cellOfShadings(20), fills))).toEqual(REFUSED);
    });

    describe("two patterns, one form: the dearest cell counts, and a form reached under a cell is priced for that cell", () => {
      const cheap: RawObject = {
        header: "5 0 obj",
        body: stream("/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << >>", latin("1 0 0 rg 0 0 4 4 re f")),
      };
      const heavy: RawObject = {
        header: "6 0 obj",
        body: stream(
          `/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << /Shading << /S1 ${AXIAL} >> >>`,
          latin("/S1 sh\n".repeat(20)),
        ),
      };
      const fills = form(7, PAGE_FILL.repeat(8));
      const resources = "<< /XObject << /F 7 0 R >> /Pattern << /P1 5 0 R /P2 6 0 R >> >>";
      const draw = (content: string) => pageWith(content, resources, cheap, heavy, fills);

      it("a form called once under a cheap cell and once under a dear one is priced under each", async () => {
        expect((await verdictOf(draw("q /Pattern cs /P1 scn /F Do Q"))).ok).toBe(true);
        expect(await verdictOf(draw("q /Pattern cs /P2 scn /F Do Q"))).toEqual(REFUSED);
        expect(await verdictOf(draw("q /Pattern cs /P1 scn /F Do Q q /Pattern cs /P2 scn /F Do Q"))).toEqual(REFUSED);
        expect(await verdictOf(draw("q /Pattern cs /P2 scn /F Do Q q /Pattern cs /P1 scn /F Do Q"))).toEqual(REFUSED);
      });

      it("a fill pattern and a stroke pattern set together charge the dearer cell, whichever is which", async () => {
        const paint = PAGE_FILL.repeat(8);
        expect((await verdictOf(draw("/Pattern cs /P1 scn /Pattern CS /P1 SCN " + paint))).ok).toBe(true);
        expect(await verdictOf(draw("/Pattern cs /P1 scn /Pattern CS /P2 SCN " + paint))).toEqual(REFUSED);
        expect(await verdictOf(draw("/Pattern cs /P2 scn /Pattern CS /P1 SCN " + paint))).toEqual(REFUSED);
      });
    });

    it("counts what the cell does at each paint in the figures too: its operators and the forms it calls", async () => {
      const cell: RawObject = {
        header: "5 0 obj",
        body: stream("/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << /XObject << /F 6 0 R >> >>", latin("/F Do\n".repeat(100))),
      };
      const painted = (n: number) => pageWith("/Pattern cs /P1 scn\n" + "0 0 5 5 re f\n".repeat(n), "<< /Pattern << /P1 5 0 R >> >>", cell, form(6, "q Q"));
      // 100 calls to a form of 2 operators, per paint: 15 paints are 1 500 invocations, 25 are 2 500 (the cap is 2 000)
      expect(await verdictOf(painted(15))).toMatchObject({ ok: true, invocations: 15 * 100, operators: 2 + 15 * 2 + 15 * (100 + 100 * 2) });
      expect(await verdictOf(painted(25))).toEqual(REFUSED);
    });

    it("a cell that reaches its own pattern is refused, and a cell's nesting is counted", async () => {
      const selfish: RawObject = {
        header: "5 0 obj",
        body: stream("/PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 8 8] /XStep 8 /YStep 8 /Resources << /Pattern << /P1 5 0 R >> >>", latin("/Pattern cs /P1 scn 0 0 4 4 re f")),
      };
      expect(await verdictOf(withCell("/Pattern cs /P1 scn 0 0 5 5 re f", selfish))).toEqual(REFUSED);
    });
  });

  describe("the graphics state is read in order: q and Q scope it, a colour set replaces a pattern", () => {
    const gradient = (content: string) => pageWith(content, gradientPattern);
    const maskResources = SOFT_MASK;

    it("a state set inside q ... Q is not on after Q: 3 000 fills priced plain outside, refused inside", async () => {
      const inside = pageWith("q /G1 gs\n" + PAGE_FILL.repeat(2_800) + "Q", maskResources, MASK_GROUP(5));
      const outside = pageWith("q /G1 gs Q\n" + PAGE_FILL.repeat(2_800), maskResources, MASK_GROUP(5));
      expect(await verdictOf(inside)).toEqual(REFUSED);
      expect((await verdictOf(outside)).ok).toBe(true);
    });

    it("a state set before the fills is on for them, and one set after them is not", async () => {
      expect((await verdictOf(pageWith(PAGE_FILL.repeat(2_800) + "/G1 gs", maskResources, MASK_GROUP(5)))).ok).toBe(true);
      expect(await verdictOf(pageWith("/G1 gs " + PAGE_FILL.repeat(2_800), maskResources, MASK_GROUP(5)))).toEqual(REFUSED);
    });

    it("an unbalanced Q is ignored, and a nested q ... Q leaves the state of the scope it is in", async () => {
      expect((await verdictOf(pageWith("Q Q Q " + PAGE_FILL.repeat(2_800), maskResources, MASK_GROUP(5)))).ok).toBe(true);
      expect((await verdictOf(pageWith("q q /G1 gs Q Q " + PAGE_FILL.repeat(2_800), maskResources, MASK_GROUP(5)))).ok).toBe(true);
      expect(await verdictOf(pageWith("q /G1 gs q Q " + PAGE_FILL.repeat(2_800), maskResources, MASK_GROUP(5)))).toEqual(REFUSED);
    });

    it("a fill colour replaces the pattern, a stroke colour the stroke pattern, and a gs name stays until Q", async () => {
      const fills = PAGE_FILL.repeat(400);
      const set = "/Pattern cs /P1 scn\n";
      expect(await verdictOf(gradient(set + fills))).toEqual(REFUSED);
      for (const reset of ["0.2 g", "1 0 0 rg", "0 0 0 1 k", "/DeviceRGB cs", "0.1 0.2 0.3 scn", "0.1 sc"]) {
        expect((await verdictOf(gradient(set + reset + "\n" + fills))).ok).toBe(true);
      }
      // a stroke colour is not a fill colour
      expect(await verdictOf(gradient(set + "0 G\n" + fills))).toEqual(REFUSED);
      const stroked = "/Pattern CS /P1 SCN\n" + "0 0 m 9 9 l S\n".repeat(400);
      expect(await verdictOf(gradient(stroked))).toEqual(REFUSED);
      for (const reset of ["0.2 G", "1 0 0 RG", "0 0 0 1 K", "/DeviceRGB CS", "0.1 0.2 0.3 SCN"]) {
        expect((await verdictOf(gradient("/Pattern CS /P1 SCN\n" + reset + "\n" + "0 0 m 9 9 l S\n".repeat(400)))).ok).toBe(true);
      }
    });

    it("what a form is called with follows the state at the call: a gradient set before the Do is on for the form, after it not", async () => {
      const fills = form(6, PAGE_FILL.repeat(300));
      const resources = `<< /XObject << /F 6 0 R >> /Pattern << /P1 << /PatternType 2 /Shading ${AXIAL} >> >> >>`;
      expect(await verdictOf(pageWith("/Pattern cs /P1 scn /F Do", resources, fills))).toEqual(REFUSED);
      expect((await verdictOf(pageWith("/F Do /Pattern cs /P1 scn", resources, fills))).ok).toBe(true);
    });

    it("keeps no more states than a letterhead has: 64 names in a scope and 1 024 states, and a hostile stream is refused at once, not after the copies", async () => {
      const names = (n: number) => Array.from({ length: n }, (_, k) => `/g${k} gs`).join(" ");
      expect((await verdictOf(pageWith(names(64) + " 0 0 m 1 1 l S", "<< >>"))).ok).toBe(true);
      expect(await verdictOf(pageWith(names(65) + " 0 0 m 1 1 l S", "<< >>"))).toEqual(REFUSED);
      const states = (n: number) => Array.from({ length: n }, (_, k) => `q /g${k} gs 0 0 m 1 1 l S Q`).join("\n");
      expect((await verdictOf(pageWith(states(1_024), "<< >>"))).ok).toBe(true);
      expect(await verdictOf(pageWith(states(1_025), "<< >>"))).toEqual(REFUSED);
      // 200 000 names in one scope would be 20 billion copies; 300 000 states would be 300 000 groups held in memory
      const started = performance.now();
      expect(await verdictOf(pageWith(names(200_000) + " 0 0 m 1 1 l S", "<< >>"))).toEqual(REFUSED);
      expect(await verdictOf(pageWith(states(300_000), "<< >>"))).toEqual(REFUSED);
      expect(performance.now() - started).toBeLessThan(3_000);
    });

    it("names that look alike are different states: the key of a state is not a join of its names", async () => {
      // the names x and y, and the one name "x,y" (written x#2Cy): joined with a comma they would be one state, a plain one
      const resources = "<< /ExtGState << /x << /LW 1 >> /y << /LW 1 >> /x#2Cy << /SMask << /Type /Mask /S /Luminosity /G 5 0 R >> >> >> >>";
      const content = "q /x gs /y gs 0 0 m 1 1 l S Q q /x#2Cy gs\n" + PAGE_FILL.repeat(2_800) + "Q";
      expect(await verdictOf(pageWith(content, resources, MASK_GROUP(5)))).toEqual(REFUSED);
    });
  });

  it("a PDF from a real producer (macOS Quartz PDFContext, with tiling patterns) is priced at a fraction of a second, not refused", async () => {
    const real = readFileSync(new URL("../../../form_richiesta_rimborso_spese_WellD_A4_compilabile.pdf", import.meta.url));
    const verdict = await verdictOf(real);
    expect(verdict).toMatchObject({ ok: true });
    // it drew in 45 ms in pdf.js (Chromium); the price is 3 to 4 times that, not 60 times (the price once read the state of the whole stream)
    if (verdict.ok) expect(verdict.renderCost).toBeLessThan(25_000);
  });

  it("refuses a pattern the resources do not resolve, accepts a colour set with numbers only", async () => {
    expect(await verdictOf(pageWith("/Pattern cs /Nope scn\n0 0 10 10 re f", "<< >>"))).toEqual(REFUSED);
    expect((await verdictOf(pageWith("/DeviceRGB cs 0.1 0.2 0.3 scn 0 0 10 10 re f /DeviceRGB CS 0 0 1 SCN 5 5 m 9 9 l S", "<< >>"))).ok).toBe(true);
  });

  it("allows only axial and radial shadings: function-based and mesh shadings are drawn per pixel and per triangle", async () => {
    const shading = (type: number, extra = "") => `<< /ShadingType ${type} /ColorSpace /DeviceRGB ${extra} >>`;
    const viaSh = (type: number) => pageWith("/S1 sh", `<< /Shading << /S1 ${shading(type, "/Domain [0 1 0 1]")} >> >>`);
    const viaPattern = (type: number) => pageWith("/Pattern cs /P1 scn 0 0 5 5 re f", `<< /Pattern << /P1 << /PatternType 2 /Shading ${shading(type)} >> >> >>`);
    for (const make of [viaSh, viaPattern]) {
      expect((await verdictOf(make(2))).ok).toBe(true);
      expect((await verdictOf(make(3))).ok).toBe(true);
      for (const type of [1, 4, 5, 6, 7, 0, 9]) expect(await verdictOf(make(type))).toEqual(REFUSED);
    }
    // a mesh shading is a stream: the QE found one `sh` over a 1 000 000 vertex mesh still drawing after 90 s
    const mesh: RawObject = {
      header: "5 0 obj",
      body: stream(
        "/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 16 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 600 0 850 0 1 0 1 0 1]",
        Buffer.from([0, 0, 0, 0, 0, 1, 2, 3]),
      ),
    };
    expect(await verdictOf(pageWith("/S1 sh", "<< /Shading << /S1 5 0 R >> >>", mesh))).toEqual(REFUSED);
  });

  it("an sh whose name the resources do not hold is still charged (a reader that finds it would draw it)", async () => {
    expect((await verdictOf(pageWith("/Nope sh\n".repeat(160), "<< >>"))).ok).toBe(true);
    expect(await verdictOf(pageWith("/Nope sh\n".repeat(170), "<< >>"))).toEqual(REFUSED);
    expect(await verdictOf(pageWith("1 sh\n".repeat(170), "<< >>"))).toEqual(REFUSED);
  });

  it("a vector logo of 2 000 small paths stays inside the budget, with the price of what it costs reported", async () => {
    const logo = await verdictOf(pageWith("10 10 m 20 12 l 30 40 l 12 30 l h f\n".repeat(2_000), "<< >>"));
    expect(logo).toMatchObject({ ok: true });
    if (logo.ok) {
      expect(logo.renderCost).toBeLessThan(FORM_GRAPH_LIMITS.maxRenderCost);
      expect(logo.renderCost).toBe(2_000 * (6 * RENDER_WEIGHTS.operator + RENDER_WEIGHTS.paint));
    }
  });
});

describe("D23: an allowlist of content operators", () => {
  const usual = [
    "q 1 0 0 1 10 10 cm /DeviceRGB cs 0.1 0.2 0.3 sc 0 0 595 842 re W n 10 10 100 20 re f* Q",
    "BT /F1 12 Tf 1 0 0 1 50 700 Tm 14 TL (wellD SA) Tj T* [(a) -20 (b)] TJ (x) ' 1 2 (y) \" 2 Tr 0 Tc 0 Tw 100 Tz 3 Ts ET",
    "1 w 1 J 1 j 10 M [3] 0 d /Perceptual ri 1 i 0 G 0 g 1 0 0 0 K 0 0 0 1 k 1 0 0 RG 1 0 0 rg 0 0 m 1 1 l 2 2 3 3 4 4 c 5 5 6 6 v 7 7 8 8 y h S s B B* b b* F",
    "/Artifact BMC EMC /OC /MC0 BDC EMC /Span << /MCID 0 >> BDC EMC /X MP /X << >> DP BX EX",
  ];
  const font = "<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>";

  it.each(usual)("accepts the operators of ordinary drawing: %s", async (content) => {
    expect((await verdictOf(pageWith(content, font))).ok).toBe(true);
  });

  it.each(["1 2 bogus", "q Q frobnicate", "d0", "1 0 d1", "0 0 m 1 1 l S EOF", "ABCDEFGH", "1e5 w"])("refuses an operator no reader draws from: %s", async (content) => {
    expect(await verdictOf(pageWith(content, "<< >>"))).toEqual(REFUSED);
  });

  it("refuses an unknown operator inside a form as well", async () => {
    expect(await verdictOf(pageWith("/F Do", "<< /XObject << /F 5 0 R >> >>", form(5, "q zzz Q")))).toEqual(REFUSED);
  });

  it("reads true, false and null as operands, and a token longer than any operator as unknown", async () => {
    expect((await verdictOf(pageWith("[true false null] 3 w", "<< >>"))).ok).toBe(true);
    expect(await verdictOf(pageWith("1 2 3 notanoperatoratall", "<< >>"))).toEqual(REFUSED);
  });
});

describe("D23: inline images", () => {
  const image = (dictionary: string, data = "abcd") => pageWith(`q 10 0 0 10 0 0 cm BI ${dictionary} ID ${data} EI Q`, "<< >>");

  it("accepts a small unfiltered inline image, spelled with abbreviations or full names", async () => {
    expect((await verdictOf(image("/W 2 /H 2 /CS /G /BPC 8"))).ok).toBe(true);
    expect((await verdictOf(image("/Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8"))).ok).toBe(true);
    expect((await verdictOf(image("/W 2 /H 2 /IM true /BPC 1 /D [1 0]"))).ok).toBe(true);
  });

  it("refuses a filtered one, however the filter is spelled: its decoded size is outside boundPdf", async () => {
    for (const dictionary of [
      "/W 2 /H 2 /CS /G /BPC 8 /F /Fl",
      "/W 2 /H 2 /CS /G /BPC 8 /Filter /FlateDecode",
      "/W 2 /H 2 /CS /G /BPC 8 /F [/AHx /Fl]",
      "/W 2 /H 2 /CS /G /BPC 8 /Filter [ /LZW ]",
    ]) {
      expect(await verdictOf(image(dictionary))).toEqual(REFUSED);
    }
  });

  it("refuses one whose size is above the cap, absent, not a number or not positive", async () => {
    expect((await verdictOf(image("/W 2000 /H 2000 /CS /G /BPC 8"))).ok).toBe(true); // 4 000 000 pixels
    for (const dictionary of ["/W 2001 /H 2000 /CS /G /BPC 8", "/W 100000 /H 100000 /CS /G /BPC 1", "/CS /G /BPC 8", "/W 2 /CS /G", "/W /x /H 2", "/W 0 /H 4", "/W -3 /H -3"]) {
      expect(await verdictOf(image(dictionary))).toEqual(REFUSED);
    }
  });

  it("refuses an inline image that never reaches ID, an ID with no BI, and an operator inside the dictionary", async () => {
    expect(await verdictOf(pageWith("BI /W 2 /H 2", "<< >>"))).toEqual(REFUSED);
    expect(await verdictOf(pageWith("ID abcd EI", "<< >>"))).toEqual(REFUSED);
    expect(await verdictOf(pageWith("BI /W 2 /H 2 q ID ab EI", "<< >>"))).toEqual(REFUSED);
    expect(await verdictOf(pageWith("BI BI /W 2 /H 2 ID ab EI", "<< >>"))).toEqual(REFUSED);
  });

  it("charges each inline image as an image", async () => {
    const many = (n: number) => pageWith("BI /W 2 /H 2 /CS /G /BPC 8 ID abcd EI\n".repeat(n), "<< >>");
    expect((await verdictOf(many(160))).ok).toBe(true);
    expect(await verdictOf(many(170))).toEqual(REFUSED);
  });
});

describe("D23: what the graphics state is made of", () => {
  const withState = (gs: string, fills: number) => pageWith("/G1 gs\n" + PAGE_FILL.repeat(fills), `<< /ExtGState << /G1 << ${gs} >> >> >>`);
  const accepted = async (gs: string, fills: number) => (await verdictOf(withState(gs, fills))).ok;

  it("prices a state only when it is dearer than Normal: Normal, Compatible, alpha 1 and a mask of None change nothing", async () => {
    for (const gs of ["/BM /Normal", "/BM /Compatible", "/BM [/Normal]", "/ca 1 /CA 1", "/SMask /None", "/LW 3", "/D [[3] 0]"]) expect(await accepted(gs, 3_000)).toBe(true);
  });

  it("prices any other blend, an unknown blend name and a mask above plain paints; alpha alone does not make a paint dearer", async () => {
    expect(await accepted("/ca 0.5", 3_000)).toBe(true);
    for (const gs of ["/BM /Multiply", "/BM /Hue", "/BM /Luminosity", "/BM /SomethingNew", "/BM [/Normal /Luminosity]", "/BM 7", "/SMask << /Type /Mask /S /Alpha >>"]) {
      expect(await accepted(gs, 3_000)).toBe(false);
    }
  });

  it("alpha below 1 is read from ca and CA, and an alpha that is not a number counts", async () => {
    const forms = (gs: string) =>
      pageWith("/G1 gs\n" + "/F Do\n".repeat(360), `<< /XObject << /F 5 0 R >> /ExtGState << /G1 << ${gs} >> >> >>`, form(5, "0.5 g 0 0 10 10 re f"));
    expect((await verdictOf(forms("/LW 1"))).ok).toBe(true);
    expect((await verdictOf(forms("/ca 1.0 /CA 1"))).ok).toBe(true);
    for (const gs of ["/ca 0.5", "/CA 0.99", "/ca (x)", "/ca /y"]) expect(await verdictOf(forms(gs))).toEqual(REFUSED);
  });
});

describe("D23: annotation appearances are drawn by pdf.js too", () => {
  const page = (annots: string): RawObject => ({
    header: "3 0 obj",
    body: latin(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << >> /Annots [${annots}] >>`),
  });
  const withAnnotation = (annots: string, ...more: RawObject[]): Buffer =>
    build([CATALOG, PAGES, page(annots), { header: "4 0 obj", body: stream("", latin("0 0 m 1 1 l S")) }, ...more]);
  const annotation = (n: number, dictionary: string): RawObject => ({ header: `${n} 0 obj`, body: latin(`<< /Type /Annot /Rect [0 0 595 842] ${dictionary} >>`) });
  const appearance = (n: number, shadings: number) => form(n, "/S1 sh\n".repeat(shadings), `/Resources << /Shading << /S1 ${AXIAL} >> >>`);

  it("walks the normal appearance of a stamp: 200 sh there are refused (1.1 s of drawing the walk used to miss), 50 are not", async () => {
    const stamp = annotation(5, "/Subtype /Stamp /F 4 /AP << /N 6 0 R >>");
    expect((await verdictOf(withAnnotation("5 0 R", stamp, appearance(6, 50)))).ok).toBe(true);
    expect(await verdictOf(withAnnotation("5 0 R", stamp, appearance(6, 200)))).toEqual(REFUSED);
  });

  it("walks every state of an appearance dictionary", async () => {
    const widget = annotation(5, "/Subtype /Widget /AP << /N << /On 6 0 R /Off 7 0 R >> >>");
    expect(await verdictOf(withAnnotation("5 0 R", widget, appearance(6, 50), appearance(7, 150)))).toEqual(REFUSED);
    expect((await verdictOf(withAnnotation("5 0 R", widget, appearance(6, 50), appearance(7, 50)))).ok).toBe(true);
  });

  it("accepts a link with no appearance, and counts an appearance once per annotation that shows it", async () => {
    const link = annotation(5, "/Subtype /Link /Border [0 0 0] /A << /S /URI /URI (https://example.com) >>");
    expect((await verdictOf(withAnnotation("5 0 R", link))).ok).toBe(true);
    const shared = annotation(5, "/Subtype /Stamp /AP << /N 6 0 R >>");
    expect((await verdictOf(withAnnotation("5 0 R", shared, appearance(6, 10)))).ok).toBe(true);
    expect(await verdictOf(withAnnotation("5 0 R ".repeat(40), shared, appearance(6, 10)))).toEqual(REFUSED);
  });
});
