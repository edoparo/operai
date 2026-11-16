/**
 * Bounds an uploaded PDF BEFORE anything parses it (specs/20261115-crm-offer-wizard DD-74, security M-4, M-5).
 *
 * The letterhead is later opened by pdf.js on the main thread of every person who previews an offer, and a
 * 5 MiB file can inflate to gigabytes (a deflate bomb). Its size, page count and A4 check say nothing about
 * that, and pdf-lib never decodes a stream at load, so this module does the one thing neither does: it counts.
 *
 * It does NOT predict other people's decoders (security M-5: three divergences from pdf-lib and pdf.js in one round).
 * It allows what it can bound exactly and refuses the rest:
 *  - a stream that is not an image has no filter or `FlateDecode` (any number of stages); an image has `FlateDecode`
 *    stages and, last, `DCTDecode`. LZW, run-length, ASCII85, ASCIIHex, JPX, JBIG2, CCITT, Crypt and anything unknown
 *    are `unbounded_stream`: a letterhead has no use for them, and the only decoder left is node's inflate, which is
 *    stricter than both readers and so cannot under-count (differential test: pdfBounds.differential.test.ts);
 *  - every `N G obj` header found anywhere in the bytes is counted, spelled as the readers accept it (digit runs of any
 *    length, comments as whitespace), and every `>> stream` must belong to an object parsed here, else the file is
 *    refused: a spelling this module cannot see would otherwise hide a stream the readers decode;
 *  - a stream is decoded from its data start and its declared /Length is never read: Flate's final block marks its own
 *    end, so a lying /Length or an `endstream` forged inside the data hides nothing;
 *  - Flate runs through node:zlib's streaming inflate and is destroyed the moment a cap is crossed, so the allocation
 *    is bounded by the cap, never by what the bomb would have produced;
 *  - every stage of a chain counts (`[/FlateDecode /FlateDecode]` cannot double past the cap);
 *  - an image is not decoded: it costs its declared Width x Height (for DCT the larger of the dictionary and the
 *    JPEG's own frame header, which is what the decoder allocates);
 *  - whatever cannot be bounded (an unreadable image size, a duplicate key that would let two readers disagree) is
 *    refused as `unbounded_stream`, never guessed.
 * Pure: bytes in, verdict out, with its own small tokenizer (never pdf-lib), so a file cannot make the check itself
 * the victim. A truncated stream and a bad checksum only stop that stream (every reader has produced the same bytes by
 * then, and neither is a bomb); any other inflate error is a refusal, because the readers carry on past what zlib
 * rejects and their output could not be counted.
 */

import { createInflate, constants as zlibConstants } from "node:zlib";

export const PDF_BOUNDS = {
  /** Every stream, decoded, summed (images by declared size). */
  maxDecodedBytes: 32 * 1024 * 1024,
  /** Content, fonts, object and xref streams, ICC profiles, functions: what a reader parses as bytes. */
  maxNonImageDecodedBytes: 8 * 1024 * 1024,
  /** `N G obj` headers found, plus each object stream's /N. */
  maxObjects: 10_000,
  maxStreams: 1_000,
  /** Per image XObject, declared (DCT: also the codec's own header). */
  maxImagePixels: 40_000_000,
  maxTotalImagePixels: 64_000_000,
} as const;

export type PdfBoundsLimits = { readonly [K in keyof typeof PDF_BOUNDS]: number };

export type BoundsReason = "too_complex" | "decoded_too_large" | "image_too_large" | "unbounded_stream";

export type BoundsVerdict =
  | {
      readonly ok: true;
      readonly decodedBytes: number;
      readonly nonImageBytes: number;
      readonly objects: number;
      readonly streams: number;
      readonly imagePixels: number;
    }
  | { readonly ok: false; readonly reason: BoundsReason };

/** Bytes of decoder input plus output a file may cost to check (a work bound, not a content cap). */
const MAX_WORK_BYTES = 192 * 1024 * 1024;
/** Tokenizer budget: the bytes all object parses together may walk, as a multiple of the file plus slack. */
const PARSE_BUDGET_FACTOR = 4;
const PARSE_BUDGET_SLACK = 1024 * 1024;
const MAX_NESTING = 32;
const INFLATE_SLICE = 16 * 1024;
/** What an inflate error may have swallowed in its last chunk (the data of a failing write is dropped). */
const INFLATE_ERROR_SLACK = 16 * 1024;
const MAX_DIMENSION = 1_000_000_000;

