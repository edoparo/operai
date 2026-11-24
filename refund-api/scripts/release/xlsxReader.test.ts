/**
 * The dependency-free xlsx reader (T7; AC-2.1, AC-2.7). Every workbook is synthetic (`registerWorkbook.ts`); the hostile ones
 * carry a marker text so each refusal can be shown to quote no cell.
 */

import { describe, expect, it } from "bun:test";
import * as zlib from "node:zlib";
import { buildRegisterWorkbook, dateSerial, type RegisterRowInput, type RegisterWorkbookOptions } from "../../src/test-support/registerWorkbook";
import { columnNumber, readXlsxSheet, REFUSALS, XlsxRefusal, type XlsxCellValue, type XlsxRefusalCode, type XlsxSheet } from "./xlsxReader";

const MARKER = "SECRET-CELL-TEXT-Zq7";

const ROWS: readonly RegisterRowInput[] = [
  { worker: "Worker Alpha", number: "LC26/001", date: "2026-03-14", total: "24.5" },
  { worker: "Worker Alpha", number: "LC26/002", date: "2026-03-15", total: "1.0049999999999999" },
  { worker: "Worker Beta", number: "", date: "2026-04-01", total: "1234.56" },
  { worker: `Worker ${MARKER} & <Co>`, number: "FR26/002", date: "2026-05-09", total: "10" },
];

function cellsOf(sheet: XlsxSheet): string[][] {
  return [...sheet.rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, line]) =>
      [...line.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, cell]) => (cell.kind === "unreadable" ? `!${cell.why}` : `${cell.kind}:${cell.value}`)),
    );
}

const EXPECTED_PLAIN: string[][] = [
  ["text:Worker", "text:No.", "text:Date", "text:Total"],
  ["text:Worker Alpha", "text:LC26/001", `number:${dateSerial("2026-03-14")}`, "number:24.5"],
  ["text:Worker Alpha", "text:LC26/002", `number:${dateSerial("2026-03-15")}`, "number:1.0049999999999999"],
  ["text:Worker Beta", `number:${dateSerial("2026-04-01")}`, "number:1234.56"],
  [`text:Worker ${MARKER} & <Co>`, "text:FR26/002", `number:${dateSerial("2026-05-09")}`, "number:10"],
];

function refusal(bytes: Uint8Array, sheet = "2026"): XlsxRefusal {
  try {
    readXlsxSheet(bytes, sheet);
  } catch (error) {
    expect(error).toBeInstanceOf(XlsxRefusal);
    return error as XlsxRefusal;
  }
  throw new Error("expected a refusal");
}

function expectRefused(bytes: Uint8Array, code: XlsxRefusalCode): void {
  const error = refusal(bytes);
  expect(error.code).toBe(code);
  expect(error.message).toBe(REFUSALS[code]);
  expect(error.message).not.toContain(MARKER);
  expect(error.message).not.toContain("Worker");
  expect(error.message).not.toContain("LC26");
  expect(error.stack ?? "").not.toContain(MARKER);
}

describe("readXlsxSheet: what the builder writes is read back", () => {
  const variants: [string, RegisterWorkbookOptions][] = [
    ["the deterministic writer", {}],
    ["deflate", { deflate: true }],
    ["rich-text shared strings (runs concatenated, phonetic part ignored)", { richText: true }],
    ["inline strings", { inlineStrings: true }],
    ["deflate and inline strings", { deflate: true, inlineStrings: true }],
    ["1904 date serials", { dateSystem: 1904 }],
    ["a sheet named otherwise", { sheetName: "Recap" }],
  ];
  for (const [label, options] of variants) {
    it(label, () => {
      const sheet = readXlsxSheet(buildRegisterWorkbook(ROWS, options), options.sheetName ?? "2026");
      expect(sheet.date1904).toBe(options.dateSystem === 1904);
      const expected = EXPECTED_PLAIN.map((line) => [...line]);
      if (options.dateSystem === 1904) {
        for (const [i, row] of ROWS.entries()) {
          const line = expected[i + 1]!;
          line[line.length - 2] = `number:${dateSerial(row.date, 1904)}`;
        }
      }
      expect(cellsOf(sheet)).toEqual(expected);
    });
  }

  it("a number cell keeps its decimal string as stored, never a float", () => {
    const sheet = readXlsxSheet(buildRegisterWorkbook(ROWS), "2026");
    expect(sheet.rows.get(3)!.get(4)).toEqual({ kind: "number", value: "1.0049999999999999" });
  });

  it("formula cells with a cached value read the cache; without one they are unreadable", () => {
    const cached = readXlsxSheet(buildRegisterWorkbook(ROWS, { formulas: "cached" }), "2026");
    expect(cached.rows.get(2)!.get(4)).toEqual({ kind: "number", value: "24.5" });
    const uncached = readXlsxSheet(buildRegisterWorkbook(ROWS, { formulas: "uncached" }), "2026");
    expect(uncached.rows.get(2)!.get(4)).toEqual({ kind: "unreadable", why: "formula-without-value" });
  });

  it("a merged worker cell is read over the whole range", () => {
    const sheet = readXlsxSheet(buildRegisterWorkbook(ROWS, { mergeWorker: true }), "2026");
    expect(sheet.rows.get(2)!.get(1)).toEqual({ kind: "text", value: "Worker Alpha" });
    expect(sheet.rows.get(3)!.get(1)).toEqual({ kind: "text", value: "Worker Alpha" });
    expect(sheet.rows.get(4)!.get(1)).toEqual({ kind: "text", value: "Worker Beta" });
  });

  it("title rows push the header down", () => {
    const sheet = readXlsxSheet(buildRegisterWorkbook(ROWS, { titleRows: 2 }), "2026");
    expect(sheet.rows.get(3)!.get(1)).toEqual({ kind: "text", value: "Worker" });
    expect(sheet.rows.size).toBe(2 + 1 + ROWS.length);
  });

  it("a sheet that is not in the workbook is refused by name", () => {
    expect(refusal(buildRegisterWorkbook(ROWS), "Nope").code).toBe("sheet-not-found");
  });
});

