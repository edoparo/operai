/**
 * The register export reader (T8, specs/20261124-receipt-numbers-from-the-register; AC-1.13, AC-2.1; plan § Register export).
 * Synthetic workbooks only (`Worker Alpha`, ...): built by `src/test-support/registerWorkbook.ts`, or, for cell forms the builder
 * cannot write (text dates, text totals), as hand-made sheets handed to `registerRowsFromSheet`.
 */

import { describe, expect, it } from "bun:test";
import { buildRegisterWorkbook, type RegisterRowInput } from "../../src/test-support/registerWorkbook";
import {
  classifyNumber,
  dateOfSerial,
  decimalToCents,
  readDate,
  readRegisterExport,
  readTotal,
  registerRowsFromSheet,
  RegisterExportRefusal,
} from "./registerExport";
import { XlsxRefusal, type XlsxCellValue, type XlsxSheet } from "./xlsxReader";

const text = (value: string): XlsxCellValue => ({ kind: "text", value });
const num = (value: string): XlsxCellValue => ({ kind: "number", value });

describe("totals to the cent, on the decimal string (AC-2.1: no float ever)", () => {
  const cases: [string, number | null][] = [
    ["24.5", 2450],
    ["24", 2400],
    ["0", 0],
    ["1.0049999999999999", 100],
    ["1.005", 101],
    ["1.0050000000000001", 101],
    ["24.499999999999996", 2450],
    ["2.675", 268],
    ["-3.005", -301],
    ["-3.0049999", -300],
    ["4.6083E4", 4608300],
    ["1.2345E-1", 12],
    ["1e2", 10000],
    [".5", 50],
    ["99999999.99", 9999999999],
    ["12abc", null],
    ["", null],
    ["1.2.3", null],
    ["1e999999", null],
  ];
  for (const [input, cents] of cases) {
    it(`${JSON.stringify(input)} -> ${cents}`, () => expect(decimalToCents(input)).toBe(cents));
  }
});

describe("a total cell", () => {
  const cases: [string, XlsxCellValue | undefined, number | null][] = [
    ["number", num("24.5"), 2450],
    ["text with a currency code first", text("CHF 1'234.50"), 123450],
    ["text with a currency code last", text("24,50 EUR"), 2450],
    ["text with a comma mark", text("24,50"), 2450],
    ["text with spaces and a typographic apostrophe", text("1 234’50".replace("’", ".")), 123450],
    ["text with two decimal marks", text("1,234.50"), null],
    ["text with words", text("about ten"), null],
    ["empty", undefined, null],
    ["a boolean", { kind: "bool", value: "1" }, null],
    ["an error cell", { kind: "unreadable", why: "error" }, null],
    ["a formula with no value", { kind: "unreadable", why: "formula-without-value" }, null],
  ];
  for (const [name, cell, cents] of cases) it(name, () => expect(readTotal(cell)).toBe(cents));
});

describe("a date cell", () => {
  const cases: [string, XlsxCellValue | undefined, boolean, string | null][] = [
    ["1900 serial", num("46093"), false, "2026-03-12"],
    ["1900 serial with a time of day", num("46093.75"), false, "2026-03-12"],
    ["1900 serial 61 is 1900-03-01, after the phantom 1900-02-29", num("61"), false, "1900-03-01"],
    ["1900 serial 60 is the phantom day", num("60"), false, null],
    ["1900 serial 59 is 1900-02-28", num("59"), false, "1900-02-28"],
    ["1900 serial 1 is 1900-01-01", num("1"), false, "1900-01-01"],
    ["1904 serial 0 is 1904-01-01", num("0"), true, "1904-01-01"],
    ["1904 serial of 2026-03-12", num(String(46093 - 1462)), true, "2026-03-12"],
    ["text YYYY-MM-DD", text("2026-03-12"), false, "2026-03-12"],
    ["text DD.MM.YYYY", text("12.03.2026"), false, "2026-03-12"],
    ["text DD/MM/YYYY", text("12/03/2026"), false, "2026-03-12"],
    ["text d.m.yyyy", text("2.3.2026"), false, "2026-03-02"],
    ["an ISO date cell", { kind: "isoDate", value: "2026-03-12T00:00:00" }, false, "2026-03-12"],
    ["a day that does not exist", text("31.02.2026"), false, null],
    ["a two-digit year", text("12.03.26"), false, null],
    ["a month name", text("March 12"), false, null],
    ["empty", undefined, false, null],
    ["negative serial", num("-5"), false, null],
    ["a boolean", { kind: "bool", value: "1" }, false, null],
  ];
  for (const [name, cell, date1904, expected] of cases) it(name, () => expect(readDate(cell, date1904)).toBe(expected));
  it("leap day 2028 exists, 2026 has none", () => {
    expect(dateOfSerial("46082", false)).toBe("2026-03-01");
    expect(readDate(text("29.02.2028"), false)).toBe("2028-02-29");
    expect(readDate(text("29.02.2026"), false)).toBeNull();
  });
});

