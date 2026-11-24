/**
 * A dependency-free `.xlsx` reader for an operator's data import (T7, specs/20261124-receipt-numbers-from-the-register;
 * ADR 20261124-operator-data-imports-read-the-source-workbook-directly-...). It turns ONE worksheet of an untrusted file into
 * cell values and nothing more: a formula is never evaluated, a style is never read, an external reference is never followed.
 *
 * What it refuses, always with a fixed message of {@link REFUSALS} (a named reason, never a cell, a name or an amount):
 * ZIP64, encryption, any ZIP method but stored and deflate, more than 10,000 entries, a compressed file over 20 MiB, an entry
 * over 64 MiB inflated, a CRC mismatch, a `<!DOCTYPE`, any entity but the five predefined and numeric references, markup deeper
 * than 64 levels, an error cell, a formula with no cached value.
 *
 * Independent of `src/accounting/xlsx.ts` (the writer) and of `src/test-support/xlsxReader.ts` (the test-only reader): neither
 * is imported, so a test that writes with one and reads with another checks both.
 */

import * as zlib from "node:zlib";

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_CELLS = 2_000_000;
const MAX_MERGED_CELLS = 200_000;
const MAX_ROW = 1_048_576;
const MAX_COLUMN = 16_384;

// ─── Refusals ────────────────────────────────────────────────────────────────

const SAVE_AGAIN = "Save the workbook again as .xlsx in Excel and retry.";

/** Every reason the reader gives, with its fixed message. A message never carries a value taken from the file. */
export const REFUSALS = {
  "file-too-large": `The workbook file is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MiB. ${SAVE_AGAIN}`,
  "not-a-zip": `The file is not a readable .xlsx (no ZIP directory found). ${SAVE_AGAIN}`,
  zip64: `The workbook uses ZIP64, which is not supported. ${SAVE_AGAIN}`,
  encrypted: `The workbook is encrypted or password-protected, which is not supported. Remove the protection in Excel and retry.`,
  "unsupported-method": `The workbook uses a ZIP compression method other than stored or deflate. ${SAVE_AGAIN}`,
  "too-many-entries": `The workbook holds more than ${MAX_ENTRIES} ZIP entries. ${SAVE_AGAIN}`,
  "entry-too-large": `A part of the workbook is larger than ${MAX_ENTRY_BYTES / (1024 * 1024)} MiB inflated. ${SAVE_AGAIN}`,
  "crc-mismatch": `A part of the workbook failed its checksum (the file is damaged). ${SAVE_AGAIN}`,
  "zip-structure": `The workbook's ZIP structure is inconsistent. ${SAVE_AGAIN}`,
  "corrupt-entry": `A part of the workbook could not be decompressed. ${SAVE_AGAIN}`,
  "missing-part": `The workbook lacks a part this reader needs. ${SAVE_AGAIN}`,
  "doctype-refused": `The workbook contains a document type declaration, which is refused. ${SAVE_AGAIN}`,
  "xml-malformed": `A part of the workbook is not well-formed XML. ${SAVE_AGAIN}`,
  "xml-unsupported": `A part of the workbook uses an XML construct this reader does not accept. ${SAVE_AGAIN}`,
  "xml-too-deep": `A part of the workbook is nested too deeply. ${SAVE_AGAIN}`,
  "entity-refused": `A part of the workbook uses an XML entity other than the five predefined ones. ${SAVE_AGAIN}`,
  "sheet-not-found": `The requested sheet is not in the workbook.`,
  "cell-reference": `A cell of the sheet has an invalid or out-of-range reference. ${SAVE_AGAIN}`,
  "too-many-cells": `The sheet holds more than ${MAX_CELLS} cells. ${SAVE_AGAIN}`,
  "merge-too-large": `The sheet's merged ranges cover too many cells. ${SAVE_AGAIN}`,
  "shared-string-index": `A cell points at a shared string that does not exist. ${SAVE_AGAIN}`,
} as const;

export type XlsxRefusalCode = keyof typeof REFUSALS;

/** The only error this module throws for a file it will not read. `message` is fixed per `code`. */
export class XlsxRefusal extends Error {
  readonly code: XlsxRefusalCode;
  constructor(code: XlsxRefusalCode) {
    super(REFUSALS[code]);
    this.name = "XlsxRefusal";
    this.code = code;
  }
}

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | undefined;