class Refusal extends Error {
  constructor(readonly reason: BoundsReason) {
    super(reason);
  }
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

type Value =
  | { readonly t: "name"; readonly v: string }
  | { readonly t: "num"; readonly v: number }
  | { readonly t: "ref"; readonly n: number }
  | { readonly t: "bool"; readonly v: boolean }
  | { readonly t: "arr"; readonly v: Value[] }
  | { readonly t: "dict"; readonly v: Map<string, Value>; readonly dup: boolean }
  | { readonly t: "other" };

const OTHER: Value = { t: "other" };
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIMS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);

class Reader {
  i: number;
  private readonly start: number;
  constructor(
    private readonly s: string,
    at: number,
    /** Bytes the budget still allows every parse together; spent as this reader advances. */
    private readonly budget: { left: number },
  ) {
    this.i = at;
    this.start = at;
  }
  /** Charges what this reader walked since the last call; refuses when the budget is spent. */
  spend(): void {
    const walked = this.i - this.start;
    if (walked > this.budget.left) throw new Refusal("too_complex");
  }
  commit(): void {
    this.budget.left -= this.i - this.start;
    if (this.budget.left < 0) throw new Refusal("too_complex");
  }
  private isWs(at: number): boolean {
    return WS.has(this.s.charCodeAt(at));
  }
  skipWs(): void {
    const s = this.s;
    for (;;) {
      if (this.i >= s.length) return;
      const code = s.charCodeAt(this.i);
      if (WS.has(code)) this.i++;
      else if (code === 37 /* % */) {
        while (this.i < s.length && s.charCodeAt(this.i) !== 10 && s.charCodeAt(this.i) !== 13) this.i++;
      } else return;
      this.spend();
    }
  }
  private regular(at: number): boolean {
    return at < this.s.length && !this.isWs(at) && !DELIMS.has(this.s[at]!);
  }
  private token(): string {
    const from = this.i;
    while (this.regular(this.i)) this.i++;
    return this.s.slice(from, this.i);
  }
  private name(): string {
    this.i++; // the slash
    const raw = this.token();
    // `#xx` is a legal escape inside a name: /Fl#61teDecode IS /FlateDecode to a reader.
    return raw.includes("#") ? raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : raw;
  }
  private string(): void {
    let depth = 0;
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i]!;
      this.i++;
      if (c === "\\") this.i++;
      else if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth <= 0) return;
      }
      if ((this.i & 0x3fff) === 0) this.spend();
    }
    this.spend();
  }
  value(depth = 0): Value {
    if (depth > MAX_NESTING) throw new Refusal("too_complex");
    this.skipWs();
    const s = this.s;
    if (this.i >= s.length) return OTHER;
    const c = s[this.i]!;
    if (c === "/") return { t: "name", v: this.name() };
    if (c === "<") {
      if (s[this.i + 1] === "<") return this.dict(depth);
      const end = s.indexOf(">", this.i);
      this.i = end < 0 ? s.length : end + 1;
      this.spend();
      return OTHER;
    }
    if (c === "[") {
      this.i++;
      const items: Value[] = [];
      for (;;) {
        this.skipWs();
        if (this.i >= s.length) return { t: "arr", v: items };
        if (s[this.i] === "]") {
          this.i++;
          return { t: "arr", v: items };
        }
        const before = this.i;
        items.push(this.value(depth + 1));
        if (this.i === before) this.i++;
        this.spend();
      }
    }
    if (c === "(") {
      this.string();
      return OTHER;
    }
    if (DELIMS.has(c)) {
      this.i++; // a stray `)`, `>`, `]`…: advance, never loop
      return OTHER;
    }
    const tok = this.token();
    if (/^[+-]?\d+$/.test(tok)) {
      // `N G R` is a reference; look ahead without consuming on a miss.
      const save = this.i;
      this.skipWs();
      const gen = this.token();
      if (/^\d+$/.test(gen)) {
        this.skipWs();
        const r = this.token();
        if (r === "R") return { t: "ref", n: Number(tok) };
      }
      this.i = save;
      return { t: "num", v: Number(tok) };
    }
    if (/^[+-]?(\d+\.\d*|\.\d+)$/.test(tok)) return { t: "num", v: Number(tok) };
    if (tok === "true") return { t: "bool", v: true };
    if (tok === "false") return { t: "bool", v: false };
    return OTHER;
  }
  private dict(depth: number): Value {
    this.i += 2;
    const map = new Map<string, Value>();
    let dup = false;
    for (;;) {
      this.skipWs();
      if (this.i >= this.s.length) throw new Truncated();
      if (this.s[this.i] === ">" && this.s[this.i + 1] === ">") {
        this.i += 2;
        return { t: "dict", v: map, dup };
      }
      const before = this.i;
      if (this.s[this.i] === "/") {
        const key = this.name();
        const val = this.value(depth + 1);
        if (map.has(key)) dup = true;
        map.set(key, val);
      } else {
        this.value(depth + 1); // junk where a key belongs
      }
      if (this.i === before) this.i++;
      this.spend();
    }
  }
}

