import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { checkLetterhead } from "./letterhead";
import { FORM_GRAPH_LIMITS, boundFormGraph, type FormGraphLimits } from "./formGraph";
import { CATALOG, PAGES, build, latin, page, stream, type RawObject } from "../test-support/pdfBuild";

/**
 * Security rounds 8 and 9 (specs/20261115-crm-offer-wizard), L-10 and L-11: the walk's memo is bounded by streams x distinct graphics
 * states, and a 180 KB file (1 024 state groups x 950 empty forms) held about 0.95 million entries, 450 MB, in 0.8 s. The memo is
 * capped in entries, and the refusal is a verdict (`too_complex`, no `fromException`), so letterheadUse remembers it like any other.
 * The entries cap bounds memory, not time (L-11: what an entry costs is the loop over its stream's groups), so the walk also counts
 * its own steps and refuses above `maxWork`. Both caps are counts: every assertion here is on a count (`work`, entries), never on a
 * duration, which differs between machines and runs (QE D1).
 */

const REFUSED = { ok: false, reason: "too_complex" } as const;
const PATTERNS = 46;
/** A hang guard, never a measure: the refusal is decided by counts, so it is the same on every run and every machine. */
const SMOKE_MS = 5_000;
/** Both of the walk's own ceilings out of the way: what a refused file would have gone on to do. */
const LIFTED = { maxMemoEntries: 10_000_000, maxWork: 1_000_000_000 } as const;

/**
 * A page of `groups` distinct (fill pattern, stroke pattern) pairs, each followed by a `Do` of a name that is not there, over
 * `forms` empty forms: every group is priced against the worst form in scope, so each (state, cell) key is remembered once per form.
 */
function tilingPairs(groups: number, forms: number): Buffer {
  const firstPattern = 5;
  const firstForm = firstPattern + PATTERNS;
  const patternObjects: RawObject[] = Array.from({ length: PATTERNS }, (_, i) => {
    const step = 400 - 4 * i; // a different step is a different tile, so a different price: distinct cells
    return {
      header: `${firstPattern + i} 0 obj`,
      body: stream(
        `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep ${step} /YStep ${step} /Resources << >>`,
        latin("0 0 m ".repeat(i + 1)),
      ),
    };
  });
  const formObjects: RawObject[] = Array.from({ length: forms }, (_, i) => ({
    header: `${firstForm + i} 0 obj`,
    body: stream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", latin("")),
  }));
  const patternNames = Array.from({ length: PATTERNS }, (_, i) => `/P${i} ${firstPattern + i} 0 R`).join(" ");
  const formNames = Array.from({ length: forms }, (_, i) => `/F${i} ${firstForm + i} 0 R`).join(" ");
  const lines: string[] = [];
  outer: for (let i = 0; i < PATTERNS; i++) {
    for (let j = i; j < PATTERNS; j++) {
      if (lines.length >= groups) break outer;
      lines.push(`q /Pattern cs /P${i} scn /Pattern CS /P${j} SCN /Missing${lines.length} Do Q`);
    }
  }
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page(`<< /XObject << ${formNames} >> /Pattern << ${patternNames} >> >>`) },
    { header: "4 0 obj", body: stream("", latin(lines.join("\n"))) },
    ...patternObjects,
    ...formObjects,
  ]);
}

/**
 * `forms` forms of `groups` pattern-pair blocks each (7 operators a block, none of them a paint: nothing to price), a page of
 * `states` distinct states each calling a name that is not there: every form is run under every state. The price stays tiny; the
 * cost is in READING the forms (the crafted file of round 9), which the entries ceiling never saw.
 */
function heavy(forms: number, groups: number, states: number): Buffer {
  const firstPattern = 5;
  const firstForm = firstPattern + PATTERNS;
  const patternObjects: RawObject[] = Array.from({ length: PATTERNS }, (_, i) => ({
    header: `${firstPattern + i} 0 obj`,
    body: stream(
      `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep ${400 - 4 * i} /YStep ${400 - 4 * i} /Resources << >>`,
      latin("0 0 m ".repeat(i + 1)),
    ),
  }));
  const pairs: string[] = [];
  for (let i = 0; i < PATTERNS; i++) for (let j = i; j < PATTERNS; j++) pairs.push(`/Pattern cs /P${i} scn /Pattern CS /P${j} SCN`);
  const body = pairs
    .slice(0, groups)
    .map((pair) => `q ${pair} 0 0 m Q`)
    .join("\n");
  const formObjects: RawObject[] = Array.from({ length: forms }, (_, i) => ({
    header: `${firstForm + i} 0 obj`,
    // a comment makes each form its own stream
    body: stream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", latin(`${body}\n% ${i}`)),
  }));
  const patternNames = Array.from({ length: PATTERNS }, (_, i) => `/P${i} ${firstPattern + i} 0 R`).join(" ");
  const formNames = Array.from({ length: forms }, (_, i) => `/F${i} ${firstForm + i} 0 R`).join(" ");
  const content = pairs
    .slice(0, states)
    .map((pair, k) => `q ${pair} /Missing${k} Do Q`)
    .join("\n");
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page(`<< /XObject << ${formNames} >> /Pattern << ${patternNames} >> >>`) },
    { header: "4 0 obj", body: stream("", latin(content)) },
    ...patternObjects,
    ...formObjects,
  ]);
}

