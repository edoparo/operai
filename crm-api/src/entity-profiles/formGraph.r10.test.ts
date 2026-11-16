import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { checkLetterhead } from "./letterhead";
import { FORM_GRAPH_LIMITS, boundFormGraph, type FormGraphLimits } from "./formGraph";
import { CATALOG, PAGES, build, latin, page, stream } from "../test-support/pdfBuild";

/**
 * Security round 10 (specs/20261115-crm-offer-wizard), M-12: `stateOf` walked an ExtGState `/BM` array with no charge and no cap,
 * once per distinct `gs` name, and a dictionary may name ONE ExtGState object under any number of names. A 1.6 MB file (BM of
 * 200 000 names, 3 000 `gs` names for the one object) was `ok` with `work` 12 003 and walked 95 s. The state of an ExtGState is now
 * read once per dictionary per walk, charged for what reading it costs, and an array longer than 16 is refused. Assertions are on
 * verdicts and counted work, never on durations (QE D1).
 */

const REFUSED = { ok: false, reason: "too_complex" } as const;

/** One ExtGState object (5) whose /BM is `bm` times `/Normal`, named `names` times, each called under its own `q … Q`. */
function sharedBlendArray(bm: number, names: number): Buffer {
  const array = Array.from({ length: bm }, () => "/Normal").join(" ");
  const ext = Array.from({ length: names }, (_, i) => `/E${i} 5 0 R`).join(" ");
  const content = Array.from({ length: names }, (_, i) => `q /E${i} gs Q`).join(" ");
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page(`<< /ExtGState << ${ext} >> >>`) },
    { header: "4 0 obj", body: stream("", latin(content)) },
    { header: "5 0 obj", body: latin(`<< /BM [ ${array} ] >>`) },
  ]);
}

const walked = async (bytes: Buffer, over: Partial<FormGraphLimits> = {}) =>
  boundFormGraph(await PDFDocument.load(bytes, { updateMetadata: false }), { ...FORM_GRAPH_LIMITS, ...over });

/** 64 `gs` names of `size` characters in one `q` scope, then a fill that flips between two patterns `flips` times: a key rebuilt per flip. */
function longNamesFlipping(size: number, flips: number): Buffer {
  const names = Array.from({ length: 64 }, (_, i) => `/${String(i).padStart(3, "0")}${"x".repeat(size)}`);
  const content = `q ${names.map((n) => `${n} gs`).join(" ")} ${"/P scn /Q scn ".repeat(flips / 2)} Q`;
  const gradient = "<< /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 1] /Function << /FunctionType 2 /Domain [0 1] /N 1 >> >> >>";
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page("<< /Pattern << /P 5 0 R /Q 5 0 R >> >>") },
    { header: "4 0 obj", body: stream("", latin(content)) },
    { header: "5 0 obj", body: latin(gradient) },
  ]);
}

describe("M-12: the /BM array of an ExtGState is capped and charged once per dictionary", () => {
  it("refuses a /BM array of 20 000 names under 300 gs names, as a verdict", async () => {
    const bytes = sharedBlendArray(20_000, 300);
    expect(await walked(bytes)).toEqual(REFUSED); // not `fromException`: letterheadUse remembers it
    expect(await checkLetterhead(bytes)).toEqual(REFUSED);
  });

  it("refuses an array just over the cap (17) and accepts one at it (16)", async () => {
    expect(await walked(sharedBlendArray(17, 1))).toEqual(REFUSED);
    expect((await walked(sharedBlendArray(16, 1))).ok).toBe(true);
  });

  it("reads one shared ExtGState once: the steps per extra name stay a handful, not the array's length", async () => {
    const few = await walked(sharedBlendArray(16, 100));
    const many = await walked(sharedBlendArray(16, 1_000));
    expect(few.ok && many.ok).toBe(true);
    if (!few.ok || !many.ok) return;
    const perName = (many.work - few.work) / 900;
    expect(perName).toBeLessThan(8); // operator, name, group; the 16-entry array is charged once, not once per name
    expect(many.work).toBeLessThan(FORM_GRAPH_LIMITS.maxWork);
  });

  it("charges the array it reads: a 16-name /BM costs at least 16 steps more than a dictionary without one", async () => {
    const withBm = await walked(sharedBlendArray(16, 1));
    const without = await walked(sharedBlendArray(0, 1));
    expect(withBm.ok && without.ok).toBe(true);
    if (!withBm.ok || !without.ok) return;
    expect(withBm.work - without.work).toBeGreaterThanOrEqual(16);
  });
});

describe("M-12 sweep: the key of a graphics state is charged by its length", () => {
  it("refuses 64 long gs names with a fill that flips 4 000 times, and the steps are what refuses it", async () => {
    const bytes = longNamesFlipping(2_000, 4_000); // a 128 KB key rebuilt per flip: 0.5 GB of copying, 12 000 operators
    const lifted = await walked(bytes, { maxWork: 1_000_000_000 });
    expect(lifted.ok).toBe(true);
    if (!lifted.ok) return;
    expect(lifted.work).toBeGreaterThan(FORM_GRAPH_LIMITS.maxWork);
    expect(await walked(bytes)).toEqual(REFUSED);
  });

  it("even the fullest scope of short names (64, a 1 KB key) costs about 12 steps a flip, far under the cap", async () => {
    const verdict = await walked(longNamesFlipping(5, 2_000));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.work).toBeLessThan(16 * 2_000);
  });
});