function crc32(bytes: Uint8Array): number {
  const native = (zlib as { crc32?: (data: Uint8Array) => number }).crc32;
  if (typeof native === "function") return native(bytes) >>> 0;
  if (crcTable === undefined) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

interface ZipMember {
  readonly name: string;
  readonly method: 0 | 8;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const decoder = new TextDecoder("utf-8", { fatal: true });

/** The members of the archive, every one checked against the refusals; nothing is inflated yet. */
function readDirectory(bytes: Uint8Array): { members: Map<string, ZipMember>; directoryStart: number } {
  if (bytes.length > MAX_FILE_BYTES) throw new XlsxRefusal("file-too-large");
  if (bytes.length < 22) throw new XlsxRefusal("not-a-zip");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === SIG_EOCD && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new XlsxRefusal("not-a-zip");

  if (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR) throw new XlsxRefusal("zip64");
  const disk = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesHere = view.getUint16(eocd + 8, true);
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryStart = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryStart === 0xffffffff) throw new XlsxRefusal("zip64");
  if (entries > MAX_ENTRIES) throw new XlsxRefusal("too-many-entries");
  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== entries) throw new XlsxRefusal("zip-structure");
  if (directoryStart + directorySize > eocd) throw new XlsxRefusal("zip-structure");

  const members = new Map<string, ZipMember>();
  let at = directoryStart;
  const end = directoryStart + directorySize;
  for (let i = 0; i < entries; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== SIG_CENTRAL) throw new XlsxRefusal("zip-structure");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    if (at + 46 + nameLength + extraLength + commentLength > end) throw new XlsxRefusal("zip-structure");
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0 || method === 99) throw new XlsxRefusal("encrypted");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new XlsxRefusal("zip64");
    if (method !== 0 && method !== 8) throw new XlsxRefusal("unsupported-method");
    if (size > MAX_ENTRY_BYTES) throw new XlsxRefusal("entry-too-large");
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new XlsxRefusal("zip-structure");
    }
    if (members.has(name)) throw new XlsxRefusal("zip-structure");
    members.set(name, { name, method, crc, compressedSize, size, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { members, directoryStart };
}

/** The bytes of one member, inflated within the cap and checked against its CRC. */
function extract(bytes: Uint8Array, member: ZipMember, directoryStart: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = member.localOffset;
  if (at + 30 > directoryStart || view.getUint32(at, true) !== SIG_LOCAL) throw new XlsxRefusal("zip-structure");
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  if (start + member.compressedSize > directoryStart) throw new XlsxRefusal("zip-structure");
  const localName = bytes.subarray(at + 30, at + 30 + nameLength);
  let sameName: boolean;
  try {
    sameName = decoder.decode(localName) === member.name;
  } catch {
    sameName = false;
  }
  if (!sameName) throw new XlsxRefusal("zip-structure");

  const raw = bytes.subarray(start, start + member.compressedSize);
  let data: Uint8Array;
  if (member.method === 0) {
    if (member.compressedSize !== member.size) throw new XlsxRefusal("zip-structure");
    data = raw;
  } else if (member.size === 0) {
    data = new Uint8Array(0);
  } else {
    try {
      data = zlib.inflateRawSync(raw, { maxOutputLength: member.size });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ERR_BUFFER_TOO_LARGE" || error instanceof RangeError) throw new XlsxRefusal("entry-too-large");
      throw new XlsxRefusal("corrupt-entry");
    }
  }
  if (data.length !== member.size) throw new XlsxRefusal("zip-structure");
  if (crc32(data) !== member.crc) throw new XlsxRefusal("crc-mismatch");
  return data;
}

// ─── XML tokenizer ───────────────────────────────────────────────────────────

interface XmlHandler {
  open(name: string, attributes: Readonly<Record<string, string>>, selfClosing: boolean): void;
  close(name: string): void;
  text(value: string): void;
}

function localName(qualified: string): string {
  const colon = qualified.indexOf(":");
  return colon < 0 ? qualified : qualified.slice(colon + 1);
}

/** The five predefined entities and numeric character references; any other `&` is refused. */
function decodeEntities(value: string): string {
  let at = value.indexOf("&");
  if (at < 0) return value;
  let out = "";
  let from = 0;
  while (at >= 0) {
    const semicolon = value.indexOf(";", at);
    if (semicolon < 0 || semicolon - at > 10) throw new XlsxRefusal("entity-refused");
    const body = value.slice(at + 1, semicolon);
    let replacement: string;
    switch (body) {
      case "amp":
        replacement = "&";
        break;
      case "lt":
        replacement = "<";
        break;
      case "gt":
        replacement = ">";
        break;
      case "quot":
        replacement = '"';
        break;
      case "apos":
        replacement = "'";
        break;
      default: {
        const hex = /^#x([0-9a-fA-F]{1,6})$/.exec(body);
        const dec = /^#([0-9]{1,7})$/.exec(body);
        const cp = hex !== null ? parseInt(hex[1]!, 16) : dec !== null ? parseInt(dec[1]!, 10) : -1;
        const valid =
          cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
        if (!valid) throw new XlsxRefusal("entity-refused");
        replacement = String.fromCodePoint(cp);
      }
    }
    out += value.slice(from, at) + replacement;
    from = semicolon + 1;
    at = value.indexOf("&", from);
  }
  return out + value.slice(from);
}

const ATTRIBUTE = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const TAG_END = /\s*(\/?)>/y;

/** A non-recursive, forward-only tokenizer. Elements arrive by local name; the nesting depth is bounded. */
function parseXml(bytes: Uint8Array, handler: XmlHandler): void {
  let xml: string;
  try {
    xml = decoder.decode(bytes);
  } catch {
    throw new XlsxRefusal("xml-malformed");
  }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const stack: string[] = [];
  let at = 0;
  while (at < xml.length) {
    const lt = xml.indexOf("<", at);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > at) {
      if (stack.length === 0) {
        if (xml.slice(at, textEnd).trim() !== "") throw new XlsxRefusal("xml-malformed");
      } else {
        handler.text(decodeEntities(xml.slice(at, textEnd)));
      }
    }
    if (lt < 0) break;
    at = lt;
    if (xml.startsWith("<!--", at)) {
      const close = xml.indexOf("-->", at + 4);
      if (close < 0) throw new XlsxRefusal("xml-malformed");
      at = close + 3;
    } else if (xml.startsWith("<![CDATA[", at)) {
      const close = xml.indexOf("]]>", at + 9);
      if (close < 0 || stack.length === 0) throw new XlsxRefusal("xml-malformed");
      handler.text(xml.slice(at + 9, close));
      at = close + 3;
    } else if (xml.startsWith("<!", at)) {
      throw new XlsxRefusal(/^<!DOCTYPE/i.test(xml.slice(at, at + 9)) ? "doctype-refused" : "xml-unsupported");
    } else if (xml.startsWith("<?", at)) {
      const close = xml.indexOf("?>", at + 2);
      if (close < 0) throw new XlsxRefusal("xml-malformed");
      at = close + 2;
    } else if (xml.startsWith("</", at)) {
      const close = xml.indexOf(">", at + 2);
      if (close < 0) throw new XlsxRefusal("xml-malformed");
      const name = localName(xml.slice(at + 2, close).trim());
      if (stack.pop() !== name) throw new XlsxRefusal("xml-malformed");
      handler.close(name);
      at = close + 1;
    } else {
      let nameEnd = at + 1;
      while (nameEnd < xml.length && !/[\s/>]/.test(xml[nameEnd]!)) nameEnd++;
      const name = localName(xml.slice(at + 1, nameEnd));
      if (name === "") throw new XlsxRefusal("xml-malformed");
      const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
      let cursor = nameEnd;
      for (;;) {
        ATTRIBUTE.lastIndex = cursor;
        const match = ATTRIBUTE.exec(xml);
        if (match === null) break;
        attributes[localName(match[1]!)] = decodeEntities(match[2] ?? match[3] ?? "");
        cursor = ATTRIBUTE.lastIndex;
      }
      TAG_END.lastIndex = cursor;
      const end = TAG_END.exec(xml);
      if (end === null) throw new XlsxRefusal("xml-malformed");
      const selfClosing = end[1] === "/";
      if (stack.length >= MAX_XML_DEPTH) throw new XlsxRefusal("xml-too-deep");
      if (!selfClosing) stack.push(name);
      handler.open(name, attributes, selfClosing);
      if (selfClosing) handler.close(name);
      at = TAG_END.lastIndex;
    }
  }
  if (stack.length !== 0) throw new XlsxRefusal("xml-malformed");
}

