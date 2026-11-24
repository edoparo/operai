/**
 * Synthetic register workbooks for the xlsx reader and the release tests (T7, specs/20261124-receipt-numbers-from-the-register,
 * plan § Register export). It builds the accountant's register shape (`Worker`, `No.`, `Date`, `Total`) from rows of
 * `{ worker, number, date, total }`. Synthetic names only (`Worker Alpha`, ...): never a real person, never a real file's content.
 *
 * With no option the bytes come from the deterministic writer `src/accounting/xlsx.ts`, so the committed header-only fixture
 * (`scripts/fixtures/synthetic-register-header-only.xlsx`) is reproducible byte for byte. With an option the parts are written
 * here, by hand, so a variant can use what the writer deliberately never writes (inline strings, rich text, formulas, merges,
 * 1904 dates, deflate, a DOCTYPE) or what no honest tool writes (a zip bomb, ZIP64, encryption, a bad CRC).
 */

import * as zlib from "node:zlib";
import { escapeXml, columnLetters, crc32, writeXlsx, type XlsxCell, type XlsxSpec } from "../accounting/xlsx";

export interface RegisterRowInput {
  readonly worker: string;
  /** The paper number as the accountant wrote it (`LC26/039`), or empty. */
  readonly number: string;
  /** `YYYY-MM-DD`. Stored as a date serial, the way Excel does. */
  readonly date: string;
  /** An exact decimal (`24.5`, `1.0049999999999999`), stored as a numeric `<v>` as given. */
  readonly total: string;
}

export const REGISTER_HEADERS = ["Worker", "No.", "Date", "Total"] as const;

export interface RegisterWorkbookOptions {
  /** Default `2026`. */
  readonly sheetName?: string;
  /** Compress every part with deflate (method 8). */
  readonly deflate?: boolean;
  /** Shared strings written as rich text: two runs and a phonetic part that must be ignored. */
  readonly richText?: boolean;
  /** Text cells written as inline strings instead of shared strings. */
  readonly inlineStrings?: boolean;
  /** The Total column as formula cells with a cached value (`cached`) or with none (`uncached`). */
  readonly formulas?: "cached" | "uncached";
  /** Date serials of the 1900 system (with its 1900-02-29 quirk) or of the 1904 system. Default 1900. */
  readonly dateSystem?: 1900 | 1904;
  /** A worker cell merged down the following rows of the same worker (the later cells are left out). */
  readonly mergeWorker?: boolean;
  /** Blank rows above the header row, each holding a one-cell title. */
  readonly titleRows?: number;
  /** A `<!DOCTYPE>` declaring an entity, in the worksheet. `entityText` is what the entity expands to (never reaches an error). */
  readonly doctype?: { readonly entityText: string };
  /** An honest bomb is an extra part declaring its true size; a lying one is the worksheet, declared as 1 byte. */
  readonly bomb?: { readonly bytes: number; readonly declared: "honest" | "lying" };
  /** A reason to damage the container. */
  readonly hostile?: "zip64" | "encrypted" | "method12" | "crc" | "many-entries";
}

// ─── Dates ───────────────────────────────────────────────────────────────────

/** The date serial of `YYYY-MM-DD` (from 1900-03-01 on, where the 1900 system has no quirk left to model). */
export function dateSerial(iso: string, system: 1900 | 1904 = 1900): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) throw new RangeError("not an ISO date");
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const epoch = system === 1900 ? Date.UTC(1899, 11, 30) : Date.UTC(1904, 0, 1);
  const serial = Math.round((ms - epoch) / 86_400_000);
  if (system === 1900 && serial < 61) throw new RangeError("dates before 1900-03-01 are not modelled");
  return serial;
}

// ─── The plain workbook, by the deterministic writer ─────────────────────────

const STYLES: XlsxSpec["styles"] = [
  { numFmtId: 0 },
  { numFmtId: 49, quotePrefix: true },
  { numFmtId: 164 },
  { numFmtId: 2 },
  { numFmtId: 49, bold: true, quotePrefix: true },
];

function plainWorkbook(rows: readonly RegisterRowInput[], sheetName: string): Uint8Array {
  const text = (value: string, style = 1): XlsxCell => (value === "" ? { kind: "empty", style: 0 } : { kind: "text", value, style });
  const spec: XlsxSpec = {
    sheetName,
    numFmts: { 164: "yyyy\\-mm\\-dd;@" },
    styles: STYLES,
    columnWidths: [24, 14, 12, 12],
    rows: [
      REGISTER_HEADERS.map((header): XlsxCell => ({ kind: "text", value: header, style: 4 })),
      ...rows.map((row): XlsxCell[] => [
        text(row.worker),
        text(row.number),
        { kind: "number", value: String(dateSerial(row.date)), style: 2 },
        { kind: "number", value: row.total, style: 3 },
      ]),
    ],
  };
  return writeXlsx(spec);
}