/** A dictionary that never closes: not an object a reader could use. */
class Truncated extends Error {}

// ─── Object headers and stream keywords ─────────────────────────────────────

const isDigit = (code: number): boolean => code >= 48 && code <= 57;
const isAlnum = (code: number): boolean => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

/**
 * Skips whitespace and comments (a comment runs to the end of its line). A `%` inside binary data starts a "comment"
 * that runs to the next line break, which may be the end of the file, and a file can hold a `%` after every digit: the
 * end of the line is remembered, so a line is walked once however many scans reach it, and every step is charged to
 * `budget` (the allowance the object parses draw on).
 */
class Blanks {
  private from = -1;
  private to = -1;
  constructor(
    private readonly text: string,
    private readonly budget: { left: number },
  ) {}
  skip(at: number): number {
    const text = this.text;
    let i = at;
    for (;;) {
      if (i >= text.length) return i;
      const code = text.charCodeAt(i);
      if (WS.has(code)) {
        i++;
        this.charge(1);
      } else if (code === 37 /* % */) {
        if (i >= this.from && i < this.to) i = this.to;
        else {
          const from = i;
          while (i < text.length && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
          this.charge(i - from);
          this.from = from;
          this.to = i;
        }
      } else return i;
    }
  }
  private charge(k: number): void {
    this.budget.left -= k;
    if (this.budget.left < 0) throw new Refusal("too_complex");
  }
}

/**
 * Every `N G obj` header, spelled as pdf-lib and pdf.js accept it: digit runs of any length (`4 000000 obj`,
 * `00000000004 0 obj`) and whitespace or comments between the three tokens (`4 %x⏎ 0 obj`). Found anywhere in the
 * bytes, as a reader that rebuilds a broken file would see them. `at` is the position just after `obj`.
 */
function findHeaders(text: string, max: number, blanks: Blanks): { num: number; at: number }[] {
  const found: { num: number; at: number }[] = [];
  const runs = /(?<![0-9])[0-9]+/g;
  for (let m = runs.exec(text); m; m = runs.exec(text)) {
    const afterNum = m.index + m[0].length;
    const genAt = blanks.skip(afterNum);
    if (genAt === afterNum || !isDigit(text.charCodeAt(genAt))) continue;
    let genEnd = genAt;
    while (isDigit(text.charCodeAt(genEnd))) genEnd++;
    const objAt = blanks.skip(genEnd);
    if (objAt === genEnd || !text.startsWith("obj", objAt)) continue;
    const end = objAt + 3;
    if (end < text.length && isAlnum(text.charCodeAt(end))) continue;
    if (found.length >= max) throw new Refusal("too_complex");
    found.push({ num: Number(m[0]), at: end });
  }
  return found;
}

/** Positions of every `stream` keyword that follows a dictionary's `>>` (whitespace and comments between). */
function findStreamKeywords(text: string, blanks: Blanks): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(">>"); at >= 0; at = text.indexOf(">>", at + 2)) {
    const keyword = blanks.skip(at + 2);
    if (!text.startsWith("stream", keyword)) continue;
    // `streams` or `stream9` is one longer token, not the keyword.
    const next = keyword + 6;
    if (next < text.length && !WS.has(text.charCodeAt(next)) && !DELIMS.has(text[next]!)) continue;
    found.push(keyword);
  }
  return found;
}

// ─── Flate ──────────────────────────────────────────────────────────────────