// ─── Cells ───────────────────────────────────────────────────────────────────

/**
 * What a cell holds, exactly as stored.
 * - `text`: a string (shared, inline or a formula's cached string);
 * - `number`: the `<v>` text unchanged (`24.5`, `1.0049999999999999`, `4.6083E4`), never a float, so the caller rounds on the decimal string;
 * - `bool`: `"1"` or `"0"`;
 * - `isoDate`: a `t="d"` cell's ISO 8601 text;
 * - `unreadable`: an error cell, or a formula with no cached value (`why`).
 * An empty cell is not stored.
 */
export type XlsxCellValue =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: string }
  | { readonly kind: "bool"; readonly value: string }
  | { readonly kind: "isoDate"; readonly value: string }
  | { readonly kind: "unreadable"; readonly why: "error" | "formula-without-value" | "not-a-number" };

export interface XlsxSheet {
  /** Whether the workbook counts dates from 1904. */
  readonly date1904: boolean;
  /** Row number (1-based) → column number (1-based, A = 1) → value. Merged ranges are already propagated. */
  readonly rows: ReadonlyMap<number, ReadonlyMap<number, XlsxCellValue>>;
}

/** `A` → 1, `AA` → 27. Throws a refusal for anything beyond XFD. */
export function columnNumber(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) throw new XlsxRefusal("cell-reference");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  if (n > MAX_COLUMN) throw new XlsxRefusal("cell-reference");
  return n;
}

