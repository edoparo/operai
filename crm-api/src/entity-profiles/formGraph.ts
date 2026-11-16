/**
 * Bounds the work of DRAWING a letterhead, after `boundPdf` bounded the bytes of its streams (specs/20261115-crm-offer-wizard,
 * security M-6 and D23).
 *
 * The decoded-size bound says nothing about how long drawing takes: 1.2 KB of `/S1 sh` repeated 10 000 times is one
 * axial shading painted 10 000 times, 50 seconds as ONE task on the main thread of everyone who opens an offer of the
 * entity (D23), and a page can call a Form XObject (`/F Do`) that calls another, every call running the form's content
 * again (M-6). The preview runs on the main thread (ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote), and
 * the same letterhead is then embedded in every offer PDF the client opens.
 *
 * This walks the content with pdf-lib's own parse (safe now: `boundPdf` ran first) and the resources as a reader
 * resolves them (a form with no /Resources of its own uses its caller's), prices ONE drawing of the page, and refuses
 * above the caps:
 *  - `depth`: how deep forms nest;
 *  - `invocations`: forms run, in total, each multiplied by the calls that reach it (a `gs` that switches on a soft
 *    mask runs the mask's form: the same shape, counted the same);
 *  - `operators`: content operators executed, in total, with every call to a form multiplying that form's own;
 *  - `renderCost`: what those operators cost to PAINT, in `RENDER_WEIGHTS` units of 10 microseconds, measured with pdf.js
 *    6.4.299 in Chromium at the preview's own size (1600 px wide). A path paint, a shading (`sh`), an image, a soft mask,
 *    a form, a paint made with a gradient or tiling pattern each have a weight, and the graphics state the content
 *    switches on makes the others dearer (a soft mask makes every paint 5 ms, a Luminosity blend every image 20 ms).
 *    The state is read in order, as a reader keeps it: `q` and `Q` scope it, the ExtGStates named by `gs` accumulate
 *    within a scope, a colour operator replaces the pattern of its fill or stroke, and what a form is called under
 *    is what it is priced under (so is a form called twice under two states, twice). A tiling pattern's cell is drawn
 *    again at EVERY paint made with it (20 `sh` in a cell: 25 ms per fill) and its tile is a canvas the paint allocates
 *    (1 100 pt steps and 136 fills held 4.8 GB), so the cell's whole price and the tile's memory are added to each paint
 *    made while the pattern is set, in the stream and in the forms it calls.
 * A `Do` whose form cannot be told (a name not in the resources, an operand that is no name) is charged as the most
 * expensive form in scope. A cycle is refused, and so is a Type 3 font, whose glyph procedures run once per glyph shown.
 *
 * What a letterhead has no use for is refused rather than priced (an allowlist, as `boundPdf` does for stream filters):
 *  - an operator that is not one of the content-stream operators of PDF 1.7 (minus the Type 3 ones);
 *  - a shading that is not axial or radial (function-based and mesh shadings are drawn per pixel or per triangle: one
 *    `sh` over a 1 million vertex mesh ran more than 90 s);
 *  - an inline image with a filter (its decoded size is outside `boundPdf`) or above `maxInlineImagePixels`;
 *  - a pattern the resources do not resolve.
 * The streams a reader draws are the page's, those of the forms and mask groups it reaches AND those of
 * the page's annotation appearances (pdf.js draws them on the canvas by default, and they were not walked: 200 `sh` in
 * one appearance stream took 1.1 s).
 *
 * Content is tokenized, not pattern-matched: names, strings, hex strings, comments and the data of an inline image are
 * skipped as a reader skips them, so text that only LOOKS like a call costs nothing and a real call written without
 * spaces still counts. An error here (a stream pdf-lib cannot decode) is a refusal.
 */

import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream, type PDFDocument, type PDFObject } from "pdf-lib";

/**
 * Set against the real letterheads (formGraph.test.ts prints them: depth 0, no form call, 24, 69 and 80 operators, 84 to
 * 890 cost units) with room: the caps are more than 100 times the largest. The cost of drawing AT the caps is what
 * `RENDER_WEIGHTS` is calibrated to: the worst a letterhead that passes can do is about one second in pdf.js 6.4.299
 * (formGraph.test.ts documents the measurement). The invocations and depth caps are those of M-6.
 */