interface StageResult {
  /** Bytes the stage produced (counted even when `buf` is not kept). */
  n: number;
  buf: Buffer | null;
  /** The output crossed the stage's limit; `n` is then only a lower bound. */
  over: boolean;
  /** Input bytes the stage walked. */
  consumed: number;
  /**
   * Inflate stopped on an error other than a bad checksum. The readers are more lenient than zlib about what comes after
   * one (pdf.js's inflate carries on past a bad distance or a bad header), so their output cannot be counted: the file
   * is refused. A truncated stream and a bad checksum are not this: every reader has produced the same bytes by then.
   */
  broken: boolean;
}

/** node:zlib's streaming inflate, fed in slices and destroyed at the limit. Bytes already produced are kept on error. */
async function flate(input: Buffer, limit: number, keep: boolean): Promise<StageResult> {
  const inflate = createInflate({ finishFlush: zlibConstants.Z_SYNC_FLUSH, chunkSize: INFLATE_SLICE });
  const chunks: Buffer[] = [];
  let n = 0;
  let over = false;
  let finished = false;
  let broken = false;
  let wake: (() => void) | null = null;
  const stop = () => {
    finished = true;
    wake?.();
  };
  inflate.on("data", (chunk: Buffer) => {
    n += chunk.length;
    if (keep) chunks.push(chunk);
    if (n > limit && !over) {
      over = true;
      stop();
      inflate.destroy();
    }
  });
  inflate.on("error", (error: Error) => {
    if (!over) n += INFLATE_ERROR_SLACK;
    // Every byte is out before zlib checks the trailer, and a reader ignores the trailer.
    if (!/incorrect data check/i.test(error.message)) broken = true;
    stop();
  });
  inflate.on("end", stop);
  inflate.on("close", stop);
  for (let at = 0; at < input.length && !finished; at += INFLATE_SLICE) {
    await new Promise<void>((resolve) => {
      wake = resolve;
      inflate.write(input.subarray(at, at + INFLATE_SLICE), () => resolve());
    });
  }
  const consumed = Math.min(input.length, Math.max(inflate.bytesWritten, 0));
  inflate.destroy();
  if (n > limit) over = true;
  return { n, buf: keep && !over ? Buffer.concat(chunks, n) : null, over, consumed, broken: broken && !over };
}

// ─── Filter vocabulary ──────────────────────────────────────────────────────

/** The two abbreviations a letterhead's streams may legitimately use; every other name is refused as it stands. */
const FILTER_ALIASES: Record<string, string> = { Fl: "FlateDecode", DCT: "DCTDecode" };
const FLATE = "FlateDecode";
const DCT = "DCTDecode";

// ─── The check ──────────────────────────────────────────────────────────────

export async function boundPdf(bytes: Uint8Array, limits: PdfBoundsLimits = PDF_BOUNDS): Promise<BoundsVerdict> {
  try {
    return await run(bytes, limits);
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.reason };
    throw error;
  }
}

interface ParsedStream {
  readonly dict: Map<string, Value>;
  readonly dup: boolean;
  /** Offset of the `stream` keyword. */
  readonly keyword: number;
  /** Offset of the first data byte. */
  readonly data: number;
}