function parseReference(ref: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([0-9]{1,7})$/.exec(ref);
  if (match === null) throw new XlsxRefusal("cell-reference");
  const row = parseInt(match[2]!, 10);
  if (row < 1 || row > MAX_ROW) throw new XlsxRefusal("cell-reference");
  return { row, column: columnNumber(match[1]!) };
}

const NUMERIC = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

// ─── Parts ───────────────────────────────────────────────────────────────────

function readSharedStrings(bytes: Uint8Array): string[] {
  const strings: string[] = [];
  let current: string | undefined;
  let inText = false;
  let phonetic = 0;
  parseXml(bytes, {
    open(name) {
      if (name === "si") current = "";
      else if (name === "rPh") phonetic++;
      else if (name === "t" && current !== undefined && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === "si") {
        strings.push(current ?? "");
        current = undefined;
      } else if (name === "rPh") phonetic--;
      else if (name === "t") inText = false;
    },
    text(value) {
      if (inText && current !== undefined) current += value;
    },
  });
  return strings;
}

function readWorksheet(bytes: Uint8Array, strings: readonly string[]): Map<number, Map<number, XlsxCellValue>> {
  const rows = new Map<number, Map<number, XlsxCellValue>>();
  const merges: string[] = [];
  let cells = 0;
  let rowNumber = 0;
  let nextColumn = 1;
  let cell: { row: number; column: number; type: string; v: string | undefined; inline: string; hasFormula: boolean } | undefined;
  let capture: "v" | "is" | undefined;
  let inInlineText = false;
  let phonetic = 0;
  let inFormula = false;

  const store = (row: number, column: number, value: XlsxCellValue): void => {
    let line = rows.get(row);
    if (line === undefined) {
      line = new Map();
      rows.set(row, line);
    }
    line.set(column, value);
  };

  const finish = (c: NonNullable<typeof cell>): void => {
    let value: XlsxCellValue | undefined;
    switch (c.type) {
      case "s": {
        if (c.v === undefined || c.v.trim() === "") break;
        const index = /^[0-9]{1,9}$/.test(c.v.trim()) ? parseInt(c.v, 10) : -1;
        const text = index >= 0 ? strings[index] : undefined;
        if (text === undefined) throw new XlsxRefusal("shared-string-index");
        value = { kind: "text", value: text };
        break;
      }
      case "str":
        if (c.v !== undefined) value = { kind: "text", value: c.v };
        break;
      case "inlineStr":
        value = { kind: "text", value: c.inline };
        break;
      case "e":
        value = { kind: "unreadable", why: "error" };
        break;
      case "b":
        if (c.v !== undefined) value = { kind: "bool", value: c.v.trim() === "1" || c.v.trim() === "true" ? "1" : "0" };
        break;
      case "d":
        if (c.v !== undefined) value = { kind: "isoDate", value: c.v.trim() };
        break;
      default:
        if (c.v !== undefined && c.v.trim() !== "") {
          value = NUMERIC.test(c.v.trim()) ? { kind: "number", value: c.v.trim() } : { kind: "unreadable", why: "not-a-number" };
        }
    }
    if (value === undefined && c.hasFormula) value = { kind: "unreadable", why: "formula-without-value" };
    if (value === undefined) return;
    if (++cells > MAX_CELLS) throw new XlsxRefusal("too-many-cells");
    store(c.row, c.column, value);
  };

  parseXml(bytes, {
    open(name, attributes) {
      switch (name) {
        case "row": {
          const r = attributes["r"];
          rowNumber = r !== undefined && /^[0-9]{1,7}$/.test(r) ? parseInt(r, 10) : rowNumber + 1;
          if (rowNumber < 1 || rowNumber > MAX_ROW) throw new XlsxRefusal("cell-reference");
          nextColumn = 1;
          break;
        }
        case "c": {
          const ref = attributes["r"];
          const at = ref !== undefined ? parseReference(ref) : { row: rowNumber, column: nextColumn };
          if (at.column > MAX_COLUMN) throw new XlsxRefusal("cell-reference");
          nextColumn = at.column + 1;
          cell = { ...at, type: attributes["t"] ?? "n", v: undefined, inline: "", hasFormula: false };
          break;
        }
        case "f":
          if (cell !== undefined) {
            cell.hasFormula = true;
            inFormula = true;
          }
          break;
        case "v":
          if (cell !== undefined && !inFormula) {
            capture = "v";
            cell.v = "";
          }
          break;
        case "is":
          if (cell !== undefined) capture = "is";
          break;
        case "rPh":
          phonetic++;
          break;
        case "t":
          if (capture === "is" && phonetic === 0) inInlineText = true;
          break;
        case "mergeCell": {
          const ref = attributes["ref"];
          if (ref !== undefined) merges.push(ref);
          if (merges.length > MAX_ENTRIES) throw new XlsxRefusal("merge-too-large");
          break;
        }
      }
    },
    close(name) {
      switch (name) {
        case "c":
          if (cell !== undefined) finish(cell);
          cell = undefined;
          capture = undefined;
          break;
        case "f":
          inFormula = false;
          break;
        case "v":
        case "is":
          capture = undefined;
          break;
        case "rPh":
          phonetic--;
          break;
        case "t":
          inInlineText = false;
          break;
      }
    },
    text(value) {
      if (cell === undefined) return;
      if (capture === "v") cell.v = (cell.v ?? "") + value;
      else if (capture === "is" && inInlineText) cell.inline += value;
    },
  });

  // Merged ranges: the top-left value is read over the whole range, the way a person reads the sheet.
  let propagated = 0;
  for (const ref of merges) {
    const [from, to] = ref.split(":");
    if (from === undefined) throw new XlsxRefusal("cell-reference");
    const a = parseReference(from);
    const b = parseReference(to ?? from);
    if (b.row < a.row || b.column < a.column) throw new XlsxRefusal("cell-reference");
    const value = rows.get(a.row)?.get(a.column);
    if (value === undefined) continue;
    propagated += (b.row - a.row + 1) * (b.column - a.column + 1);
    if (propagated > MAX_MERGED_CELLS) throw new XlsxRefusal("merge-too-large");
    for (let row = a.row; row <= b.row; row++) {
      for (let column = a.column; column <= b.column; column++) {
        if (rows.get(row)?.has(column) !== true) store(row, column, value);
      }
    }
  }
  return rows;
}