describe("a number cell", () => {
  it("is trimmed and upper-cased: empty, paper or malformed (its shape only)", () => {
    expect(classifyNumber(undefined)).toEqual({ kind: "empty" });
    expect(classifyNumber(text("   "))).toEqual({ kind: "empty" });
    expect(classifyNumber(text(" ab26/005 "))).toEqual({ kind: "paper", text: "AB26/005", prefix: "AB", yy: 26, seq: 5 });
    expect(classifyNumber(text("LCX26/040"))).toMatchObject({ kind: "paper", prefix: "LCX", seq: 40 });
    expect(classifyNumber(text("LG25/003"))).toMatchObject({ kind: "paper", yy: 25 });
    expect(classifyNumber(text("AB26/000"))).toMatchObject({ kind: "paper", seq: 0 });
    for (const [cell, shape] of [
      ["A26/005", "A99/999"],
      ["ABCD26/005", "AAAA99/999"],
      ["AB26-005", "AA99-999"],
      ["AB26/123456", "AA99/999999"],
      ["Worker Alpha 7", "AAAAAA AAAAA 9"],
      ["ßß26/001", "AA99/999"],
      ["AA99/9a", "AA99/9A"],
    ] as const) {
      expect(classifyNumber(text(cell))).toEqual({ kind: "malformed", shape });
    }
    expect(classifyNumber(num("12"))).toEqual({ kind: "malformed", shape: "99" });
  });
  it("a malformed number never carries the cell's text", () => {
    expect(JSON.stringify(classifyNumber(text("Worker Alpha 7")))).not.toContain("Worker");
  });
});

const ROWS: RegisterRowInput[] = [
  { worker: "Worker Alpha", number: "AB26/001", date: "2026-03-12", total: "24.5" },
  { worker: "Worker Alpha", number: "AB26/002", date: "2026-03-13", total: "1.0049999999999999" },
  { worker: "Worker Beta", number: "", date: "2026-04-01", total: "10" },
  { worker: "Worker Beta", number: "ZZ-1", date: "2026-04-02", total: "11.11" },
];

describe("a workbook", () => {
  it("is read to the rows: position is the Excel row, the four fields are typed", () => {
    const { rows, formulasWithoutValue } = readRegisterExport(buildRegisterWorkbook(ROWS));
    expect(formulasWithoutValue).toBe(0);
    expect(rows).toEqual([
      { position: 2, worker: "Worker Alpha", number: { kind: "paper", text: "AB26/001", prefix: "AB", yy: 26, seq: 1 }, date: "2026-03-12", totalCents: 2450 },
      { position: 3, worker: "Worker Alpha", number: { kind: "paper", text: "AB26/002", prefix: "AB", yy: 26, seq: 2 }, date: "2026-03-13", totalCents: 100 },
      { position: 4, worker: "Worker Beta", number: { kind: "empty" }, date: "2026-04-01", totalCents: 1000 },
      { position: 5, worker: "Worker Beta", number: { kind: "malformed", shape: "AA-9" }, date: "2026-04-02", totalCents: 1111 },
    ]);
  });

  it("returned rows carry no field beyond position, worker, number, date, totalCents", () => {
    const { rows } = readRegisterExport(buildRegisterWorkbook(ROWS, { deflate: true }));
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["date", "number", "position", "totalCents", "worker"]);
  });

  it("is the same through every variant of the builder", () => {
    const plain = readRegisterExport(buildRegisterWorkbook(ROWS)).rows;
    for (const options of [{ deflate: true }, { richText: true }, { inlineStrings: true }, { formulas: "cached" as const }, { dateSystem: 1904 as const }, { sheetName: "2026" }]) {
      expect(readRegisterExport(buildRegisterWorkbook(ROWS, options)).rows).toEqual(plain);
    }
  });

  it("finds the header below title rows, and the positions follow the sheet", () => {
    const { rows } = readRegisterExport(buildRegisterWorkbook(ROWS, { titleRows: 3 }));
    expect(rows.map((r) => r.position)).toEqual([5, 6, 7, 8]);
  });

  it("propagates a merged worker cell over its rows", () => {
    const merged = readRegisterExport(buildRegisterWorkbook(ROWS, { mergeWorker: true })).rows;
    expect(merged.map((r) => r.worker)).toEqual(["Worker Alpha", "Worker Alpha", "Worker Beta", "Worker Beta"]);
  });

  it("reads a sheet by name, and a missing sheet is a named refusal, not a cell", () => {
    expect(readRegisterExport(buildRegisterWorkbook(ROWS, { sheetName: "Other" }), "Other").rows).toHaveLength(4);
    let error: unknown;
    try {
      readRegisterExport(buildRegisterWorkbook(ROWS));
      readRegisterExport(buildRegisterWorkbook(ROWS), "2027");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(XlsxRefusal);
    expect((error as XlsxRefusal).code).toBe("sheet-not-found");
    expect((error as XlsxRefusal).message).not.toContain("Worker");
  });

  it("a formula with no cached value is an unreadable total with the count to hint, and the others are read", () => {
    const { rows, formulasWithoutValue } = readRegisterExport(buildRegisterWorkbook(ROWS, { formulas: "uncached" }));
    expect(formulasWithoutValue).toBe(4);
    expect(rows.every((r) => r.totalCents === null)).toBe(true);
    expect(rows.map((r) => r.date)).toEqual(["2026-03-12", "2026-03-13", "2026-04-01", "2026-04-02"]);
  });

  it("an empty register (header only) is no row", () => {
    expect(readRegisterExport(buildRegisterWorkbook([])).rows).toEqual([]);
  });
});