async function run(bytes: Uint8Array, limits: PdfBoundsLimits): Promise<BoundsVerdict> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buf.toString("latin1");
  const budget = { left: bytes.byteLength * PARSE_BUDGET_FACTOR + PARSE_BUDGET_SLACK };

  // 1. Every object header, counted as found; every `stream` keyword after a dictionary.
  const blanks = new Blanks(text, budget);
  const headers = findHeaders(text, limits.maxObjects, blanks);
  const defs = new Map<number, number[]>();
  for (const header of headers) {
    const list = defs.get(header.num);
    if (list) list.push(header.at);
    else defs.set(header.num, [header.at]);
  }
  const keywords = findStreamKeywords(text, blanks);
  if (keywords.length > limits.maxStreams) throw new Refusal("too_complex");

  // 2. Parse each object's dictionary and find the streams.
  const streams: ParsedStream[] = [];
  for (const header of headers) {
    const reader = new Reader(text, header.at, budget);
    let value: Value;
    try {
      value = reader.value();
    } catch (error) {
      if (error instanceof Truncated) {
        reader.commit();
        continue;
      }
      throw error;
    }
    if (value.t === "dict") {
      reader.skipWs();
      if (text.startsWith("stream", reader.i)) {
        const keyword = reader.i;
        // A reader skips to the end of the keyword's line, whatever else is on it.
        let at = reader.i + 6;
        while (at < text.length && text.charCodeAt(at) !== 10 && text.charCodeAt(at) !== 13) at++;
        if (text.charCodeAt(at) === 13 && text.charCodeAt(at + 1) === 10) at += 2;
        else at++;
        streams.push({ dict: value.v, dup: value.dup, keyword, data: Math.min(at, text.length) });
      }
    }
    reader.commit();
  }
  if (streams.length > limits.maxStreams) throw new Refusal("too_complex");
  // The cross-check: a stream a reader would find that no parsed object accounts for is a spelling this module cannot
  // see. It cannot be bounded, so the file is refused.
  const parsedKeywords = new Set(streams.map((stream) => stream.keyword));
  if (keywords.some((keyword) => !parsedKeywords.has(keyword))) throw new Refusal("unbounded_stream");

  const resolve = (value: Value | undefined, hops = 0): Value | undefined => {
    if (!value) return undefined;
    if (value.t !== "ref") return value;
    if (hops > 4) return undefined;
    const at = defs.get(value.n);
    if (!at || at.length !== 1) return undefined; // missing or defined twice: two readers could disagree
    const r = new Reader(text, at[0]!, budget);
    try {
      const v = r.value();
      r.commit();
      return resolve(v, hops + 1);
    } catch (error) {
      if (error instanceof Truncated) return undefined;
      throw error;
    }
  };
  const int = (value: Value | undefined): number | undefined => {
    const v = resolve(value);
    return v && v.t === "num" && Number.isInteger(v.v) && v.v >= 0 ? v.v : undefined;
  };
  const nameOf = (value: Value | undefined): string | undefined => {
    const v = resolve(value);
    return v && v.t === "name" ? v.v : undefined;
  };

  // 3. The meter: what the streams add up to.
  let decoded = 0;
  let nonImage = 0;
  let work = 0;
  let objects = headers.length;
  let pixelsTotal = 0;
  const spendWork = (k: number) => {
    work += k;
    if (work > MAX_WORK_BYTES) throw new Refusal("too_complex");
  };
  if (objects > limits.maxObjects) throw new Refusal("too_complex");

  for (const stream of streams) {
    const dict = stream.dict;
    if (stream.dup) throw new Refusal("unbounded_stream");
    const filters = filtersOf(dict, resolve);
    if (!filters) throw new Refusal("unbounded_stream");
    // The allowlist: Flate stages, then (images only) one DCT. Everything else is refused as it stands.
    const codec = filters.includes(DCT) ? DCT : null;
    if (codec && filters.indexOf(DCT) !== filters.length - 1) throw new Refusal("unbounded_stream");
    const decoders = codec ? filters.slice(0, -1) : filters;
    if (decoders.some((f) => f !== FLATE)) throw new Refusal("unbounded_stream");
    checkPredictors(dict, decoders.length, resolve, int, limits);
    const isImage = codec !== null || nameOf(dict.get("Subtype")) === "Image";
    const input = buf.subarray(stream.data);

    if (!isImage) {
      const kind = nameOf(dict.get("Type"));
      if (decoders.length > 0) {
        const allowance = Math.min(limits.maxDecodedBytes - decoded, limits.maxNonImageDecodedBytes - nonImage);
        const out = await decodeChain(input, decoders, allowance, false);
        spendWork(out.consumed + out.produced);
        if (out.over) throw new Refusal("decoded_too_large");
        if (out.broken) throw new Refusal("unbounded_stream");
        decoded += out.produced;
        nonImage += out.produced;
        if (decoded > limits.maxDecodedBytes || nonImage > limits.maxNonImageDecodedBytes) {
          throw new Refusal("decoded_too_large");
        }
      }
      if (kind === "ObjStm") {
        const count = int(dict.get("N"));
        if (count === undefined) throw new Refusal("unbounded_stream");
        objects += count;
        if (objects > limits.maxObjects) throw new Refusal("too_complex");
      }
      continue;
    }

    // An image: costed by what it declares (and what its codec header says), not by decoding it.
    const width = int(dict.get("Width"));
    const height = int(dict.get("Height"));
    if (width === undefined || height === undefined || width === 0 || height === 0) throw new Refusal("unbounded_stream");
    let w = width;
    let h = height;
    let comps = componentsOf(dict, resolve);
    const bpc = dict.has("BitsPerComponent") ? (int(dict.get("BitsPerComponent")) ?? 8) : 8;
    const mask = resolve(dict.get("ImageMask"));
    if (mask && mask.t === "bool" && mask.v) comps = 1;
    let bytesPer = Math.ceil(Math.min(Math.max(bpc, 1), 16) / 8);
    if (mask && mask.t === "bool" && mask.v) bytesPer = 1;

    if (codec === DCT) {
      const pre = decoders.length > 0 ? await decodeChain(input, decoders, limits.maxDecodedBytes - decoded, true) : null;
      if (pre) {
        spendWork(pre.consumed + pre.produced);
        if (pre.over) throw new Refusal("decoded_too_large");
        if (pre.broken) throw new Refusal("unbounded_stream");
      }
      const head = pre ? pre.last : input;
      if (!head) throw new Refusal("unbounded_stream");
      const found = jpegSize(head);
      if (!found) throw new Refusal("unbounded_stream");
      if (found.w * found.h > w * h) {
        w = found.w;
        h = found.h;
      }
      comps = Math.max(comps, found.comps);
    }
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) throw new Refusal("image_too_large");
    const pixels = w * h;
    pixelsTotal += pixels;
    if (pixels > limits.maxImagePixels || pixelsTotal > limits.maxTotalImagePixels) throw new Refusal("image_too_large");
    const declared = pixels * comps * bytesPer;
    if (decoded + declared > limits.maxDecodedBytes) throw new Refusal("decoded_too_large");

    if (!codec && decoders.length > 0) {
      // A stream that CALLS itself an image may be the page's content in disguise, and its reader would then
      // inflate all of it: decode up to the declared size (plus per-row predictor bytes) and charge what lies
      // beyond to the non-image budget.
      const room = declared + h + 1024;
      const nonImageLeft = limits.maxNonImageDecodedBytes - nonImage;
      const out = await decodeChain(input, decoders, room + nonImageLeft, false);
      spendWork(out.consumed + out.produced);
      if (out.over) throw new Refusal("decoded_too_large");
      if (out.broken) throw new Refusal("unbounded_stream");
      const excess = Math.max(0, out.final - room);
      nonImage += excess;
      decoded += excess;
      if (nonImage > limits.maxNonImageDecodedBytes) throw new Refusal("decoded_too_large");
    }
    decoded += declared;
    if (decoded > limits.maxDecodedBytes) throw new Refusal("decoded_too_large");
  }

  return {
    ok: true,
    decodedBytes: decoded,
    nonImageBytes: nonImage,
    objects,
    streams: Math.max(streams.length, keywords.length),
    imagePixels: pixelsTotal,
  };
}

