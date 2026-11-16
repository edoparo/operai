import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { crc32, deflateSync } from "node:zlib";
import { boundPdf } from "./pdfBounds";
import { MIB, ascii85Carried, build, contentPdf, deflatedRun, formFanOutPdf, latin, lzwFutureCodes, objStmBombPdf, stream } from "../test-support/pdfBuild";

/**
 * The regression net for the whole class of security M-5 (specs/20261115-crm-offer-wizard): a bound that PREDICTS what
 * another program decodes is only as good as the prediction. For every file in a corpus, whenever `boundPdf` says
 * `ok`, what pdf-lib's own decoders produce for every stream, at load (object and xref streams) and afterwards (the
 * page content a generator embeds), must stay within the decoded bytes the bound reported, plus a small slack. The
 * measure is the length pdf-lib's `FlateStream` reports after every stage of every chain, taken from its own buffers.
 *
 * pdf-lib is loaded as its CommonJS build here (the ESM build's bindings cannot be wrapped); the decoders are the same.
 */

const require = createRequire(import.meta.url);
const lib = require("pdf-lib") as typeof import("pdf-lib");
const FlateStream = (require("pdf-lib/cjs/core/streams/FlateStream") as { default: { prototype: { readBlock: () => void } } }).default;
type Counted = { readBlock: () => void; bufferLength: number };

/** What the readers may produce beyond the bound's figure: one inflate chunk the error path may have swallowed. */
/** `DIFF_SCALE=20 bun test …` runs the same corpus twenty times the size (a one-off soak, not part of the suite). */
const SCALE = Math.max(1, Number(process.env.DIFF_SCALE ?? 1) || 1);
const SLACK = 16 * 1024 + 1024;

/** Runs `work` while recording the output length of every FlateStream pdf-lib builds; returns the sum. */
async function flateOutput(work: () => Promise<void>): Promise<number> {
  const seen = new Set<Counted>();
  const original = FlateStream.prototype.readBlock;
  FlateStream.prototype.readBlock = function (this: Counted) {
    seen.add(this);
    return original.call(this);
  };
  try {
    await work();
  } catch {
    // a file pdf-lib refuses decodes nothing further
  } finally {
    FlateStream.prototype.readBlock = original;
  }
  let total = 0;
  for (const s of seen) total += s.bufferLength;
  return total;
}

/** Everything pdf-lib decodes for `bytes`: the load (object and xref streams) and every remaining raw stream. */
async function libDecodes(bytes: Uint8Array): Promise<number> {
  return flateOutput(async () => {
    const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof lib.PDFRawStream) {
        try {
          lib.decodePDFRawStream(object).decode();
        } catch {
          // an unsupported or broken stream: nothing is delivered
        }
      }
    }
  });
}

interface Row {
  name: string;
  bytes: Uint8Array;
}

let checked = 0;
let accepted = 0;
let largest = 0;
async function agree(row: Row): Promise<void> {
  const verdict = await boundPdf(row.bytes);
  checked++;
  if (!verdict.ok) return;
  accepted++;
  const produced = await libDecodes(row.bytes);
  largest = Math.max(largest, produced);
  if (produced > verdict.decodedBytes + SLACK) {
    throw new Error(`${row.name}: pdf-lib decodes ${produced} bytes, the bound reported ${verdict.decodedBytes}`);
  }
}

// A seeded generator: the corpus is the same on every run.
function prng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  return { int: (n: number) => next() % n, bytes: (n: number) => Buffer.from(Array.from({ length: n }, () => next() & 255)) };
}