describe("readXlsxSheet: refusals name the feature and quote no cell", () => {
  const withMarker = [{ worker: MARKER, number: MARKER, date: "2026-03-14", total: "1" }];

  it("a DOCTYPE", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { doctype: { entityText: MARKER } }), "doctype-refused");
  });
  it("a zip bomb declaring its real size", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { bomb: { bytes: 80 * 1024 * 1024, declared: "honest" } }), "entry-too-large");
  });
  it("a zip bomb declaring one byte", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { bomb: { bytes: 80 * 1024 * 1024, declared: "lying" } }), "entry-too-large");
  });
  it("ZIP64", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { hostile: "zip64" }), "zip64");
  });
  it("encryption", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { hostile: "encrypted" }), "encrypted");
  });
  it("compression method 12", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { hostile: "method12" }), "unsupported-method");
  });
  it("a CRC mismatch (header flipped)", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { hostile: "crc" }), "crc-mismatch");
  });
  it("a CRC mismatch (a data byte flipped in a stored part)", () => {
    const bytes = buildRegisterWorkbook(withMarker);
    const at = Buffer.from(bytes).indexOf(Buffer.from("<sheetData>"));
    expect(at).toBeGreaterThan(0);
    bytes[at + 1] = bytes[at + 1]! ^ 0x01; // sheetData -> rheetData: still a stored byte, so only the CRC can tell
    expectRefused(bytes, "crc-mismatch");
  });
  it("more than 10,000 entries", () => {
    expectRefused(buildRegisterWorkbook(withMarker, { hostile: "many-entries" }), "too-many-entries");
  });
  it("a compressed file over 20 MiB", () => {
    expectRefused(new Uint8Array(20 * 1024 * 1024 + 1), "file-too-large");
  });
  it("something that is not a zip, and a truncated zip", () => {
    expectRefused(new TextEncoder().encode(`${MARKER} is not a workbook, just text, long enough to be scanned for a directory`), "not-a-zip");
    expectRefused(buildRegisterWorkbook(withMarker).subarray(0, 40), "not-a-zip");
    expectRefused(new Uint8Array(0), "not-a-zip");
  });
  it("a corrupt deflate stream", () => {
    const bytes = buildRegisterWorkbook(withMarker, { deflate: true });
    // The local header of the worksheet is followed by its name and then the stream: damage the stream.
    const at = Buffer.from(bytes).indexOf(Buffer.from("xl/worksheets/sheet1.xml")) + "xl/worksheets/sheet1.xml".length;
    for (let i = 0; i < 12; i++) bytes[at + i] = 0xff;
    const error = refusal(bytes);
    expect(error.code).toBe("corrupt-entry");
    expect(error.message).not.toContain(MARKER);
  });
});