// ─── Public entry point ──────────────────────────────────────────────────────

function resolveTarget(target: string): string {
  const parts: string[] = [];
  for (const part of (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

/** Reads one worksheet, by its name in the workbook (exact match). Throws {@link XlsxRefusal} and nothing else for a file it will not read. */
export function readXlsxSheet(bytes: Uint8Array, sheetName: string): XlsxSheet {
  const { members, directoryStart } = readDirectory(bytes);
  const part = (name: string, required = true): Uint8Array | undefined => {
    const member = members.get(name);
    if (member === undefined) {
      if (required) throw new XlsxRefusal("missing-part");
      return undefined;
    }
    return extract(bytes, member, directoryStart);
  };

  let date1904 = false;
  const sheets: { name: string; rid: string }[] = [];
  parseXml(part("xl/workbook.xml")!, {
    open(name, attributes) {
      if (name === "workbookPr") date1904 = attributes["date1904"] === "1" || attributes["date1904"] === "true";
      else if (name === "sheet" && attributes["name"] !== undefined && attributes["id"] !== undefined) {
        sheets.push({ name: attributes["name"], rid: attributes["id"] });
      }
    },
    close() {},
    text() {},
  });
  const sheet = sheets.find((candidate) => candidate.name === sheetName);
  if (sheet === undefined) throw new XlsxRefusal("sheet-not-found");

  const relationships = new Map<string, string>();
  parseXml(part("xl/_rels/workbook.xml.rels")!, {
    open(name, attributes) {
      if (name === "Relationship" && attributes["Id"] !== undefined && attributes["Target"] !== undefined) {
        relationships.set(attributes["Id"], attributes["Target"]);
      }
    },
    close() {},
    text() {},
  });
  const target = relationships.get(sheet.rid);
  if (target === undefined) throw new XlsxRefusal("missing-part");

  const sharedBytes = part("xl/sharedStrings.xml", false);
  const strings = sharedBytes === undefined ? [] : readSharedStrings(sharedBytes);
  const rows = readWorksheet(part(resolveTarget(target))!, strings);
  return { date1904, rows };
}