/** A valid w x h RGB PNG (what pdf-lib embeds as a Flate image with a PNG predictor). */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([latin(type), body])) >>> 0);
    return Buffer.concat([head, latin(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
const letterheadA4 = readFileSync(new URL("../../../shell/e2e/fixtures/letterhead-a4.pdf", import.meta.url));

async function realLetterheads(): Promise<Row[]> {
  const doc = await lib.PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  page.drawText("wellD SA", { x: 40, y: 740, size: 12 });
  page.drawImage(await doc.embedPng(png(120, 60)), { x: 40, y: 760, width: 120, height: 60 });
  return [
    { name: "letterhead-a4.pdf", bytes: letterheadA4 },
    { name: "pdf-lib page with a logo, object streams", bytes: await doc.save() },
    { name: "pdf-lib page with a logo, plain", bytes: await doc.save({ useObjectStreams: false }) },
  ];
}

describe("differential: the bound can never under-report what pdf-lib decodes", () => {
  it("agrees on the real letterheads and the named vectors of every round", async () => {
    const spaces = await deflatedRun(6); // 6 MiB: under the non-image cap, so the bound says ok and pdf-lib decodes it
    const over = await deflatedRun(16);
    const rows: Row[] = [
      ...(await realLetterheads()),
      { name: "a 6 MiB stream under the cap", bytes: contentPdf("4 0 obj", spaces) },
      { name: "r6 M-5a gen6", bytes: contentPdf("4 000000 obj", over) },
      { name: "r6 M-5a num11", bytes: contentPdf("00000000004 0 obj", over) },
      { name: "r6 M-5a comment", bytes: contentPdf("4 %x\n0 obj", over) },
      { name: "r6 M-5b lzw", bytes: contentPdf("4 0 obj", lzwFutureCodes(3), "/Filter /LZWDecode") },
      { name: "r6 M-5c a85", bytes: contentPdf("4 0 obj", ascii85Carried(over), "/Filter [/ASCII85Decode /FlateDecode]") },
      { name: "r6 M-6 forms", bytes: formFanOutPdf(3, 10) },
      { name: "r6 M-7 objstm bomb", bytes: objStmBombPdf(over) },
      { name: "objstm under the cap", bytes: objStmBombPdf(spaces) },
      { name: "flate chain", bytes: contentPdf("4 0 obj", deflateSync(deflateSync(Buffer.alloc(900_000, 0x20))), "/Filter [/FlateDecode /FlateDecode]") },
      { name: "forged endstream inside the data", bytes: forged() },
      { name: "image in name only", bytes: imageDisguise(deflateSync(Buffer.alloc(3 * MIB, 0x20))) },
      { name: "image of its declared size", bytes: imageDisguise(deflateSync(Buffer.alloc(20 * 61, 0x80))) },
      { name: "truncated", bytes: contentPdf("4 0 obj", deflateSync(Buffer.alloc(2 * MIB, 0x20)).subarray(0, 600)) },
    ];
    for (const row of rows) await agree(row);
  }, 120_000);

  it("agrees on the zlib header: 4 000 random pairs and every pair after 0x78", async () => {
    const random = prng(7);
    const payload = deflateSync(Buffer.alloc(300_000, 0x41)).subarray(2);
    const pairs: [number, number][] = Array.from({ length: 256 }, (_, flg) => [0x78, flg] as [number, number]);
    for (let i = 0; i < 4000 * SCALE; i++) pairs.push([random.int(256), random.int(256)]);
    for (const [cmf, flg] of pairs) {
      await agree({ name: `zlib header ${cmf.toString(16)} ${flg.toString(16)}`, bytes: contentPdf("4 0 obj", Buffer.concat([Buffer.from([cmf, flg]), payload])) });
    }
  }, 120_000);

  it("agrees on 1 500 corruptions of a valid stream: bit flips, cuts, insertions, trailing garbage", async () => {
    const random = prng(11);
    const plain = Buffer.concat([latin("BT /F1 12 Tf (hello) Tj ET\n".repeat(4000)), random.bytes(2000)]);
    const good = deflateSync(plain);
    for (let i = 0; i < 1500 * SCALE; i++) {
      const copy = Buffer.from(good);
      const kind = i % 5;
      let data: Buffer = copy;
      if (kind === 0) for (let k = 0; k < 1 + random.int(4); k++) copy[random.int(copy.length)]! ^= 1 << random.int(8);
      else if (kind === 1) data = copy.subarray(0, random.int(copy.length));
      else if (kind === 2) data = Buffer.concat([copy.subarray(0, random.int(copy.length)), random.bytes(1 + random.int(40)), copy.subarray(random.int(copy.length))]);
      else if (kind === 3) data = Buffer.concat([copy, random.bytes(1 + random.int(200)), deflateSync(Buffer.alloc(1 * MIB))]);
      else for (let k = 0; k < 40; k++) copy[random.int(copy.length)] = random.int(256);
      await agree({ name: `corrupted stream #${i} (kind ${kind})`, bytes: contentPdf("4 0 obj", data) });
    }
  }, 120_000);

  it("agrees on 150 random streams as an object stream, an xref stream and a chain of two", async () => {
    const random = prng(13);
    for (let i = 0; i < 150 * SCALE; i++) {
      const inner = deflateSync(random.bytes(50 + random.int(2000)));
      const noise = random.bytes(10 + random.int(300));
      const body = i % 3 === 0 ? inner : i % 3 === 1 ? Buffer.concat([inner, noise]) : deflateSync(Buffer.concat([inner, noise]));
      const types = ["/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", "/Type /XRef /W [1 2 1] /Size 5 /Filter /FlateDecode", "/Filter [/FlateDecode /FlateDecode]"];
      await agree({ name: `random stream #${i}`, bytes: build(baseObjects(stream(types[i % 3]!, body))) });
    }
  }, 120_000);

  it("agrees on 1 200 mutations of real letterheads (bytes, cuts, copied regions)", async () => {
    const random = prng(17);
    const bases = (await realLetterheads()).map((r) => Buffer.from(r.bytes));
    for (let i = 0; i < 1200 * SCALE; i++) {
      const base = bases[i % bases.length]!;
      let copy = Buffer.from(base);
      const kind = i % 4;
      if (kind === 0) for (let k = 0; k < 1 + random.int(8); k++) copy[random.int(copy.length)] = random.int(256);
      else if (kind === 1) copy = Buffer.from(copy.subarray(0, random.int(copy.length)));
      else if (kind === 2) {
        const from = random.int(copy.length - 40);
        const to = random.int(copy.length - 40);
        base.copy(copy, to, from, from + 40);
      } else {
        // change a digit of an object header or a filter name
        const text = copy.toString("latin1").replace(/(\d+) 0 obj/, (_, n: string) => `${n}${random.int(10)} 0 obj`).replace("FlateDecode", i % 8 === 3 ? "Fl#61teDecode" : "FlateDecode");
        copy = Buffer.from(text, "latin1");
      }
      await agree({ name: `mutation #${i} (kind ${kind})`, bytes: copy });
    }
  }, 120_000);

  it("saw files, accepted a good share of them, and decoded something real", () => {
    console.log(`differential: ${checked} files, ${accepted} accepted by the bound, largest pdf-lib output ${largest} bytes`);
    expect(checked).toBeGreaterThan(5000);
    expect(accepted).toBeGreaterThan(1500);
    expect(largest).toBeGreaterThan(3 * MIB);
  });
});

function baseObjects(fourth: Buffer) {
  return [
    { header: "1 0 obj", body: latin("<< /Type /Catalog /Pages 2 0 R >>") },
    { header: "2 0 obj", body: latin("<< /Type /Pages /Kids [3 0 R] /Count 1 >>") },
    { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>") },
    { header: "4 0 obj", body: fourth },
  ];
}

function forged(): Buffer {
  // zlib header + a stored block holding a forged `endstream endobj`, then the real data as raw deflate.
  const fake = latin("\nendstream\nendobj\n9 0 obj\n<< >>\nstream\n");
  const stored = Buffer.concat([Buffer.from([0x78, 0x01, 0x00, fake.length & 255, fake.length >> 8, ~fake.length & 255, (~fake.length >> 8) & 255]), fake]);
  return contentPdf("4 0 obj", Buffer.concat([stored, deflateSync(Buffer.alloc(2 * MIB)).subarray(2)]));
}

function imageDisguise(data: Buffer): Buffer {
  return build([
    ...baseObjects(stream("", latin("q Q"))).slice(0, 3),
    { header: "4 0 obj", body: stream("", latin("q /I Do Q")) },
    { header: "5 0 obj", body: stream("/Type /XObject /Subtype /Image /Width 20 /Height 20 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode", data) },
  ]);
}