export const FORM_GRAPH_LIMITS = {
  maxDepth: 8,
  maxInvocations: 2_000,
  maxOperators: 100_000,
  /** In `RENDER_WEIGHTS` units: 10 microseconds each, so 100 000 is about one second. */
  maxRenderCost: 100_000,
  /** An inline image has no entry in the object table, so its size is only what its own dictionary claims. */
  maxInlineImagePixels: 4_000_000,
  /** A page of a letterhead has one content stream, a producer that splits it a handful; the committed ones have one (security M-10). */
  maxContentStreams: 16,
  /** The page's content streams joined, each charged once per time the `/Contents` array lists it: `boundPdf` counts an object once (M-10). */
  maxContentBytes: 8 * 1024 * 1024,
  /**
   * What the walk may remember in all, over `run` and `worstIn` (security L-10): an entry is one (stream, resources, state, cell)
   * priced once. The memo is what keeps the walk from repeating itself, but its size is streams x distinct states, and a crafted
   * file of 180 KB (1 024 state groups x 950 empty forms) held about 0.95 million entries, 450 MB, in 0.8 s. A letterhead
   * needs a few dozen; the cap is a count, so the refusal is the same on every run and every machine.
   */
  maxMemoEntries: 20_000,
  /**
   * What the walk may do in all, in steps (security L-11): one step is one unit of CPU of the same order, whichever it is: an
   * operator scanned, a form or group visited, a name of a resource dictionary read, a memo entry made or looked up. The memo cap
   * bounds memory; this one bounds time, because the work per memo entry is the loop over a stream's state groups (up to 1 024),
   * which the entry cap does not see. Like it, a count, so the refusal is the same on every run and every machine. A page of the
   * committed letterheads takes a few hundred steps (`formGraph.test.ts` prints them) and the busiest walk the suite makes on
   * purpose (a resource dictionary of 100 000 names, `formGraph.r7.test.ts`) about 106 000; the cap is more than 4 times that. A
   * step costs about 0.2 microseconds in Bun (measured on the crafted files of rounds 8 and 9: 2.7 to 3.9 million steps took
   * 0.6 to 0.85 s), so what passes is some 0.1 s of walk at most, and one the size of the L-11 file is refused before it is spent.
   * That holds only while every loop over something the file supplies is charged or capped (security M-12: the `/BM` array of an
   * ExtGState was neither, and the key of a graphics state was rebuilt from every name of its scope per change); the sweep that
   * closed them is listed in the ADR's amendment, and `isolatedPdfCheck.ts` bounds what a loop missed (security, round 10).
   */
  maxWork: 500_000,
} as const;

/**
 * What pdf.js 6.4.299 spends drawing one operator on an A4 page at 1600 px wide, in units of 10 microseconds (Chromium
 * headless, software raster, 2026-11-15; the preview's own `renderLetterhead` options). Measured by repeating the
 * operator 1 000 times (200 for the dearest) and dividing:
 *   path or text paint, page-sized    0.27 ms       shading `sh` (axial, radial)     5.0 to 5.3 ms
 *   image, drawn page-sized           5.8 ms        gradient pattern, per paint      5.4 ms
 *   tiling pattern, per paint         6.5 ms + its cell, again at every paint (20 `sh` in a cell: 25 ms)
 *   soft mask set (`gs`)              25 to 30 ms, 24 MB
 *   form (small content)              0.04 ms       operator that paints nothing     0.003 ms
 * and, with a graphics state switched on, what each costs in addition (per paint / per heavy operator / per form):
 *   alpha below 1        0 / 1.5 / 2.5 ms     (a form run under alpha is drawn as a group)
 *   separable blend      1 / 3.5 / 0.1 ms     (Multiply: image 9.1 ms, `sh` 6.9 ms)
 *   non-separable blend  9 / 15 / 0.1 ms      (Hue and Luminosity: paint 7.5 to 9.4 ms, image 20 ms, `sh` 11 ms)
 *   soft mask            5 / 5 / 8 ms         (paint 5 ms, `sh` 9.8 ms, form 7.9 ms)
 * The weights are rounded UP: an estimate of a cost is only worth having when it cannot be lower than the cost. A soft
 * mask is weighed by its memory, not its time: every set allocates a page-sized layer (about 24 MB resident in Chromium,
 * 630 MB for the 32 that its time alone would allow), so 6 000 units, 16 sets, about 390 MB above an idle tab.
 */
export const RENDER_WEIGHTS = {
  operator: 1,
  paint: 30,
  form: 5,
  shading: 600,
  image: 600,
  gradientPaint: 600,
  tilingPaint: 700,
  softMaskSet: 6_000,
  /** Memory, where a paint allocates a canvas it does not give back inside the task: 250 units a megabyte, 400 MB the budget. */
  perMegabyte: 250,
} as const;

/** The page is drawn at 1600 px: 2.69 px a point; pdf.js builds a tiling pattern's tile at most 3000 px square (its MAX_PATTERN_SIZE). */
const POINTS_TO_PIXELS = 1600 / 595.28;
const MAX_TILE_PIXELS = 3_000;

const STATE_ALPHA = 1;
const STATE_SEPARABLE_BLEND = 2;
const STATE_NONSEPARABLE_BLEND = 4;
const STATE_SOFT_MASK = 8;
const STATE_GRADIENT = 16;
const STATE_TILING = 32;

type Dearer = "paint" | "heavy" | "form";
/** What a state adds, in the units of RENDER_WEIGHTS, to a paint, to a heavy operator (`sh`, image, pattern paint) and to a form. */
const STATE_ADDS: readonly (readonly [number, Record<Dearer, number>])[] = [
  [STATE_ALPHA, { paint: 0, heavy: 150, form: 250 }],
  [STATE_SEPARABLE_BLEND, { paint: 100, heavy: 350, form: 10 }],
  [STATE_NONSEPARABLE_BLEND, { paint: 900, heavy: 1_500, form: 10 }],
  [STATE_SOFT_MASK, { paint: 500, heavy: 500, form: 800 }],
];

function adds(state: number, kind: Dearer): number {
  let most = 0;
  for (const [bit, table] of STATE_ADDS) if ((state & bit) !== 0) most = Math.max(most, table[kind]);
  return most;
}

