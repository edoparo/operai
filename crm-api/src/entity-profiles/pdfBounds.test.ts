import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createDeflate, crc32, deflateRawSync, deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { checkLetterhead } from "./letterhead";
import { PDF_BOUNDS, boundPdf, type BoundsReason, type PdfBoundsLimits } from "./pdfBounds";

/**
 * specs/20261115-crm-offer-wizard DD-74 (security M-4): the decoded-size bound runs before any parse.
 * Every hostile file is built here, in memory; nothing large is committed.
 */

const MIB = 1024 * 1024;
const latin = (s: string) => Buffer.from(s, "latin1");
const file = (...parts: Buffer[]) => Buffer.concat([latin("%PDF-1.7\n"), ...parts]);
function obj(n: number, dict: string, data?: Buffer): Buffer {
  if (!data) return latin(`${n} 0 obj\n<< ${dict} >>\nendobj\n`);
  return Buffer.concat([latin(`${n} 0 obj\n<< ${dict} >>\nstream\n`), data, latin("\nendstream\nendobj\n")]);
}
const streamPdf = (dict: string, data: Buffer) => file(obj(1, dict, data));
const FLATE = "/Filter /FlateDecode";

/** `mib` MiB of zeros, deflated by streaming (the bomb itself is never held decoded). */
async function zerosDeflated(mib: number): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflate.on("data", (c: Buffer) => chunks.push(c));
  const zeros = Buffer.alloc(MIB);
  for (let i = 0; i < mib; i++) if (!deflate.write(zeros)) await once(deflate, "drain");
  deflate.end();
  await once(deflate, "end");
  return Buffer.concat(chunks);
}

const asciiHex = (data: Buffer) => latin(`${data.toString("hex")}>`);

const jpeg = (w: number, h: number, comps = 3) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8 + 3 * comps, 8, h >> 8, h & 255, w >> 8, w & 255, comps, ...new Array(3 * comps).fill(0), 0xff, 0xd9]);

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

let bomb1GiB: Buffer; // 1 GiB of zeros, deflated (about 1 MiB)
let bomb24MiB: Buffer;
beforeAll(async () => {
  bomb1GiB = await zerosDeflated(1024);
  bomb24MiB = await zerosDeflated(24);
}, 60_000);

const expectRefused = async (bytes: Uint8Array, reason: BoundsReason, limits: PdfBoundsLimits = PDF_BOUNDS) =>
  expect(await boundPdf(bytes, limits)).toEqual({ ok: false, reason });