/**
 * `forms` forms of `groups` state groups each (a distinct `gs` name, one paint), a page that calls a name that is not there under
 * four states (none, alpha, a separable blend, both): the walk loops over the groups of every form once for each state, so the
 * loop is `forms x 4 x groups` iterations, none of which the entries ceiling (4 x forms) counts. The price is the dearest form's.
 */
function groupHeavy(forms: number, groups: number): Buffer {
  const firstForm = 5;
  const body = Array.from({ length: groups }, (_, g) => `q /G${g} gs 0 0 m f Q`).join("\n");
  const formObjects: RawObject[] = Array.from({ length: forms }, (_, i) => ({
    header: `${firstForm + i} 0 obj`,
    body: stream("/Type /XObject /Subtype /Form /BBox [0 0 10 10]", latin(`${body}\n% ${i}`)),
  }));
  const formNames = Array.from({ length: forms }, (_, i) => `/F${i} ${firstForm + i} 0 R`).join(" ");
  const content = ["/M0 Do", "q /A gs /M1 Do Q", "q /B gs /M2 Do Q", "q /A gs /B gs /M3 Do Q"].join("\n");
  const resources = `<< /XObject << ${formNames} >> /ExtGState << /A << /ca 0.5 >> /B << /BM /Multiply >> >> >>`;
  return build([CATALOG, PAGES, { header: "3 0 obj", body: page(resources) }, { header: "4 0 obj", body: stream("", latin(content)) }, ...formObjects]);
}

/** The walk's verdict under the suite's limits, or under `over` of them (to see what a refused file would have gone on to do). */
const walked = async (bytes: Buffer, over: Partial<FormGraphLimits> = {}) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const t = performance.now();
  const verdict = boundFormGraph(doc, { ...FORM_GRAPH_LIMITS, ...over });
  return { verdict, ms: performance.now() - t };
};

describe("L-10: the walk's memo has a ceiling in entries", () => {
  it("refuses a page whose groups x forms outgrow it, as a verdict, and it is the entries cap that refuses", async () => {
    // 1 024 groups x 60 forms is about 61 000 keys against a ceiling of 20 000 (the file of the finding, 950 forms, is ~0.95 million)
    const bytes = tilingPairs(1_024, 60);
    const { verdict, ms } = await walked(bytes, { maxWork: LIFTED.maxWork }); // the entries cap alone decides here
    expect(verdict).toEqual(REFUSED); // exactly this: no `fromException`, so letterheadUse keeps the answer instead of recomputing it
    expect(ms).toBeLessThan(SMOKE_MS);
    expect(await checkLetterhead(bytes)).toEqual(REFUSED);
    // with the entries cap lifted the same file is a finished walk: nothing else refuses it
    expect((await walked(bytes, LIFTED)).verdict.ok).toBe(true);
  }, 60_000);

  it("gives the same answer every time, work included (the ceilings count entries and steps, not time or memory)", async () => {
    const refused = tilingPairs(1_024, 60);
    expect((await walked(refused)).verdict).toEqual((await walked(refused)).verdict);
    const priced = tilingPairs(100, 30);
    const first = (await walked(priced)).verdict;
    const second = (await walked(priced)).verdict;
    expect(second).toEqual(first);
    expect(first.ok && first.work > 0).toBe(true);
  }, 60_000);

  it("the file of the finding (1 024 groups x 950 forms, 180 KB) is refused, by the entries cap, without building its 0.95 million entries", async () => {
    const bytes = tilingPairs(1_024, 950);
    const { verdict } = await walked(bytes, { maxWork: LIFTED.maxWork });
    expect(verdict).toEqual(REFUSED);
    // and with only the work cap (the memo lifted) the steps stop it too, at a count, long before the 0.95 million entries are built
    expect((await walked(bytes, { maxMemoEntries: LIFTED.maxMemoEntries })).verdict).toEqual(REFUSED);
  }, 60_000);

  it("a page that stays under the ceiling is still priced (the cap is not a blanket refusal of many groups)", async () => {
    const { verdict } = await walked(tilingPairs(100, 30)); // about 3 000 keys
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.invocations).toBe(100);
  });

  it("the ceiling is at least 4 x the dearest legitimate walk of the suite's tests (64 entries)", () => {
    expect(FORM_GRAPH_LIMITS.maxMemoEntries).toBeGreaterThanOrEqual(4 * 64);
  });
});