/** What one paint of the path or text costs under `state`, `cellWork` being the content of the tiling pattern set (drawn again by every paint). */
function paintCost(state: number, cellWork: number): number {
  const plain = RENDER_WEIGHTS.paint + adds(state, "paint");
  const gradient = (state & STATE_GRADIENT) !== 0 ? RENDER_WEIGHTS.gradientPaint + adds(state, "heavy") : 0;
  const tiling = (state & STATE_TILING) !== 0 ? RENDER_WEIGHTS.tilingPaint + cellWork + adds(state, "heavy") : 0;
  return Math.max(plain, gradient, tiling);
}

export type FormGraphLimits = { readonly [K in keyof typeof FORM_GRAPH_LIMITS]: number };

export type FormGraphVerdict =
  | {
      readonly ok: true;
      readonly depth: number;
      readonly invocations: number;
      readonly operators: number;
      readonly renderCost: number;
      /** What the walk itself did, in `FORM_GRAPH_LIMITS.maxWork` steps (not what drawing costs): for tests and for the cap's calibration. */
      readonly work: number;
    }
  | {
      readonly ok: false;
      readonly reason: "too_complex";
      /** The walk failed for a reason that is not the graph (pdf-lib could not decode a stream): see letterhead.ts. */
      readonly fromException?: true;
    };

class TooComplex extends Error {}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isRegular = (c: number): boolean => !WS.has(c) && !DELIM.has(c);

/** The content-stream operators of PDF 1.7 (Table 51) a page can use; `d0` and `d1` belong to Type 3 glyphs, which are refused. */
const OPERATORS = new Set([
  "b", "B", "b*", "B*", "BDC", "BI", "BMC", "BT", "BX", "c", "cm", "CS", "cs", "d", "Do", "DP", "EI", "EMC", "ET", "EX",
  "f", "F", "f*", "G", "g", "gs", "h", "i", "ID", "j", "J", "K", "k", "l", "m", "M", "MP", "n", "q", "Q", "re", "RG", "rg",
  "ri", "s", "S", "SC", "sc", "SCN", "scn", "sh", "T*", "Tc", "Td", "TD", "Tf", "Tj", "TJ", "TL", "Tm", "Tr", "Ts", "Tw",
  "Tz", "v", "w", "W", "W*", "y", "'", '"',
]);
/** What puts ink on the page: path painting and text showing. */
const PAINTS = new Set(["f", "F", "f*", "B", "B*", "b", "b*", "S", "s", "Tj", "TJ", "'", '"']);

/** What the graphics state is, as far as the price of drawing goes: the patterns set and the ExtGStates applied in the current `q` scope. */
interface Current {
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly gs: readonly string[];
  readonly key: string;
}

/** A letterhead has a handful of graphics states: a scan that has to keep more is one made to cost the walk itself (memory, copies). */
const MAX_STATE_NAMES = 64;
const MAX_STATE_GROUPS = 1_024;

const keyOf = (fill: string | null, stroke: string | null, gs: readonly string[]) => JSON.stringify([fill, stroke, gs]);
const START: Current = { fill: null, stroke: null, gs: [], key: keyOf(null, null, []) };

/** What a stream does while ONE graphics state is current. */
interface Group {
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly gs: readonly string[];
  /** Path painting and text showing operators. */
  paints: number;
  /** Calls by resource name: `Do`. */
  readonly calls: Map<string, number>;
  /** Calls by resource name: `sh`. */
  readonly shadings: Map<string, number>;
  /** `Do` whose operand is no name. */
  unnamed: number;
  /** `sh` whose operand is no name. */
  unnamedShadings: number;
  /** `BI … ID … EI`, each already checked against the inline-image rules. */
  inlineImages: number;
}

interface Scan {
  /** Operators in the stream (inline-image data is not one). */
  readonly operators: number;
  /** What it does, by the graphics state it does it under (`q` and `Q` scope a state; `gs` names accumulate within a scope). */
  readonly groups: readonly Group[];
  /** Calls by resource name: `gs`. */
  readonly states: ReadonlyMap<string, number>;
  /** Names `sc`, `SC`, `scn`, `SCN` were given (a pattern). */
  readonly patterns: ReadonlySet<string>;
}

/** A number as a content stream spells it: sign, digits, one point; at least one digit. */
function isNumber(data: Uint8Array, from: number, to: number): boolean {
  let digits = 0;
  for (let k = from; k < to; k++) {
    const ch = data[k]!;
    if (ch >= 0x30 && ch <= 0x39) digits++;
    else if (ch !== 0x2b && ch !== 0x2d && ch !== 0x2e) return false;
  }
  return digits > 0;
}

/** The dictionary of an inline image, read between `BI` and `ID`: only what bounds its cost. */
interface InlineImage {
  /** The key whose value is next (null: a key is next). */
  key: string | null;
  width: number;
  height: number;
  filtered: boolean;
  /** Depth inside an array or dictionary value. */
  nest: number;
}

const FILTER_KEYS = new Set(["F", "Filter"]);
const WIDTH_KEYS = new Set(["W", "Width"]);
const HEIGHT_KEYS = new Set(["H", "Height"]);