type Resolve = (value: Value | undefined) => Value | undefined;

/** The filter chain of a stream dictionary, as canonical names; undefined when it cannot be read safely. */
function filtersOf(dict: Map<string, Value>, resolve: Resolve): string[] | undefined {
  // A reader takes /F before /Filter, and a /F that is a file specification (a dictionary or string) as no filter.
  const lists: string[][] = [];
  for (const key of ["F", "Filter"]) {
    if (!dict.has(key)) continue;
    const v = resolve(dict.get(key));
    if (!v) return undefined;
    if (v.t === "name") lists.push([canonical(v.v)]);
    else if (v.t === "arr") {
      const names: string[] = [];
      for (const item of v.v) {
        const r = resolve(item);
        if (!r || r.t !== "name") return undefined;
        names.push(canonical(r.v));
      }
      lists.push(names);
    } else if (key === "Filter") return undefined; // /Filter that is no name or array: not interpretable
  }
  if (lists.length === 0) return [];
  if (lists.length === 2 && lists[0]!.join() !== lists[1]!.join()) return undefined;
  return lists[0]!;
}

const canonical = (name: string): string => (Object.hasOwn(FILTER_ALIASES, name) ? FILTER_ALIASES[name]! : name);

/**
 * A predictor decodes row by row, and a reader allocates a row's bytes from /Columns, /Colors and /BitsPerComponent:
 * a row wider than the whole decoded budget is a file made to allocate, whatever its data holds.
 */