/**
 * Security round 9, L-11: the entries ceiling bounds memory, not time, because what an entry costs is the loop over its stream's
 * state groups (up to 1 024) and the reading of its stream, which it does not see; a 0.5 MB file just under the ceiling held the
 * event loop 0.7 to 1.5 s.
 */
describe("L-11: the walk has a ceiling in steps, not only in entries", () => {
  it("refuses forms that are dear to read, under the entries ceiling (300 forms x 300 blocks x 21 states: 6 300 entries)", async () => {
    const bytes = heavy(300, 300, 21);
    const lifted = await walked(bytes, LIFTED);
    expect(lifted.verdict.ok).toBe(true);
    if (!lifted.verdict.ok) return;
    console.log("L-11 file (read), lifted:", lifted.verdict.work, "steps,", Math.round(lifted.ms), "ms");
    expect(lifted.verdict.work).toBeGreaterThan(FORM_GRAPH_LIMITS.maxWork); // this is what the ceiling must refuse
    // under the price caps and the entries ceiling: only the steps refuse it
    expect(lifted.verdict.invocations).toBeLessThan(FORM_GRAPH_LIMITS.maxInvocations);
    expect(lifted.verdict.operators).toBeLessThan(FORM_GRAPH_LIMITS.maxOperators);
    expect(lifted.verdict.renderCost).toBeLessThan(FORM_GRAPH_LIMITS.maxRenderCost);
    expect((await walked(bytes, { maxWork: LIFTED.maxWork })).verdict.ok).toBe(true); // the default entries ceiling (20 000) is not what refuses
    const { verdict, ms } = await walked(bytes);
    expect(verdict).toEqual(REFUSED); // a verdict: no `fromException`, so letterheadUse remembers it
    expect(ms).toBeLessThan(SMOKE_MS);
    expect(await checkLetterhead(bytes)).toEqual(REFUSED);
  }, 60_000);

  it("refuses a loop over groups that the entries do not show (300 forms x 100 groups x 4 states: 1 200 entries)", async () => {
    const bytes = groupHeavy(300, 100);
    const lifted = await walked(bytes, LIFTED);
    expect(lifted.verdict.ok).toBe(true);
    if (!lifted.verdict.ok) return;
    console.log("L-11 file (groups), lifted:", lifted.verdict.work, "steps");
    expect(lifted.verdict.work).toBeGreaterThan(FORM_GRAPH_LIMITS.maxWork);
    expect(lifted.verdict.renderCost).toBeLessThan(FORM_GRAPH_LIMITS.maxRenderCost);
    expect((await walked(bytes, { maxWork: LIFTED.maxWork })).verdict.ok).toBe(true);
    expect((await walked(bytes)).verdict).toEqual(REFUSED);
  }, 60_000);

  it("a fifteenth of the forms passes, and its work is at least the loop it did (forms x states x groups) and a small factor of it", async () => {
    const forms = 20;
    const groups = 100;
    const { verdict } = await walked(groupHeavy(forms, groups));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    console.log("L-11 shape (groups), under:", verdict.work, "steps");
    expect(verdict.work).toBeGreaterThanOrEqual(forms * 4 * groups); // the group loop is counted, not just the entries
    expect(verdict.work).toBeLessThanOrEqual(8 * forms * 4 * groups);
    expect(verdict.work).toBeLessThan(FORM_GRAPH_LIMITS.maxWork);
  }, 60_000);

  it("work grows with the groups a form is walked for: twice the groups, at most 2.2 times the steps", async () => {
    const one = (await walked(groupHeavy(20, 100))).verdict;
    const two = (await walked(groupHeavy(20, 200))).verdict;
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(two.work).toBeGreaterThan(1.5 * one.work);
    expect(two.work).toBeLessThanOrEqual(2.2 * one.work);
  }, 60_000);

  it("work grows with the forms read: twice the forms, at most 2.2 times the steps", async () => {
    const one = (await walked(heavy(20, 100, 21))).verdict;
    const two = (await walked(heavy(40, 100, 21))).verdict;
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect(two.work).toBeGreaterThan(1.5 * one.work);
    expect(two.work).toBeLessThanOrEqual(2.2 * one.work);
  }, 60_000);

  it("the ceiling is at least 4 x the dearest legitimate walk of the suite's tests (about 106 000 steps: 100 000 names of one form)", () => {
    expect(FORM_GRAPH_LIMITS.maxWork).toBeGreaterThanOrEqual(4 * 106_000);
    expect(FORM_GRAPH_LIMITS.maxWork).toBe(500_000);
  });
});