// ─── ZIP packing with the freedom to damage it ───────────────────────────────

const encoder = new TextEncoder();

interface PackedEntry {
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc: number;
  /** The bytes as stored in the archive (compressed or not). */
  readonly stored: Uint8Array;
  /** The size declared in both headers. */
  readonly size: number;
}

function packEntry(name: string, data: Uint8Array, deflate: boolean): PackedEntry {
  return {
    name,
    method: deflate ? 8 : 0,
    flags: 0x0800,
    crc: crc32(data),
    stored: deflate ? zlib.deflateRawSync(data, { level: 9 }) : data,
    size: data.length,
  };
}

function pack(entries: readonly PackedEntry[], zip64Marker = false): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const header = (size: number, write: (view: DataView) => void): Uint8Array => {
    const bytes = new Uint8Array(size);
    write(new DataView(bytes.buffer));
    return bytes;
  };
  const offsets: number[] = [];
  for (const entry of entries) {
    offsets.push(length);
    const name = encoder.encode(entry.name);
    push(
      header(30, (v) => {
        v.setUint32(0, 0x04034b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, entry.flags, true);
        v.setUint16(8, entry.method, true);
        v.setUint16(10, 0, true);
        v.setUint16(12, 0x21, true);
        v.setUint32(14, entry.crc, true);
        v.setUint32(18, entry.stored.length, true);
        v.setUint32(22, entry.size, true);
        v.setUint16(26, name.length, true);
        v.setUint16(28, 0, true);
      }),
    );
    push(name);
    push(entry.stored);
  }
  const directoryStart = length;
  entries.forEach((entry, i) => {
    const name = encoder.encode(entry.name);
    push(
      header(46, (v) => {
        v.setUint32(0, 0x02014b50, true);
        v.setUint16(4, 20, true);
        v.setUint16(6, 20, true);
        v.setUint16(8, entry.flags, true);
        v.setUint16(10, entry.method, true);
        v.setUint16(12, 0, true);
        v.setUint16(14, 0x21, true);
        v.setUint32(16, entry.crc, true);
        v.setUint32(20, entry.stored.length, true);
        v.setUint32(24, entry.size, true);
        v.setUint16(28, name.length, true);
        v.setUint32(42, offsets[i]!, true);
      }),
    );
    push(name);
  });
  const directorySize = length - directoryStart;
  if (zip64Marker) {
    push(
      header(20, (v) => {
        v.setUint32(0, 0x07064b50, true);
      }),
    );
  }
  push(
    header(22, (v) => {
      v.setUint32(0, 0x06054b50, true);
      v.setUint16(8, zip64Marker ? 0xffff : entries.length, true);
      v.setUint16(10, zip64Marker ? 0xffff : entries.length, true);
      v.setUint32(12, zip64Marker ? 0xffffffff : directorySize, true);
      v.setUint32(16, zip64Marker ? 0xffffffff : directoryStart, true);
    }),
  );
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ─── The variant workbook, part by part ──────────────────────────────────────

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const bombCache = new Map<number, Uint8Array>();

function bombEntry(name: string, bytes: number, declared: "honest" | "lying"): PackedEntry {
  let stored = bombCache.get(bytes);
  if (stored === undefined) {
    stored = zlib.deflateRawSync(new Uint8Array(bytes), { level: 9 });
    bombCache.set(bytes, stored);
  }
  return { name, method: 8, flags: 0x0800, crc: 0, stored, size: declared === "honest" ? bytes : 1 };
}