/** The operators of a content stream, and the names `Do`, `gs`, `sh` and the colour operators are called with. */
function scan(data: Uint8Array, maxInlinePixels: number, tick: (steps: number) => void): Scan {
  const states = new Map<string, number>();
  const patterns = new Set<string>();
  const groups = new Map<string, Group>();
  const saved: Current[] = [];
  let current = START;
  let here: Group | undefined;
  let operators = 0;
  let inline: InlineImage | null = null;
  let operand: string | null = null; // the last operand when it was a name; null for anything else
  const n = data.length;
  let i = 0;
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  /** The group of the current graphics state (created at its first operation). */
  const group = (): Group => {
    if (here) return here;
    let found = groups.get(current.key);
    if (!found) {
      if (groups.size >= MAX_STATE_GROUPS) throw new TooComplex();
      tick(1);
      found = { fill: current.fill, stroke: current.stroke, gs: current.gs, paints: 0, calls: new Map(), shadings: new Map(), unnamed: 0, unnamedShadings: 0, inlineImages: 0 };
      groups.set(current.key, found);
    }
    return (here = found);
  };
  const change = (fill: string | null, stroke: string | null, gs: readonly string[]) => {
    if (fill === current.fill && stroke === current.stroke && gs === current.gs) return;
    if (gs.length > MAX_STATE_NAMES) throw new TooComplex();
    const key = keyOf(fill, stroke, gs);
    // Building the key reads every name of the scope again, and a name may be as long as the stream: 64 names of 100 KB and a
    // fill that flips between two patterns rebuilt a 6 MB key per flip, 10 s of one task with the operator count far under its cap
    // (security M-12 sweep). One step per 64 characters of key, so the cost is counted where it is paid.
    tick(key.length >> 6);
    current = { fill, stroke, gs, key };
    here = undefined;
  };
  /** A value of the inline-image dictionary that is not a name or a number (a string, an array, a dictionary, a keyword). */
  const inlineValue = (opening: boolean) => {
    if (inline === null || inline.nest > 0) return;
    if (opening && inline.key !== null && FILTER_KEYS.has(inline.key)) inline.filtered = true;
    inline.key = null;
  };
  while (i < n) {
    const c = data[i]!;
    if (WS.has(c)) {
      i++;
    } else if (c === 0x25 /* % */) {
      while (i < n && data[i] !== 10 && data[i] !== 13) i++;
    } else if (c === 0x2f /* / */) {
      const from = ++i;
      while (i < n && isRegular(data[i]!)) i++;
      let name = "";
      for (let k = from; k < i; k++) {
        const ch = data[k]!;
        const hex = ch === 0x23 && k + 2 < i ? Number.parseInt(String.fromCharCode(data[k + 1]!, data[k + 2]!), 16) : Number.NaN;
        if (!Number.isNaN(hex)) {
          name += String.fromCharCode(hex);
          k += 2;
        } else name += String.fromCharCode(ch);
      }
      if (inline !== null && inline.nest === 0) {
        if (inline.key === null) inline.key = name;
        else {
          if (FILTER_KEYS.has(inline.key)) inline.filtered = true;
          inline.key = null;
        }
      }
      operand = name;
    } else if (c === 0x28 /* ( */) {
      let depth = 0;
      while (i < n) {
        const ch = data[i++]!;
        if (ch === 0x5c) i++;
        else if (ch === 0x28) depth++;
        else if (ch === 0x29 && --depth <= 0) break;
      }
      inlineValue(false);
      operand = null;
    } else if (c === 0x3c /* < */) {
      if (data[i + 1] === 0x3c) {
        i += 2;
        inlineValue(true);
        if (inline !== null) inline.nest++;
      } else {
        while (i < n && data[i] !== 0x3e) i++;
        i++;
        inlineValue(false);
      }
      operand = null;
    } else if (c === 0x3e /* > */) {
      i += data[i + 1] === 0x3e ? 2 : 1;
      if (inline !== null && inline.nest > 0 && --inline.nest === 0) inline.key = null;
      operand = null;
    } else if (DELIM.has(c)) {
      i++; // [ ] { } )
      if (inline !== null) {
        if (c === 0x5b /* [ */) {
          inlineValue(true);
          inline.nest++;
        } else if (c === 0x5d /* ] */ && inline.nest > 0 && --inline.nest === 0) inline.key = null;
      }
      operand = null;
    } else {
      const from = i;
      while (i < n && isRegular(data[i]!)) i++;
      const token = i - from <= 5 ? String.fromCharCode(...data.subarray(from, i)) : "";
      const numeric = isNumber(data, from, i);
      if (numeric || token === "true" || token === "false" || token === "null") {
        if (inline !== null && inline.nest === 0 && inline.key !== null) {
          const value = numeric && i - from <= 20 ? Number(String.fromCharCode(...data.subarray(from, i))) : Number.NaN;
          if (WIDTH_KEYS.has(inline.key)) inline.width = Math.max(inline.width, value);
          else if (HEIGHT_KEYS.has(inline.key)) inline.height = Math.max(inline.height, value);
          inline.key = null;
        }
        operand = null;
        continue;
      }
      // Inside the dictionary of an inline image only `ID` ends it; any other operator is not a file a reader reads as one.
      if (!OPERATORS.has(token) || (inline !== null && token !== "ID")) throw new TooComplex();
      operators++;
      tick(1); // refused while it is read, not after: a stream of any length stops at the cap
      if (PAINTS.has(token)) group().paints++;
      else if (token === "Do") {
        if (operand === null) group().unnamed++;
        else bump(group().calls, operand);
      } else if (token === "gs") {
        if (operand !== null) {
          bump(states, operand);
          if (!current.gs.includes(operand)) change(current.fill, current.stroke, [...current.gs, operand]);
        }
      } else if (token === "sh") {
        if (operand === null) group().unnamedShadings++;
        else bump(group().shadings, operand);
      } else if (token === "scn" || token === "sc") {
        if (operand !== null) patterns.add(operand);
        change(operand, current.stroke, current.gs); // a colour with no pattern name replaces the pattern
      } else if (token === "SCN" || token === "SC") {
        if (operand !== null) patterns.add(operand);
        change(current.fill, operand, current.gs);
      } else if (token === "cs" || token === "rg" || token === "g" || token === "k") change(null, current.stroke, current.gs);
      else if (token === "CS" || token === "RG" || token === "G" || token === "K") change(current.fill, null, current.gs);
      else if (token === "q") saved.push(current);
      else if (token === "Q") {
        const back = saved.pop();
        if (back) {
          current = back;
          here = undefined;
        }
      } else if (token === "BI") {
        inline = { key: null, width: 0, height: 0, filtered: false, nest: 0 };
      } else if (token === "ID") {
        // `ID` with no `BI` before it is no inline image a reader draws; one with a dictionary that does not bound it is refused.
        if (inline === null) throw new TooComplex();
        if (inline.filtered || !(inline.width > 0 && inline.height > 0) || inline.width * inline.height > maxInlinePixels) throw new TooComplex();
        inline = null;
        group().inlineImages++;
        // The data of an inline image runs to the first `EI` after whitespace (a reader may end it later, never earlier).
        if (i < n && WS.has(data[i]!)) i++;
        while (i < n && !(data[i] === 0x45 && data[i + 1] === 0x49 && (i === 0 || WS.has(data[i - 1]!)) && (i + 2 >= n || !isRegular(data[i + 2]!)))) i++;
      }
      operand = null;
    }
  }
  if (inline !== null) throw new TooComplex();
  return { operators, groups: [...groups.values()], states, patterns };
}