describe("readXlsxSheet: hand-made parts", () => {
  /** A one-sheet workbook whose worksheet XML is exactly `sheetXml`, stored, with an optional shared string table. */
  function workbookWith(sheetXml: string, sharedXml?: string): Uint8Array {
    return makeZip({
      "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="2026" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="/xl/worksheets/s.xml"/></Relationships>`,
      "xl/worksheets/s.xml": sheetXml,
      ...(sharedXml === undefined ? {} : { "xl/sharedStrings.xml": sharedXml }),
    });
  }

  function makeZip(parts: Record<string, string>): Uint8Array {
    // A minimal stored ZIP written independently of the builder.
    const enc = new TextEncoder();
    const chunks: number[][] = [];
    const central: number[][] = [];
    let offset = 0;
    const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => Math.floor(n / 2 ** (8 * i)) & 0xff);
    for (const [name, text] of Object.entries(parts)) {
      const data = enc.encode(text);
      const nm = Array.from(enc.encode(name));
      const crc = zlib.crc32(data) >>> 0;
      const local = [...le(0x04034b50, 4), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0x21, 2), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(nm.length, 2), ...le(0, 2), ...nm, ...Array.from(data)];
      central.push([...le(0x02014b50, 4), ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0x21, 2), ...le(crc, 4), ...le(data.length, 4), ...le(data.length, 4), ...le(nm.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nm]);
      chunks.push(local);
      offset += local.length;
    }
    const dir = central.flat();
    const entries = Object.keys(parts).length;
    return Uint8Array.from([...chunks.flat(), ...dir, ...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(entries, 2), ...le(entries, 2), ...le(dir.length, 4), ...le(offset, 4), ...le(0, 2)]);
  }

  const sheet = (body: string) => `<?xml version="1.0"?><worksheet xmlns="http://purl.oclc.org/ooxml/spreadsheetml/main"><sheetData>${body}</sheetData></worksheet>`;

  it("strict namespaces, an absolute relationship target, entities and numeric references decode", () => {
    const xml = sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65;&#x42;</t></is></c></row>`);
    expect(cellsOf(readXlsxSheet(workbookWith(xml), "2026"))).toEqual([[`text:a & b <c> "d" 'e' AB`]]);
  });

  it("an error cell is unreadable; a boolean and an ISO date cell are typed", () => {
    const xml = sheet(`<row r="2"><c r="A2" t="e"><v>#N/A</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="d"><v>2026-03-14T00:00:00</v></c></row>`);
    expect(cellsOf(readXlsxSheet(workbookWith(xml), "2026"))).toEqual([["!error", "bool:1", "isoDate:2026-03-14T00:00:00"]]);
  });

  it("cells without a reference follow the row, and a formula's text is never read as a value", () => {
    const xml = sheet(`<row><c t="inlineStr"><is><t>x</t></is></c><c><f>1+1</f><v>2</v></c></row>`);
    expect(cellsOf(readXlsxSheet(workbookWith(xml), "2026"))).toEqual([["text:x", "number:2"]]);
  });

  it("an entity other than the five is refused", () => {
    const xml = sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>&custom;${MARKER}</t></is></c></row>`);
    const error = refusal(workbookWith(xml));
    expect(error.code).toBe("entity-refused");
    expect(error.message).not.toContain(MARKER);
  });

  it("a numeric reference to a forbidden character is refused", () => {
    expect(refusal(workbookWith(sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>&#0;</t></is></c></row>`))).code).toBe("entity-refused");
  });

  it("markup nested too deeply is refused without recursion", () => {
    const xml = sheet(`${"<x>".repeat(5000)}${MARKER}${"</x>".repeat(5000)}`);
    expect(refusal(workbookWith(xml)).code).toBe("xml-too-deep");
  });

  it("malformed XML, a mismatched close tag, a bad shared-string index and a bad cell reference are refused", () => {
    expect(refusal(workbookWith(sheet(`<row r="1"><c r="A1"></row>`))).code).toBe("xml-malformed");
    expect(refusal(workbookWith(sheet(`<row r="1"><c r="A1" t="s"><v>7</v></c></row>`), `<sst xmlns="x"><si><t>a</t></si></sst>`)).code).toBe("shared-string-index");
    expect(refusal(workbookWith(sheet(`<row r="1"><c r="ZZZZ9" t="inlineStr"><is><t>x</t></is></c></row>`))).code).toBe("cell-reference");
    expect(refusal(workbookWith(sheet(`<row r="1"><c r="A0"><v>1</v></c></row>`))).code).toBe("cell-reference");
  });

  it("a merge covering a huge area is refused, not expanded", () => {
    const xml = sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>`).replace("</sheetData>", `</sheetData><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells>`);
    expect(refusal(workbookWith(xml)).code).toBe("merge-too-large");
  });

  it("CDATA is text and comments are skipped", () => {
    const xml = sheet(`<row r="1"><!-- c --><c r="A1" t="inlineStr"><is><t><![CDATA[<raw & text>]]></t></is></c></row>`);
    expect(cellsOf(readXlsxSheet(workbookWith(xml), "2026"))).toEqual([["text:<raw & text>"]]);
  });

  it("only the refusals' own messages are ever thrown: every code has a fixed message with no placeholder", () => {
    for (const message of Object.values(REFUSALS)) expect(message).not.toMatch(/[{}$]|undefined/);
  });
});

describe("columnNumber", () => {
  it("A, Z, AA, XFD; nothing beyond", () => {
    expect(columnNumber("A")).toBe(1);
    expect(columnNumber("Z")).toBe(26);
    expect(columnNumber("AA")).toBe(27);
    expect(columnNumber("XFD")).toBe(16384);
    expect(() => columnNumber("XFE")).toThrow(XlsxRefusal);
    expect(() => columnNumber("a")).toThrow(XlsxRefusal);
  });
});

describe("readXlsxSheet: it is a plain function of its bytes", () => {
  it("reads a typed view of cells (type guard on unreadable)", () => {
    const sheet = readXlsxSheet(buildRegisterWorkbook(ROWS), "2026");
    const cell: XlsxCellValue | undefined = sheet.rows.get(1)?.get(1);
    expect(cell).toEqual({ kind: "text", value: "Worker" });
  });
});
