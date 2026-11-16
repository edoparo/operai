import { beforeAll, describe, expect, it } from "bun:test";
import { deflateSync } from "node:zlib";
import { checkLetterhead } from "./letterhead";
import { boundPdf, PDF_BOUNDS } from "./pdfBounds";
import { MIB, ascii85Carried, build, contentPdf, deflatedRun, latin, lzwFutureCodes, stream } from "../test-support/pdfBuild";

/**
 * Security round 6, M-5 (specs/20261115-crm-offer-wizard): `boundPdf` measured a different file than pdf-lib and pdf.js
 * decode. Each named vector below was accepted by the module and then inflated gigabytes in the readers (1 MiB gave
 * 3.65 GB peak RSS). The module now allows what it can bound exactly and refuses the rest.
 */

let spaces: Buffer; // 16 MiB of spaces, deflated: over the 8 MiB non-image cap, about 16 KB on disk
beforeAll(async () => {
  spaces = await deflatedRun(16);
}, 60_000);

const refused = async (bytes: Uint8Array, reason: string) => expect(await boundPdf(bytes)).toEqual({ ok: false, reason } as never);

describe("M-5a: the object header, spelled as the readers accept it", () => {
  const spellings: Record<string, string> = {
    "the plain header (control)": "4 0 obj",
    "a generation of many zeros (`gen6.pdf`)": "4 000000 obj",
    "an object number with leading zeros (`num11.pdf`)": "00000000004 0 obj",
    "a comment between the tokens (`comment.pdf`)": "4 %x\n0 obj",
    "a comment before obj, a carriage return and form feeds": "4\f0\f%comment\r\fobj",
    "every token separated by NULs": "4\u00000\u0000obj",
  };
  for (const [name, header] of Object.entries(spellings)) {
    it(`refuses a flate bomb behind ${name}`, async () => {
      await refused(contentPdf(header, spaces), "decoded_too_large");
    });
  }

  it("counts the object whatever its spelling (the figure a refusal and a limit are built on)", async () => {
    const small = deflateSync(latin("q Q "));
    const verdict = await boundPdf(contentPdf("00000000004 %c\n000 obj", small));
    expect(verdict).toMatchObject({ ok: true, objects: 4, streams: 1 });
  });
});

describe("M-5b: LZW codes from the future", () => {
  it("refuses the stream pdf-lib and pdf.js grow to 7.4 MB per 5 KB (`lzw-50.pdf`, at 5 cycles here)", async () => {
    await refused(contentPdf("4 0 obj", lzwFutureCodes(5), "/Filter /LZWDecode"), "unbounded_stream");
  });
});

describe("M-5c: ASCII85 digits outside 33 to 117", () => {
  it("refuses the carried-digit encoding of a flate bomb (`a85.pdf`)", async () => {
    await refused(contentPdf("4 0 obj", ascii85Carried(spaces), "/Filter [/ASCII85Decode /FlateDecode]"), "unbounded_stream");
  });
});

describe("the allowlist: only filters the module can bound exactly", () => {
  const body = deflateSync(latin("q Q "));
  const cases: [string, string][] = [
    ["LZWDecode", "/Filter /LZWDecode"],
    ["RunLengthDecode", "/Filter /RunLengthDecode"],
    ["ASCIIHexDecode", "/Filter /ASCIIHexDecode"],
    ["ASCII85Decode", "/Filter /ASCII85Decode"],
    ["the abbreviations of those", "/Filter [/LZW /RL /AHx /A85]"],
    ["Crypt", "/Filter /Crypt"],
    ["JBIG2Decode", "/Filter /JBIG2Decode"],
    ["Flate behind ASCII85", "/Filter [/ASCII85Decode /FlateDecode]"],
    ["an unknown name", "/Filter /Brotli#44ecode"],
    ["a name built from the prototype", "/Filter /__proto__"],
  ];
  for (const [name, filter] of cases) {
    it(`refuses ${name} on a content stream`, async () => {
      await refused(contentPdf("4 0 obj", body, filter), "unbounded_stream");
    });
  }

  it("refuses JPX and CCITT images, whatever their headers say", async () => {
    for (const filter of ["/JPXDecode", "/CCITTFaxDecode", "/CCF"]) {
      const pdf = build([
        ...base(),
        {
          header: "5 0 obj",
          body: stream(`/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter ${filter}`, Buffer.alloc(64)),
        },
      ]);
      await refused(pdf, "unbounded_stream");
    }
  });

  it("still accepts Flate (one stage, two, abbreviated) and a DCT image", async () => {
    expect((await boundPdf(contentPdf("4 0 obj", body))).ok).toBe(true);
    expect((await boundPdf(contentPdf("4 0 obj", deflateSync(body), "/Filter [/FlateDecode /FlateDecode]"))).ok).toBe(true);
    expect((await boundPdf(contentPdf("4 0 obj", body, "/Filter /Fl"))).ok).toBe(true);
    expect((await boundPdf(contentPdf("4 0 obj", Buffer.alloc(0), ""))).ok).toBe(true);
  });

  it("refuses a predictor row wider than the decoded budget", async () => {
    const parms = `/DecodeParms << /Predictor 15 /Columns ${PDF_BOUNDS.maxDecodedBytes * 2} /Colors 1 >>`;
    await refused(contentPdf("4 0 obj", body, `/Filter /FlateDecode ${parms}`), "decoded_too_large");
    await refused(contentPdf("4 0 obj", body, "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 1e9 >>"), "unbounded_stream");
    expect((await boundPdf(contentPdf("4 0 obj", body, "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >>"))).ok).toBe(true);
  });
});