function checkPredictors(
  dict: Map<string, Value>,
  stages: number,
  resolve: Resolve,
  int: (value: Value | undefined) => number | undefined,
  limits: PdfBoundsLimits,
): void {
  const raw = resolve(dict.get("DecodeParms") ?? dict.get("DP"));
  if (!raw) return;
  const dicts: Map<string, Value>[] = [];
  if (raw.t === "dict") dicts.push(raw.v);
  else if (raw.t === "arr") {
    for (const item of raw.v.slice(0, Math.max(stages, 1))) {
      const r = resolve(item);
      if (r && r.t === "dict") dicts.push(r.v);
    }
  }
  for (const parms of dicts) {
    if (!parms.has("Predictor")) continue;
    const predictor = int(parms.get("Predictor"));
    if (predictor === undefined) throw new Refusal("unbounded_stream");
    if (predictor <= 1) continue;
    const field = (key: string, fallback: number): number => {
      if (!parms.has(key)) return fallback;
      const v = int(parms.get(key));
      if (v === undefined) throw new Refusal("unbounded_stream");
      return v;
    };
    const rowBytes = Math.ceil((field("Columns", 1) * field("Colors", 1) * field("BitsPerComponent", 8)) / 8);
    if (rowBytes > limits.maxDecodedBytes) throw new Refusal("decoded_too_large");
  }
}

function componentsOf(dict: Map<string, Value>, resolve: Resolve): number {
  const space = resolve(dict.get("ColorSpace"));
  const byName = (name: string | undefined): number => {
    switch (name) {
      case "DeviceGray":
      case "G":
      case "CalGray":
      case "Indexed":
      case "I":
        return 1;
      case "DeviceRGB":
      case "RGB":
      case "CalRGB":
      case "Lab":
        return 3;
      default:
        return 4; // CMYK, ICCBased, Separation, DeviceN, Pattern, unknown: assume the widest
    }
  };
  if (!space) return 4;
  if (space.t === "name") return byName(space.v);
  if (space.t === "arr") {
    const first = resolve(space.v[0]);
    return byName(first && first.t === "name" ? first.v : undefined);
  }
  return 4;
}

interface ChainResult {
  /** Sum of every stage's output (the cost of the chain). */
  produced: number;
  /** Output of the last stage. */
  final: number;
  /** The last stage's bytes, when asked to keep them. */
  last: Buffer | null;
  consumed: number;
  over: boolean;
  broken: boolean;
}

/** Inflates a chain of Flate stages from the data start; every stage's output counts against `allowance`. */
async function decodeChain(data: Buffer, stages: readonly string[], allowance: number, keepLast: boolean): Promise<ChainResult> {
  let current = data;
  let produced = 0;
  let consumed = 0;
  for (let k = 0; k < stages.length; k++) {
    const lastStage = k === stages.length - 1;
    const keep = !lastStage || keepLast;
    const limit = allowance - produced;
    if (limit < 0) return { produced, final: produced, last: null, consumed, over: true, broken: false };
    const r = await flate(current, limit, keep);
    consumed += r.consumed;
    produced += r.n;
    if (r.over || produced > allowance) return { produced, final: r.n, last: null, consumed, over: true, broken: false };
    if (r.broken) return { produced, final: r.n, last: null, consumed, over: false, broken: true };
    if (lastStage) return { produced, final: r.n, last: r.buf, consumed, over: false, broken: false };
    current = r.buf ?? Buffer.alloc(0);
  }
  return { produced, final: 0, last: null, consumed, over: false, broken: false };
}

// ─── Image codec header ─────────────────────────────────────────────────────

/** Width, height and component count of a JPEG's frame header (a reader allocates what it declares). */
function jpegSize(data: Buffer): { w: number; h: number; comps: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= data.length) {
    if (data[i] !== 0xff) return null;
    while (data[i + 1] === 0xff) i++; // fill bytes
    const marker = data[i + 1]!;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / scan before any frame header
    const len = (data[i + 2]! << 8) | data[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 10 > data.length) return null;
      const h = (data[i + 5]! << 8) | data[i + 6]!;
      const w = (data[i + 7]! << 8) | data[i + 8]!;
      return { w: Math.max(w, 1), h: Math.max(h, 1), comps: Math.max(data[i + 9]!, 1) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