describe("boundPdf: a flate bomb (AC-11.7, M-4)", () => {
  it("refuses a bomb in a content stream, whatever /Length says", async () => {
    await expectRefused(streamPdf(`/Length 3 ${FLATE}`, bomb24MiB), "decoded_too_large");
    await expectRefused(streamPdf(`/Length 99999999 ${FLATE}`, bomb24MiB), "decoded_too_large");
  });

  it("refuses it behind an indirect /Length and a forged endstream inside the data", async () => {
    // zlib header + a STORED block holding a forged `endstream endobj`, then the real bomb as raw deflate.
    const forged = latin("\nendstream\nendobj\n9 0 obj\n<< >>\nstream\n");
    const stored = Buffer.concat([Buffer.from([0x78, 0x01, 0x00, forged.length & 255, forged.length >> 8, ~forged.length & 255, (~forged.length >> 8) & 255]), forged]);
    const data = Buffer.concat([stored, deflateRawSync(Buffer.alloc(20 * MIB))]);
    const pdf = file(obj(1, `/Length 2 0 R ${FLATE}`, data), latin("2 0 obj\n3\nendobj\n"));
    await expectRefused(pdf, "decoded_too_large");
  });

  it("reads names through #xx escapes and the /F abbreviation, as a reader does", async () => {
    await expectRefused(streamPdf("/Filter /Fl#61teDecode", bomb24MiB), "decoded_too_large");
    await expectRefused(streamPdf("/Filter [/Fl]", bomb24MiB), "decoded_too_large");
    await expectRefused(streamPdf("/F /FlateDecode", bomb24MiB), "decoded_too_large");
    await expectRefused(file(obj(1, "/Filter 7 0 R", bomb24MiB), latin("7 0 obj\n[/FlateDecode]\nendobj\n")), "decoded_too_large");
  });

  it("counts every stage of a chain", async () => {
    await expectRefused(streamPdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(bomb24MiB)), "decoded_too_large");
    // Each stage under the cap, the sum over it: 600 KiB, then 600 KiB, against 1 MiB.
    const random = Buffer.alloc(600 * 1024);
    for (let i = 0; i < random.length; i++) random[i] = (i * 2654435761) >>> 24;
    const limits = { ...PDF_BOUNDS, maxNonImageDecodedBytes: 1 * MIB };
    await expectRefused(streamPdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(deflateSync(random, { level: 0 }), { level: 0 })), "decoded_too_large", limits);
    const single = await boundPdf(streamPdf(FLATE, deflateSync(random, { level: 0 })), limits);
    expect(single.ok && single.nonImageBytes).toBe(random.length);
  });

  it("refuses an LZW bomb and a run-length bomb as unboundable (security M-5: they are not predicted, they are refused)", async () => {
    await expectRefused(streamPdf("/Filter /LZWDecode", Buffer.alloc(64)), "unbounded_stream");
    const rl = Buffer.alloc(2 * MIB);
    for (let i = 0; i < rl.length; i += 2) rl[i] = 129; // 128 zeros per two bytes: 128 MiB
    await expectRefused(streamPdf("/Filter /RunLengthDecode", rl), "unbounded_stream");
  });

  it("refuses a bomb inside an object stream, and PDFDocument.load is never called", async () => {
    const pdf = streamPdf(`/Type /ObjStm /N 3 /First 10 ${FLATE}`, bomb24MiB);
    await expectRefused(pdf, "decoded_too_large");
    const load = spyOn(PDFDocument, "load");
    try {
      expect(await checkLetterhead(pdf)).toEqual({ ok: false, reason: "decoded_too_large" });
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it("refuses a 1 GiB bomb fast, stopping at the cap instead of inflating it", async () => {
    const pdf = streamPdf(FLATE, bomb1GiB);
    Bun.gc(true);
    const rssBefore = process.memoryUsage().rss;
    const t0 = performance.now();
    const verdict = await boundPdf(pdf);
    const ms = performance.now() - t0;
    const grewMiB = (process.memoryUsage().rss - rssBefore) / MIB;
    console.log(`1 GiB bomb (${(bomb1GiB.length / MIB).toFixed(2)} MiB compressed): ${verdict.ok ? "ok?!" : verdict.reason} in ${ms.toFixed(0)} ms, RSS +${grewMiB.toFixed(1)} MiB`);
    expect(verdict).toEqual({ ok: false, reason: "decoded_too_large" });
    expect(ms).toBeLessThan(2000);
    expect(grewMiB).toBeLessThan(128);
  });

  it("refuses the same bomb in a chain, an image disguise and an object stream just as fast", async () => {
    for (const pdf of [
      streamPdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(bomb1GiB)),
      streamPdf(`/Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 ${FLATE}`, bomb1GiB),
      streamPdf(`/Type /ObjStm /N 1 ${FLATE}`, bomb1GiB),
    ]) {
      const t0 = performance.now();
      expect((await boundPdf(pdf)).ok).toBe(false);
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});

describe("boundPdf: what is not a bomb (AC-11.4)", () => {
  it("accepts a truncated and a checksum-broken stream under the caps, counting what they produced; refuses a broken one", async () => {
    const text = Buffer.from("BT /F1 12 Tf (hello) Tj ET\n".repeat(2000));
    const whole = deflateSync(text);
    const truncated = await boundPdf(streamPdf(FLATE, whole.subarray(0, Math.floor(whole.length / 2))));
    expect(truncated.ok).toBe(true);
    const broken = Buffer.from(whole);
    broken[broken.length - 1] = ~broken[broken.length - 1]! & 0xff;
    const verdict = await boundPdf(streamPdf(FLATE, broken));
    expect(verdict.ok && verdict.nonImageBytes).toBeGreaterThanOrEqual(text.length - 16 * 1024);
    // Garbage is not a truncation: the readers are more lenient than zlib about what follows an error (found by the
    // differential test), so what zlib rejects cannot be counted and is refused.
    await expectRefused(streamPdf(FLATE, Buffer.from("not deflate at all")), "unbounded_stream");
  });

  it("decodes Flate exactly (the figures a refusal is built on), every stage of a chain counted", async () => {
    const data = Buffer.concat([Buffer.from("The quick brown fox. ".repeat(100)), Buffer.alloc(300, 0x61), Buffer.alloc(40, 0), Buffer.from("tail")]);
    for (const filter of ["/FlateDecode", "[/FlateDecode]", "/Fl"]) {
      const verdict = await boundPdf(streamPdf(`/Filter ${filter}`, deflateSync(data)));
      expect(verdict.ok && verdict.nonImageBytes).toBe(data.length);
    }
    const chained = await boundPdf(streamPdf("/Filter [/FlateDecode /FlateDecode]", deflateSync(deflateSync(data))));
    expect(chained.ok && chained.nonImageBytes).toBe(data.length + deflateSync(data).length);
  });

  it("counts an object stream's /N and a stream with no filter costs nothing", async () => {
    const verdict = await boundPdf(file(obj(1, `/Type /ObjStm /N 5 /First 10 ${FLATE}`, deflateSync(Buffer.from("1 0 2 4 << >> << >>"))), obj(2, "/Length 4", Buffer.from("abcd"))));
    expect(verdict).toMatchObject({ ok: true, objects: 7, streams: 2 });
  });

  it("accepts bytes that are no PDF at all (the parser's refusal comes next)", async () => {
    expect(await boundPdf(Buffer.from("hello"))).toMatchObject({ ok: true, objects: 0, streams: 0 });
    expect(await boundPdf(new Uint8Array(0))).toMatchObject({ ok: true });
  });
});

describe("boundPdf: floods", () => {
  const flood = (objects: number, streams = 0) => {
    const parts: Buffer[] = [];
    for (let i = 1; i <= objects; i++) parts.push(i <= streams ? obj(i, "/Length 0", Buffer.alloc(0)) : latin(`${i} 0 obj\n0\nendobj\n`));
    return file(...parts);
  };

  it("refuses 10 001 objects and 1 001 streams, accepts the limits themselves", async () => {
    expect(await boundPdf(flood(10_000))).toMatchObject({ ok: true, objects: 10_000 });
    await expectRefused(flood(10_001), "too_complex");
    expect(await boundPdf(flood(1_000, 1_000))).toMatchObject({ ok: true, streams: 1_000 });
    await expectRefused(flood(1_001, 1_001), "too_complex");
  });

  it("refuses an object stream announcing more objects than allowed", async () => {
    await expectRefused(streamPdf(`/Type /ObjStm /N 20000 ${FLATE}`, deflateSync(Buffer.from("x"))), "too_complex");
  });

  it("does not walk a file of forged object headers and unterminated dictionaries forever", async () => {
    const parts: Buffer[] = [];
    for (let i = 1; i <= 5_000; i++) parts.push(latin(`${i} 0 obj << /A [ ( `));
    parts.push(Buffer.alloc(2 * MIB, 0x20));
    const t0 = performance.now();
    const verdict = await boundPdf(file(...parts));
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(verdict.ok === false ? verdict.reason : "ok").toBe("too_complex");
  });
});

describe("boundPdf: images are costed by what they declare", () => {
  const image = (extra: string, data: Buffer) => streamPdf(`/Type /XObject /Subtype /Image ${extra}`, data);

  it("refuses a DCT image declaring 30 000 x 30 000, and one whose JPEG header is larger than its dictionary", async () => {
    await expectRefused(image("/Width 30000 /Height 30000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", jpeg(30000, 30000)), "image_too_large");
    await expectRefused(image("/Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", jpeg(30000, 30000)), "image_too_large");
    expect(await boundPdf(image("/Width 100 /Height 50 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", jpeg(100, 50)))).toMatchObject({ ok: true, imagePixels: 5000, decodedBytes: 15000 });
  });

  it("refuses a codec image whose size it cannot read", async () => {
    await expectRefused(image("/Filter /DCTDecode", jpeg(10, 10)), "unbounded_stream");
    await expectRefused(image("/Width 10 /Height 10 /Filter /DCTDecode", Buffer.from("not a jpeg")), "unbounded_stream");
    await expectRefused(image("/Width 10 /Height 10 /Filter /JPXDecode", Buffer.from("not a jpx")), "unbounded_stream");
    await expectRefused(image("/Width 10 /Height 10 /Filter /JBIG2Decode", Buffer.from("x")), "unbounded_stream");
    await expectRefused(image("/Width 10 /Height 10 /BitsPerComponent 8 /Filter /Crypt", Buffer.from("x")), "unbounded_stream");
  });

  it("measures a Flate image by its declared size: pixels first, then bytes, then the total", async () => {
    const tiny = deflateSync(Buffer.alloc(10));
    await expectRefused(image(`/Width 7000 /Height 7000 /ColorSpace /DeviceRGB /BitsPerComponent 8 ${FLATE}`, tiny), "image_too_large");
    await expectRefused(image(`/Width 4000 /Height 4000 /ColorSpace /DeviceRGB /BitsPerComponent 8 ${FLATE}`, tiny), "decoded_too_large");
    const limits = { ...PDF_BOUNDS, maxTotalImagePixels: 1500 };
    const one = `/Width 30 /Height 30 /ColorSpace /DeviceGray /BitsPerComponent 8 ${FLATE}`;
    expect(await boundPdf(file(obj(1, `/Subtype /Image ${one}`, tiny)), limits)).toMatchObject({ ok: true, imagePixels: 900 });
    await expectRefused(file(obj(1, `/Subtype /Image ${one}`, tiny), obj(2, `/Subtype /Image ${one}`, tiny)), "image_too_large", limits);
    await expectRefused(image(`${FLATE} /ColorSpace /DeviceGray`, tiny), "unbounded_stream");
  });

  it("does not let a tiny declared size hide a page's worth of data (an image in name only)", async () => {
    await expectRefused(image(`/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 ${FLATE}`, bomb24MiB), "decoded_too_large");
    // Two such disguises (5 MiB each), each under the non-image cap alone and over it together: what lies beyond is charged.
    const fourMiB = await zerosDeflated(5);
    const disguise = `/Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 ${FLATE}`;
    expect((await boundPdf(image(disguise, fourMiB))).ok).toBe(true);
    await expectRefused(file(obj(1, `/Subtype /Image ${disguise}`, fourMiB), obj(2, `/Subtype /Image ${disguise}`, fourMiB)), "decoded_too_large");
    // A real image with a PNG-style predictor row byte per row is not an excess.
    const rows = Buffer.alloc((20 * 3 + 1) * 20);
    expect(await boundPdf(image(`/Width 20 /Height 20 /ColorSpace /DeviceRGB /BitsPerComponent 8 ${FLATE}`, deflateSync(rows)))).toMatchObject({ ok: true, nonImageBytes: 0 });
  });
});

describe("boundPdf: refuses what it cannot bound", () => {
  it("refuses a duplicated key, an unknown filter, and a filter it cannot read", async () => {
    await expectRefused(streamPdf("/Filter /FlateDecode /Filter /ASCIIHexDecode", asciiHex(Buffer.from("x"))), "unbounded_stream");
    await expectRefused(streamPdf("/Filter /Crypt", Buffer.from("x")), "unbounded_stream");
    await expectRefused(streamPdf("/Filter [/FlateDecode /Surprise]", Buffer.from("x")), "unbounded_stream");
    await expectRefused(streamPdf("/Filter 9 0 R", Buffer.from("x")), "unbounded_stream");
    await expectRefused(streamPdf("/Filter [/DCTDecode /FlateDecode]", Buffer.from("x")), "unbounded_stream");
  });
});

describe("boundPdf: real letterheads", () => {
  it("accepts the committed A4 letterhead, with its figures", async () => {
    const bytes = readFileSync(new URL("../../../shell/e2e/fixtures/letterhead-a4.pdf", import.meta.url));
    const verdict = await boundPdf(bytes);
    console.log("letterhead-a4.pdf", JSON.stringify(verdict));
    expect(verdict.ok).toBe(true);
    expect(await checkLetterhead(bytes)).toEqual({ ok: true });
  });

  it("accepts a pdf-lib letterhead with a logo image, its figures far under every cap", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    const logo = await doc.embedPng(png(120, 60));
    page.drawImage(logo, { x: 40, y: 760, width: 120, height: 60 });
    page.drawText("wellD SA", { x: 40, y: 740, size: 12 });
    const bytes = await doc.save({ useObjectStreams: false });
    const verdict = await boundPdf(bytes);
    console.log("pdf-lib letterhead with logo", JSON.stringify(verdict));
    expect(verdict).toMatchObject({ ok: true, imagePixels: 7200 });
    if (verdict.ok) {
      expect(verdict.decodedBytes * 4).toBeLessThan(PDF_BOUNDS.maxDecodedBytes);
      expect(verdict.nonImageBytes * 4).toBeLessThan(PDF_BOUNDS.maxNonImageDecodedBytes);
    }
    expect(await checkLetterhead(bytes)).toEqual({ ok: true });
    // The default save packs objects into object streams: the same file, bounded the same.
    const packed = await boundPdf(await doc.save());
    console.log("same, with object streams", JSON.stringify(packed));
    expect(packed.ok).toBe(true);
  });
});

describe("boundPdf: damaged input never throws or hangs", () => {
  it("answers a verdict for 300 random corruptions and truncations of a real letterhead", async () => {
    const original = readFileSync(new URL("../../../shell/e2e/fixtures/letterhead-a4.pdf", import.meta.url));
    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const t0 = performance.now();
    for (let round = 0; round < 300; round++) {
      const copy = Buffer.from(original);
      for (let k = 0; k < 1 + rand(8); k++) copy[rand(copy.length)] = rand(256);
      const bytes = round % 3 === 0 ? copy.subarray(0, rand(copy.length)) : copy;
      const verdict = await boundPdf(bytes);
      expect(typeof verdict.ok).toBe("boolean");
    }
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