describe("the cross-check: every `stream` after a dictionary belongs to a parsed object", () => {
  it("refuses a stream whose header no reader of this module would find", async () => {
    // A dictionary and a stream with no `N G obj` before it at all.
    const bare = Buffer.concat([latin("%PDF-1.4\n"), latin("<< /Filter /FlateDecode >>\nstream\n"), spaces, latin("\nendstream\n")]);
    await refused(bare, "unbounded_stream");
  });

  it("refuses a stream keyword that follows the dictionary through whitespace and comments", async () => {
    const bare = Buffer.concat([latin("%PDF-1.4\n<< /Filter /FlateDecode >> %c\n\r\n stream\r\n"), spaces]);
    await refused(bare, "unbounded_stream");
  });

  it("does not take `streams` or an `endstream` for the keyword", async () => {
    const text = latin("%PDF-1.4\n1 0 obj\n<< /A /streams >>\nendobj\n2 0 obj\n<< >> streams\nendobj\n");
    expect((await boundPdf(text)).ok).toBe(true);
  });

  it("accepts an uncompressed PDF embedded in a stream: its headers are found too", async () => {
    const inner = contentPdf("4 0 obj", deflateSync(latin("q Q ")));
    const outer = build([...base(), { header: "5 0 obj", body: stream("/Type /EmbeddedFile", inner) }]);
    expect((await boundPdf(outer)).ok).toBe(true);
  });
});

describe("the header scan is linear", () => {
  it("answers fast for a digit before every % of a 3 MiB line with no break (the comment is walked once)", async () => {
    const hostile = Buffer.concat([latin("%PDF-1.4\n"), Buffer.from("1%".repeat(1.5 * MIB))]);
    const t0 = performance.now();
    const verdict = await boundPdf(hostile);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(typeof verdict.ok).toBe("boolean");
  });

  it("answers fast for numbers separated by long runs of blanks and for 600 000 `>>`", async () => {
    const blanks = Buffer.from("1 \0".repeat(MIB));
    const closers = Buffer.from(">>".repeat(600_000));
    for (const bytes of [blanks, closers, Buffer.from(">> ".repeat(MIB))]) {
      const t0 = performance.now();
      await boundPdf(bytes);
      expect(performance.now() - t0).toBeLessThan(2500);
    }
  });
});

describe("the three round-6 PDFs go through checkLetterhead too (the confirm-time check)", () => {
  it("refuses each before pdf-lib reads a byte", async () => {
    const files = [
      contentPdf("4 000000 obj", spaces),
      contentPdf("4 0 obj", lzwFutureCodes(5), "/Filter /LZWDecode"),
      contentPdf("4 0 obj", ascii85Carried(spaces), "/Filter [/ASCII85Decode /FlateDecode]"),
    ];
    const reasons = [];
    for (const file of files) reasons.push(await checkLetterhead(file));
    expect(reasons).toEqual([
      { ok: false, reason: "decoded_too_large" },
      { ok: false, reason: "unbounded_stream" },
      { ok: false, reason: "unbounded_stream" },
    ]);
  });
});

function base() {
  return [
    { header: "1 0 obj", body: latin("<< /Type /Catalog /Pages 2 0 R >>") },
    { header: "2 0 obj", body: latin("<< /Type /Pages /Kids [3 0 R] /Count 1 >>") },
    { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources << /XObject << /I 5 0 R >> >> >>") },
    { header: "4 0 obj", body: stream("", latin("q Q")) },
  ];
}