function variantWorkbook(rows: readonly RegisterRowInput[], options: RegisterWorkbookOptions): Uint8Array {
  const sheetName = options.sheetName ?? "2026";
  const system = options.dateSystem ?? 1900;
  const titleRows = options.titleRows ?? 0;
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const shared = (value: string): number => {
    let index = stringIndex.get(value);
    if (index === undefined) {
      index = strings.length;
      stringIndex.set(value, index);
      strings.push(value);
    }
    return index;
  };
  const textCell = (ref: string, value: string): string =>
    value === ""
      ? ""
      : options.inlineStrings === true
        ? `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
        : `<c r="${ref}" t="s"><v>${shared(value)}</v></c>`;

  const sheetRows: string[] = [];
  let r = 0;
  for (let i = 0; i < titleRows; i++) {
    r++;
    sheetRows.push(`<row r="${r}">${textCell(`A${r}`, `Synthetic title ${i + 1}`)}</row>`);
  }
  r++;
  sheetRows.push(`<row r="${r}">${REGISTER_HEADERS.map((header, c) => textCell(`${columnLetters(c)}${r}`, header)).join("")}</row>`);

  const merges: string[] = [];
  let mergeStart: number | undefined;
  let mergeWorker = "";
  const closeMerge = (lastRow: number): void => {
    if (mergeStart !== undefined && lastRow > mergeStart) merges.push(`A${mergeStart}:A${lastRow}`);
    mergeStart = undefined;
  };
  for (const row of rows) {
    r++;
    const continuesMerge = options.mergeWorker === true && mergeStart !== undefined && mergeWorker === row.worker;
    if (options.mergeWorker === true && !continuesMerge) {
      closeMerge(r - 1);
      mergeStart = r;
      mergeWorker = row.worker;
    }
    const total =
      options.formulas === "cached"
        ? `<c r="D${r}"><f>ROUND(${escapeXml(row.total)},2)</f><v>${row.total}</v></c>`
        : options.formulas === "uncached"
          ? `<c r="D${r}"><f>ROUND(${escapeXml(row.total)},2)</f></c>`
          : `<c r="D${r}"><v>${row.total}</v></c>`;
    sheetRows.push(
      `<row r="${r}">${continuesMerge ? "" : textCell(`A${r}`, row.worker)}${textCell(`B${r}`, row.number)}` +
        `<c r="C${r}"><v>${dateSerial(row.date, system)}</v></c>${total}</row>`,
    );
  }
  closeMerge(r);

  const doctype = options.doctype === undefined ? "" : `<!DOCTYPE worksheet [<!ENTITY x "${escapeXml(options.doctype.entityText)}">]>\n`;
  const sheet =
    XML +
    doctype +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>${sheetRows.join("")}</sheetData>` +
    (merges.length > 0 ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "") +
    "</worksheet>";

  const items = strings
    .map((value) => {
      if (options.richText !== true || value.length < 2) return `<si><t>${escapeXml(value)}</t></si>`;
      const cut = Math.ceil(value.length / 2);
      return (
        `<si><r><t>${escapeXml(value.slice(0, cut))}</t></r><r><rPr><b/></rPr><t>${escapeXml(value.slice(cut))}</t></r>` +
        `<rPh sb="0" eb="1"><t>PHONETIC-IGNORED</t></rPh></si>`
      );
    })
    .join("");
  const sharedStrings = XML + `<sst xmlns="${NS_MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`;

  const workbook =
    XML +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr${system === 1904 ? ' date1904="1"' : ""}/>` +
    `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels =
    XML +
    `<Relationships xmlns="${NS_PACKAGE_REL}"><Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const contentTypes =
    XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
  const rootRels =
    XML + `<Relationships xmlns="${NS_PACKAGE_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const deflate = options.deflate === true;
  const parts: [string, string][] = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", rels],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/sharedStrings.xml", sharedStrings],
  ];
  const entries = parts.map(([name, text]) => packEntry(name, encoder.encode(text), deflate));
  if (options.bomb?.declared === "honest") entries.push(bombEntry("xl/bomb.bin", options.bomb.bytes, "honest"));
  // A lying bomb is the worksheet itself, so the reader has to inflate it to find out.
  if (options.bomb?.declared === "lying") entries[4] = bombEntry("xl/worksheets/sheet1.xml", options.bomb.bytes, "lying");

  switch (options.hostile) {
    case "encrypted":
      entries[4] = { ...entries[4]!, flags: entries[4]!.flags | 0x1 };
      break;
    case "method12":
      entries[4] = { ...entries[4]!, method: 12 };
      break;
    case "crc":
      entries[4] = { ...entries[4]!, crc: (entries[4]!.crc ^ 0xdeadbeef) >>> 0 };
      break;
    case "many-entries":
      for (let i = 0; i < 10_001; i++) entries.push(packEntry(`pad/${i}.txt`, new Uint8Array(0), false));
      break;
    default:
  }
  return pack(entries, options.hostile === "zip64");
}

// ─── Public ──────────────────────────────────────────────────────────────────

/** A register workbook of the rows given (none gives the header-only fixture). Deterministic: the same input, the same bytes. */
export function buildRegisterWorkbook(rows: readonly RegisterRowInput[], options: RegisterWorkbookOptions = {}): Uint8Array {
  const plain = Object.values(options).every((value) => value === undefined) || (Object.keys(options).length === 1 && options.sheetName !== undefined);
  return plain ? plainWorkbook(rows, options.sheetName ?? "2026") : variantWorkbook(rows, options);
}

/** The committed header-only fixture: the header row and nothing else. */
export function headerOnlyRegisterWorkbook(): Uint8Array {
  return buildRegisterWorkbook([]);
}