interface Cost {
  readonly operators: number;
  readonly invocations: number;
  readonly depth: number;
  readonly work: number;
}

const ZERO: Cost = { operators: 0, invocations: 0, depth: 0, work: 0 };

/** The megabytes of the tile canvas a paint with this tiling pattern allocates (unreadable steps are the largest tile). */
function tileMegabytes(pattern: PDFDict, atPage: boolean): number {
  const array = pattern.lookup(name("Matrix"));
  let scale = POINTS_TO_PIXELS;
  if (array instanceof PDFArray) {
    let widest = 0;
    for (let k = 0; k < Math.min(4, array.size()); k++) widest = Math.max(widest, Math.abs(numberOf(array.lookup(k)) ?? Number.POSITIVE_INFINITY));
    scale *= Math.max(1, widest);
  }
  const x = Math.abs(numberOf(pattern.lookup(name("XStep"))) ?? 0);
  const y = Math.abs(numberOf(pattern.lookup(name("YStep"))) ?? 0);
  if (!atPage || x === 0 || y === 0) return (MAX_TILE_PIXELS * MAX_TILE_PIXELS * 4) / (1024 * 1024);
  return (Math.min(MAX_TILE_PIXELS, Math.ceil(x * scale)) * Math.min(MAX_TILE_PIXELS, Math.ceil(y * scale)) * 4) / (1024 * 1024);
}

/** Each figure the larger of the two: what a paint might draw again is the dearest cell it can have. */
const widest = (a: Cost, b: Cost): Cost => ({
  operators: Math.max(a.operators, b.operators),
  invocations: Math.max(a.invocations, b.invocations),
  depth: Math.max(a.depth, b.depth),
  work: Math.max(a.work, b.work),
});

const name = (value: string) => PDFName.of(value);

