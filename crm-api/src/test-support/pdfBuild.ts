/**
 * Builders for the hostile PDFs of the security rounds (specs/20261115-crm-offer-wizard, M-4 to M-7). Every file is
 * built in memory by the test that needs it; nothing large is committed. The hand-built files carry an xref table, so
 * pdf-lib and pdf.js read them as ordinary one-page PDFs.
 */

import { once } from "node:events";
import { createDeflate, deflateSync } from "node:zlib";

export const MIB = 1024 * 1024;
export const latin = (s: string) => Buffer.from(s, "latin1");

export interface RawObject {
  /** The exact header text, e.g. `4 0 obj` or `4 %x⏎0 obj`. */
  readonly header: string;
  readonly body: Buffer;
}

/** A PDF with an xref table; `objs` are objects 1.. in order, object 1 the catalog. */
export function build(objs: readonly RawObject[]): Buffer {
  const parts: Buffer[] = [latin("%PDF-1.4\n")];
  let off = parts[0]!.length;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(off);
    const b = Buffer.concat([latin(`${o.header}\n`), o.body, latin("\nendobj\n")]);
    parts.push(b);
    off += b.length;
  }
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(latin(xref));
  return Buffer.concat(parts);
}

export const stream = (dict: string, data: Buffer) =>
  Buffer.concat([latin(`<< ${dict} /Length ${data.length} >>\nstream\n`), data, latin("\nendstream")]);

const CATALOG: RawObject = { header: "1 0 obj", body: latin("<< /Type /Catalog /Pages 2 0 R >>") };
const PAGES: RawObject = { header: "2 0 obj", body: latin("<< /Type /Pages /Kids [3 0 R] /Count 1 >>") };
const page = (resources = "<< >>") =>
  latin(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Contents 4 0 R /Resources ${resources} >>`);

/** A valid one-page A4 PDF whose content object (object 4) has the given header and filter. */
export function contentPdf(contentHeader: string, content: Buffer, filter = "/Filter /FlateDecode"): Buffer {
  return build([CATALOG, PAGES, { header: "3 0 obj", body: page() }, { header: contentHeader, body: stream(filter, content) }]);
}

/** `mib` MiB of the byte `fill`, deflated by streaming (the bomb itself is never held decoded). */
export async function deflatedRun(mib: number, fill = 0x20): Promise<Buffer> {
  const deflate = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  deflate.on("data", (c: Buffer) => chunks.push(c));
  const block = Buffer.alloc(MIB, fill);
  for (let i = 0; i < mib; i++) if (!deflate.write(block)) await once(deflate, "drain");
  deflate.end();
  await once(deflate, "end");
  return Buffer.concat(chunks);
}

/**
 * An LZW stream whose every code after the first is a "future" code (security M-5b): pdf.js and pdf-lib decode each as
 * the previous sequence plus its first byte, one byte longer every time, about 7.4 MB per cycle.
 */
export function lzwFutureCodes(cycles: number): Buffer {
  let acc = 0n;
  let bits = 0n;
  const out: number[] = [];
  const put = (code: number, width: number) => {
    acc = (acc << BigInt(width)) | BigInt(code);
    bits += BigInt(width);
    while (bits >= 8n) {
      bits -= 8n;
      out.push(Number((acc >> bits) & 0xffn));
      acc &= (1n << bits) - 1n;
    }
  };
  for (let c = 0; c < cycles; c++) {
    let next = 258;
    let width = 9;
    put(32, width);
    while (next <= 4094) {
      put((1 << width) - 1, width);
      next++;
      const n = next + 1;
      width = n & (n - 1) ? width : Math.min(Math.floor(Math.log2(n)) + 1, 12);
    }
    put(256, width);
  }
  put(257, 9);
  if (bits > 0n) out.push(Number((acc << (8n - bits)) & 0xffn));
  return Buffer.from(out);
}

/**
 * ASCII85 whose digits are non-canonical (security M-5c): a reader takes every non-space byte as `c - 33` with no range
 * check, so one value can be written with a digit carried (`d_i - 1`, `d_{i+1} + 85`, a byte above 117).
 */
export function ascii85Carried(data: Buffer): Buffer {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const out: number[] = [];
  for (let o = 0; o < padded.length; o += 4) {
    let w = padded.readUInt32BE(o);
    const d = [0, 0, 0, 0, 0];
    for (let i = 4; i >= 0; i--) {
      d[i] = w % 85;
      w = Math.floor(w / 85);
    }
    for (let i = 0; i < 4; i++) {
      if (d[i]! > 0 && d[i + 1]! + 85 + 33 !== 126) {
        d[i]!--;
        d[i + 1]! += 85;
        break;
      }
    }
    for (const x of d) out.push(x + 33);
  }
  out.push(0x7e, 0x3e);
  return Buffer.from(out);
}

export { deflateSync };

/**
 * A page whose content calls Form XObject F1 `fan` times, F1 calls F2 `fan` times, … down `levels` forms, the last
 * drawing one line (security M-6). Cost is the product of the fan-outs.
 */
export function formFanOutPdf(levels: number, fan: number): Buffer {
  const call = "/F Do\n".repeat(fan);
  const objs: RawObject[] = [
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page("<< /XObject << /F 5 0 R >> >>") },
    { header: "4 0 obj", body: stream("", latin(call)) },
  ];
  for (let l = 0; l < levels; l++) {
    const num = 5 + l;
    const last = l === levels - 1;
    objs.push({
      header: `${num} 0 obj`,
      body: stream(
        `/Type /XObject /Subtype /Form /BBox [0 0 600 850] ${last ? "" : `/Resources << /XObject << /F ${num + 1} 0 R >> >>`}`,
        latin(last ? "0 0 m 1 1 l S\n" : call),
      ),
    });
  }
  return build(objs);
}

/** A one-page PDF whose only extra object is an object stream holding a `mib` MiB Flate bomb (security M-7). */
export function objStmBombPdf(bomb: Buffer): Buffer {
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: latin("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] >>") },
    { header: "4 0 obj", body: stream("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", bomb) },
  ]);
}

export { CATALOG, PAGES, page };