describe("a sheet by hand", () => {
  const sheetOf = (rows: Record<number, Record<number, XlsxCellValue>>, date1904 = false): XlsxSheet => ({
    date1904,
    rows: new Map(Object.entries(rows).map(([r, cells]) => [Number(r), new Map(Object.entries(cells).map(([c, v]) => [Number(c), v]))])),
  });
  const header = { 2: text(" worker "), 3: text("NO."), 5: text("Date"), 7: text("total"), 1: text("Description"), 9: text("Description") };

  it("finds the four headers by trimmed, case-insensitive text, whichever the columns, and ignores every other column", () => {
    const { rows } = registerRowsFromSheet(
      sheetOf({
        4: header,
        5: { 1: text("a description with Worker Gamma in it"), 2: text("Worker Gamma"), 3: text("cd26/007"), 5: text("12.03.2026"), 7: text("CHF 1'000.50"), 9: text("more") },
      }),
    );
    expect(rows).toEqual([{ position: 5, worker: "Worker Gamma", number: { kind: "paper", text: "CD26/007", prefix: "CD", yy: 26, seq: 7 }, date: "2026-03-12", totalCents: 100050 }]);
    expect(JSON.stringify(rows)).not.toContain("description");
  });

  it("a header in the 20th row is found, in the 21st it is not", () => {
    expect(registerRowsFromSheet(sheetOf({ 20: header })).rows).toEqual([]);
    expect(() => registerRowsFromSheet(sheetOf({ 21: header }))).toThrow(RegisterExportRefusal);
  });

  it("a missing column is a named refusal and quotes nothing", () => {
    let error: unknown;
    try {
      registerRowsFromSheet(sheetOf({ 1: { 1: text("Worker"), 2: text("No."), 3: text("Date") }, 2: { 1: text("Worker Zeta") } }));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RegisterExportRefusal);
    expect((error as RegisterExportRefusal).code).toBe("header-missing");
    expect((error as Error).message).not.toContain("Zeta");
  });

  it("keeps a row with a number and no worker, a worker and no number, and drops a row with a total only", () => {
    const { rows } = registerRowsFromSheet(
      sheetOf({
        1: header,
        2: { 3: text("AB26/001"), 5: num("46093"), 7: num("5") },
        3: { 2: text("Worker Statement"), 7: num("50") },
        4: { 7: num("55") },
        5: {},
      }),
    );
    expect(rows.map((r) => [r.position, r.worker, r.number.kind, r.date])).toEqual([
      [2, null, "paper", "2026-03-12"],
      [3, "Worker Statement", "empty", null],
    ]);
  });

  it("text dates and totals of every form, and a 1904 serial", () => {
    const { rows } = registerRowsFromSheet(
      sheetOf(
        {
          1: header,
          2: { 2: text("W"), 5: text("2026-03-12"), 7: text("24,50") },
          3: { 2: text("W"), 5: text("12/03/2026"), 7: text("EUR 3") },
          4: { 2: text("W"), 5: num(String(46093 - 1462)), 7: num("0.1") },
        },
        true,
      ),
    );
    expect(rows.map((r) => [r.date, r.totalCents])).toEqual([["2026-03-12", 2450], ["2026-03-12", 300], ["2026-03-12", 10]]);
  });
});