function contentOf(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return (stream as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
}

function asDict(value: PDFObject | undefined): PDFDict | undefined {
  return value instanceof PDFDict ? value : undefined;
}

const isForm = (stream: PDFStream): boolean => stream.dict.lookup(name("Subtype")) === name("Form");

const numberOf = (value: PDFObject | undefined): number | undefined => (value instanceof PDFNumber ? value.asNumber() : undefined);

const SEPARABLE_BLENDS = new Set([
  "Normal", "Compatible", "Multiply", "Screen", "Overlay", "Darken", "Lighten", "ColorDodge", "ColorBurn", "HardLight", "SoftLight", "Difference", "Exclusion",
]);

/** The most names a `/BM` array may list (a reader takes the first it knows; a producer writes one). */
const MAX_BLEND_NAMES = 16;

/** What an ExtGState makes dearer: a soft mask (and the group it runs), a blend mode other than Normal, an alpha below 1. */
function stateOf(ext: PDFDict): { readonly state: number; readonly group?: PDFStream } {
  let state = 0;
  let group: PDFStream | undefined;
  const mask = ext.lookup(name("SMask"));
  if (mask !== undefined && mask !== name("None")) {
    state |= STATE_SOFT_MASK;
    const found = asDict(mask)?.lookup(name("G"));
    if (found instanceof PDFStream) group = found;
  }
  const blend = ext.lookup(name("BM"));
  if (blend !== undefined) {
    // A blend mode is one name or a short list of fallbacks; a longer array is no letterhead's and is refused before it is read
    // (security M-12).
    if (blend instanceof PDFArray && blend.size() > MAX_BLEND_NAMES) throw new TooComplex();
    const names = blend instanceof PDFArray ? Array.from({ length: blend.size() }, (_, k) => blend.lookup(k)) : [blend];
    for (const one of names) {
      const kind = one instanceof PDFName ? one.decodeText() : "";
      if (kind === "Normal" || kind === "Compatible") continue;
      state |= SEPARABLE_BLENDS.has(kind) ? STATE_SEPARABLE_BLEND : STATE_NONSEPARABLE_BLEND; // a name nobody knows is the dearest
    }
  }
  for (const key of ["ca", "CA"]) {
    const alpha = ext.lookup(name(key));
    if (alpha !== undefined && !((numberOf(alpha) ?? 0) >= 1)) state |= STATE_ALPHA;
  }
  return group ? { state, group } : { state };
}

/** Axial and radial shadings are what a letterhead needs; the rest are drawn per pixel or per triangle. */
function requireAxialOrRadial(shading: PDFObject | undefined): void {
  const dict = shading instanceof PDFStream ? shading.dict : asDict(shading);
  const type = numberOf(dict?.lookup(name("ShadingType")));
  if (type !== 2 && type !== 3) throw new TooComplex();
}

export function boundFormGraph(doc: PDFDocument, limits: FormGraphLimits = FORM_GRAPH_LIMITS): FormGraphVerdict {
  try {
    return walk(doc, limits);
  } catch (error) {
    if (error instanceof TooComplex) return { ok: false, reason: "too_complex" };
    // A stream pdf-lib cannot decode cannot be told apart from one made to be a problem: refused, not remembered.
    return { ok: false, reason: "too_complex", fromException: true };
  }
}

function walk(doc: PDFDocument, limits: FormGraphLimits): FormGraphVerdict {
  const scans = new Map<PDFStream, Scan>();
  /** By stream, then the resources it is read with, then the graphics state it is called under. */
  const memo = new Map<PDFStream, Map<PDFDict | null, Map<string, Cost>>>();
  const onStack = new Set<PDFStream>();
  let remembered = 0;
  /** What the walk has done, in steps: the deterministic stand-in for its CPU (security L-11). Every loop of the walk charges here. */
  let steps = 0;
  const tick = (n: number) => {
    steps += n;
    if (steps > limits.maxWork) throw new TooComplex();
  };
  /** Counts an entry about to be stored: the one place the memos grow, so the refusal does not depend on which memo it was. */
  const remember = () => {
    remembered += 1;
    if (remembered > limits.maxMemoEntries) throw new TooComplex();
    tick(1);
  };

  /**
   * What an ExtGState does, read ONCE per dictionary per walk and charged for what the read costs (security M-12): a resource
   * dictionary may name one ExtGState object under any number of names, and `stateOf` loops over its `/BM` array, so reading it per
   * name made the cost names x array length while the counter saw a few steps a name.
   */
  const extStates = new Map<PDFDict, ReturnType<typeof stateOf>>();
  const stateOfExt = (ext: PDFDict): ReturnType<typeof stateOf> => {
    let found = extStates.get(ext);
    if (!found) {
      const blend = ext.lookup(name("BM"));
      tick(1 + (blend instanceof PDFArray ? blend.size() : 0));
      found = stateOf(ext);
      extStates.set(ext, found);
    }
    return found;
  };

  const scanOf = (stream: PDFStream): Scan => {
    let found = scans.get(stream);
    if (!found) {
      found = scan(contentOf(stream), limits.maxInlineImagePixels, tick);
      scans.set(stream, found);
    }
    return found;
  };

  const refuseType3 = (resources: PDFDict | undefined) => {
    const fonts = asDict(resources?.lookup(name("Font")));
    if (!fonts) return;
    for (const key of fonts.keys()) {
      tick(1); // read again by every walk of a stream that uses these resources
      if (asDict(fonts.lookup(key))?.lookup(name("Subtype")) === name("Type3")) throw new TooComplex();
    }
  };

  /** The DISTINCT forms a resource dictionary names (a dictionary may name one object any number of times), found once per dictionary. */
  const formsByResources = new Map<PDFDict | undefined, PDFStream[]>();
  const formsIn = (resources: PDFDict | undefined): PDFStream[] => {
    const known = formsByResources.get(resources);
    if (known) return known;
    const found = new Set<PDFStream>();
    const xobjects = asDict(resources?.lookup(name("XObject")));
    if (xobjects) {
      for (const key of xobjects.keys()) {
        tick(1); // a name of the dictionary read: a dictionary may list one object 100 000 times (security M-11)
        const target = xobjects.lookup(key);
        if (target instanceof PDFStream && isForm(target)) found.add(target);
      }
    }
    const list = [...found];
    formsByResources.set(resources, list);
    return list;
  };

  /**
   * The most expensive form in scope, which is what a `Do` whose form cannot be told is charged as. It depends only on the
   * resources and on the state and cell it is called under, never on the call, so it is computed once for each of those
   * (security M-11: per call, 1 900 absent names against 100 000 entries for one form was 36 s of a blocked event loop).
   */
  const worstByScope = new Map<PDFDict | undefined, Map<string, Cost>>();
  const worstIn = (own: PDFDict | undefined, depth: number, state: number, cell: Cost): Cost => {
    tick(1);
    let byState = worstByScope.get(own);
    if (!byState) worstByScope.set(own, (byState = new Map()));
    const key = `${state}:${cell.work}:${cell.operators}:${cell.invocations}`;
    const known = byState.get(key);
    if (known) return known;
    let operators = 0;
    let invocations = 0;
    let deepest = 0;
    let work = 0;
    for (const form of formsIn(own)) {
      tick(1);
      const sub = run(form, own, depth, state, cell);
      operators = Math.max(operators, sub.operators);
      invocations = Math.max(invocations, sub.invocations);
      deepest = Math.max(deepest, sub.depth);
      work = Math.max(work, sub.work);
    }
    const found = { operators, invocations, depth: deepest, work };
    remember();
    byState.set(key, found);
    return found;
  };

  /** What running one stream (a form, a mask group, an appearance) expands to, with `caller` the resources it falls back on. */
  const run = (target: PDFStream, caller: PDFDict | undefined, depth: number, state: number, cell: Cost): Cost => {
    tick(1);
    const resources = asDict(target.dict.lookup(name("Resources"))) ?? caller ?? null;
    let byScope = memo.get(target);
    if (!byScope) memo.set(target, (byScope = new Map()));
    let byState = byScope.get(resources);
    if (!byState) byScope.set(resources, (byState = new Map()));
    const key = `${state}:${cell.work}:${cell.operators}:${cell.invocations}`;
    const known = byState.get(key);
    if (known) return known;
    if (onStack.has(target)) throw new TooComplex(); // a stream that reaches itself
    onStack.add(target);
    try {
      const sub = costOf(scanOf(target), resources ?? undefined, depth + 1, state, cell);
      remember();
      byState.set(key, sub);
      return sub;
    } finally {
      onStack.delete(target);
    }
  };

  /** What running `content` expands to, drawn with the resources `own`, called under graphics state `inherited`. */
  const costOf = (content: Scan, own: PDFDict | undefined, depth: number, inherited: number, inheritedCell: Cost): Cost => {
    if (depth > limits.maxDepth) throw new TooComplex();
    // The loops below: the states and patterns the stream names, then each of its state groups with the names it calls (L-11).
    tick(1 + content.states.size + content.patterns.size + content.groups.length);
    refuseType3(own);
    let operators = content.operators;
    let invocations = 0;
    let deepest = 0;
    let work = 0;
    const check = () => {
      if (operators > limits.maxOperators || invocations > limits.maxInvocations || work > limits.maxRenderCost) throw new TooComplex();
    };

    // What each ExtGState does to the price, and the soft masks it sets (one is drawn at every `gs` that names it).
    const extGStates = asDict(own?.lookup(name("ExtGState")));
    const stateCache = new Map<string, number>();
    const stateOfCall = (call: string): number => {
      let found = stateCache.get(call);
      if (found === undefined) {
        const ext = asDict(extGStates?.lookup(name(call)));
        found = ext ? stateOfExt(ext).state : 0;
        stateCache.set(call, found);
      }
      return found;
    };
    const masks: [PDFStream, number][] = [];
    let maskSets = 0;
    for (const [call, times] of content.states) {
      const ext = asDict(extGStates?.lookup(name(call)));
      if (!ext) continue;
      const found = stateOfExt(ext);
      if ((found.state & STATE_SOFT_MASK) !== 0) {
        maskSets += times;
        if (found.group) masks.push([found.group, times]);
      }
    }
    // What each pattern does to the price: a gradient makes a paint a gradient, a tiling pattern draws its cell again at every paint.
    const patterns = asDict(own?.lookup(name("Pattern")));
    const patternInfo = new Map<string, { readonly state: number; readonly cell: Cost }>();
    for (const call of content.patterns) {
      const target = patterns?.lookup(name(call));
      const type = numberOf((target instanceof PDFStream ? target.dict : asDict(target))?.lookup(name("PatternType")));
      if (target instanceof PDFDict && type === 2) {
        requireAxialOrRadial(target.lookup(name("Shading")));
        patternInfo.set(call, { state: STATE_GRADIENT, cell: ZERO });
      } else if (target instanceof PDFStream && type === 1) {
        const one = run(target, own, depth, 0, ZERO); // a cell is drawn from a fresh graphics state
        deepest = Math.max(deepest, 1 + one.depth);
        // and every paint builds a tile canvas of the step's size (36 MB at most) that stays until the task ends: 1 100 pt steps and
        // 136 fills held 4.8 GB. The scale is known for a pattern of the page, which is drawn at the preview's; a pattern used inside
        // a form is scaled by whatever `cm` led to the form, so it is priced as the largest tile.
        const tile = tileMegabytes(target.dict, depth === 0);
        patternInfo.set(call, { state: STATE_TILING, cell: { ...one, work: one.work + Math.ceil(tile * RENDER_WEIGHTS.perMegabyte) } });
      } else throw new TooComplex(); // a pattern nobody can price
    }

    work += operators * RENDER_WEIGHTS.operator + maskSets * RENDER_WEIGHTS.softMaskSet;
    check();

    const add = (times: number, sub: Cost, overhead: number) => {
      operators += times * sub.operators;
      invocations += times * (1 + sub.invocations);
      work += times * (overhead + sub.work);
      deepest = Math.max(deepest, 1 + sub.depth);
      check();
    };
    const xobjects = asDict(own?.lookup(name("XObject")));
    const shadings = asDict(own?.lookup(name("Shading")));
    for (const group of content.groups) {
      tick(1 + group.gs.length + group.calls.size + group.shadings.size);
      // The state this part of the stream draws under: the caller's, the ExtGStates and the patterns set in this `q` scope.
      let state = inherited;
      let cell = inheritedCell;
      for (const call of group.gs) state |= stateOfCall(call);
      for (const pattern of [group.fill, group.stroke]) {
        const info = pattern === null ? undefined : patternInfo.get(pattern);
        if (!info) continue;
        state |= info.state;
        cell = widest(cell, info.cell);
      }
      const heavy = RENDER_WEIGHTS.image + adds(state, "heavy"); // an image, under `state`
      const formOverhead = RENDER_WEIGHTS.form + adds(state, "form");
      const worst = (): Cost => worstIn(own, depth, state, cell);
      work += group.paints * paintCost(state, cell.work);
      operators += group.paints * cell.operators;
      invocations += group.paints * cell.invocations;
      for (const [call, times] of group.shadings) {
        const target = shadings?.lookup(name(call));
        if (target !== undefined) requireAxialOrRadial(target);
        work += times * (RENDER_WEIGHTS.shading + adds(state, "heavy"));
      }
      work += group.unnamedShadings * (RENDER_WEIGHTS.shading + adds(state, "heavy"));
      work += group.inlineImages * heavy;
      check();
      for (const [call, times] of group.calls) {
        const target = xobjects?.lookup(name(call));
        if (target instanceof PDFStream) {
          if (isForm(target)) add(times, run(target, own, depth, state, cell), formOverhead);
          else {
            work += times * heavy; // an image, or whatever else a reader draws from a stream
            check();
          }
        } else add(times, worst(), formOverhead);
      }
      if (group.unnamed > 0) add(group.unnamed, worst(), formOverhead);
    }
    // A mask group is drawn from a fresh graphics state, not the caller's.
    for (const [group, times] of masks) add(times, run(group, own, depth, 0, ZERO), 0);
    return { operators, invocations, depth: deepest, work };
  };

  /** The appearance streams of a page's annotations: pdf.js draws them on the canvas unless told not to. */
  const appearancesOf = (annotations: PDFArray | undefined): PDFStream[] => {
    const found: PDFStream[] = [];
    for (let k = 0; annotations && k < annotations.size(); k++) {
      tick(1);
      const normal = asDict(asDict(annotations.lookup(k))?.lookup(name("AP")))?.lookup(name("N"));
      if (normal instanceof PDFStream) found.push(normal);
      else if (normal instanceof PDFDict) {
        for (const key of normal.keys()) {
          tick(1);
          const state = normal.lookup(key);
          if (state instanceof PDFStream) found.push(state);
        }
      }
    }
    return found;
  };

  let total: Cost = ZERO;
  for (const page of doc.getPages()) {
    const parts = page.node.Contents();
    const listed: PDFStream[] = [];
    if (parts instanceof PDFStream) listed.push(parts);
    else if (parts instanceof PDFArray) {
      // Counted before any entry is looked at: an array may list one stream hundreds of thousands of times (security M-10).
      if (parts.size() > limits.maxContentStreams) throw new TooComplex();
      for (let k = 0; k < parts.size(); k++) {
        const part = parts.lookup(k);
        if (part instanceof PDFStream) listed.push(part);
      }
    }
    // Contents the walk cannot read are never counted as nothing: a page that has them and yields no stream is refused.
    if (parts !== undefined && listed.length === 0 && !(parts instanceof PDFArray && parts.size() === 0)) throw new TooComplex();
    // Each distinct stream is decoded once; every time the array lists it counts against the bound, as the reader joins them all.
    const decoded = new Map<PDFStream, Uint8Array>();
    let charged = 0;
    const chunks = listed.map((stream) => {
      let bytes = decoded.get(stream);
      if (!bytes) decoded.set(stream, (bytes = contentOf(stream)));
      charged += bytes.length + 1;
      if (charged > limits.maxContentBytes) throw new TooComplex();
      return bytes;
    });
    // A reader joins the content streams of a page: a token may start in one and end in the next.
    const joined = concat(chunks);
    const resources = page.node.Resources();
    tick(1 + chunks.length);
    let cost = costOf(scan(joined, limits.maxInlineImagePixels, tick), resources, 0, 0, ZERO);
    for (const appearance of appearancesOf(page.node.Annots())) {
      const sub = run(appearance, resources, 0, 0, ZERO);
      cost = {
        operators: cost.operators + sub.operators,
        invocations: cost.invocations + 1 + sub.invocations,
        depth: Math.max(cost.depth, 1 + sub.depth),
        work: cost.work + RENDER_WEIGHTS.form + sub.work,
      };
      if (cost.operators > limits.maxOperators || cost.invocations > limits.maxInvocations || cost.work > limits.maxRenderCost) throw new TooComplex();
    }
    total = {
      operators: total.operators + cost.operators,
      invocations: total.invocations + cost.invocations,
      depth: Math.max(total.depth, cost.depth),
      work: total.work + cost.work,
    };
    if (total.operators > limits.maxOperators || total.invocations > limits.maxInvocations || total.work > limits.maxRenderCost) throw new TooComplex();
  }
  return { ok: true, depth: total.depth, invocations: total.invocations, operators: total.operators, renderCost: total.work, work: steps };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
    out[at++] = 10; // streams are separated by whitespace
  }
  return out;
}
