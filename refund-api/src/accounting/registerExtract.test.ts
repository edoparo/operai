/**
 * The register extract (the accountant's register layout): the sixteen columns, what each holds for a mileage, a foreign-
 * currency and a CHF line, the order, the determinism and the text safety. Pure: no database.
 */

import { describe, expect, it } from "bun:test";
import { buildRegisterExtract, type RegisterExtractLine } from "./registerExtract";
import {
  approverCell,
  formatMicros,
  HEADERS,
  periodOf,
  registerFilename,
  sheetNameOf,
} from "./registerExtractFormat";
import { cellValues, readWorkbook } from "../test-support/xlsxReader";

const CUTOFF = new Date("2026-10-31T22:59:59.000Z");

const line = (over: Partial<RegisterExtractLine> = {}): RegisterExtractLine => ({
  lineId: "l1",
  ownerUserId: "u-anna",
  ownerName: "Anna Rossi",
  ownerEmail: "anna.rossi@welld.ch",
  receiptNumber: "ARO26/004",
  receiptYear: 2026,
  receiptSeq: 4,
  date: "2026-10-07",
  motivo: "Riunione cliente",
  currency: "CHF",
  approvedCents: 2080,
  rateMicros: null,
  accountNumber: "6101",
  type: "office_material",
  km: null,
  mileageRateMicros: null,
  accountName: "Spese materiale ufficio",
  vatCode: "IPM81",
  vatRateBasisPoints: 810,
  approverName: "Luca Bianchi",
  approverEmail: "luca.bianchi@welld.ch",
  ...over,
});

const rowsOf = (lines: RegisterExtractLine[]) => readWorkbook(buildRegisterExtract(lines, CUTOFF).bytes).rows.map(cellValues);

describe("register extract: layout", () => {
  it("one sheet named after the batch's year, the register's sixteen headers in its order", () => {
    const book = readWorkbook(buildRegisterExtract([], CUTOFF).bytes);
    expect(book.sheetNames).toEqual(["2026"]);
    expect(book.rows.map(cellValues)).toEqual([[...HEADERS]]);
    expect(HEADERS).toHaveLength(16);
    expect(HEADERS[3]).toBe("Description");
    expect(HEADERS[12]).toBe("Description");
  });

  it("a CHF line: Italian description, period, date, CHF total, account and its name, VAT code and the VAT it contains, approver", () => {
    const [, row] = rowsOf([line()]);
    expect(row).toEqual([
      "Anna Rossi",
      { n: "10" },
      "ARO26/004",
      "Spese materiale ufficio",
      null,
      null,
      "Riunione cliente",
      { n: "46302" },
      null,
      null,
      { n: "20.80" },
      { n: "6101" },
      "Spese materiale ufficio",
      "IPM81",
      { n: "1.56" }, // 20.80 * 810 / 10810, half up (the review view's figure)
      "Luca B.",
    ]);
  });

  it("a mileage line: km and the CHF rate per km in I and J", () => {
    const [, row] = rowsOf([
      line({ type: "travel_km", km: 147, mileageRateMicros: 700_000, approvedCents: 10290, accountNumber: "5905", vatCode: null, vatRateBasisPoints: null }),
    ]);
    expect(row![3]).toBe("Spese di viaggio (km)");
    expect(row!.slice(8, 11)).toEqual([{ n: "147" }, { n: "0.7" }, { n: "102.90" }]);
    expect(row!.slice(13, 15)).toEqual([null, null]);
  });

  it("a mileage line with no rate kept on it: the km, and J left empty", () => {
    const [, row] = rowsOf([line({ type: "travel_km", km: 40, mileageRateMicros: null })]);
    expect(row!.slice(8, 10)).toEqual([{ n: "40" }, null]);
  });

  it("a foreign-currency line: the monthly rate and the amount in its currency in I and J, the CHF total in K", () => {
    const [, row] = rowsOf([line({ currency: "EUR", approvedCents: 13345, rateMicros: 950_700 })]);
    expect(row!.slice(8, 11)).toEqual([{ n: "0.9507" }, { n: "133.45" }, { n: "126.87" }]);
  });

  it("a VAT code at 0 % has its code and no VAT amount", () => {
    const [, row] = rowsOf([line({ vatCode: "NOVAT", vatRateBasisPoints: 0 })]);
    expect(row!.slice(13, 15)).toEqual(["NOVAT", null]);
  });

  it("no cell is a formula, and a reason that looks like one stays text", () => {
    const bytes = buildRegisterExtract([line({ motivo: "=HYPERLINK(\"x\")" })], CUTOFF).bytes;
    const book = readWorkbook(bytes);
    expect(Object.values(book.parts).some((xml) => xml.includes("<f>") || xml.includes("<f "))).toBe(false);
    expect(book.rows[1]![6]).toMatchObject({ type: "string", value: "=HYPERLINK(\"x\")", style: { quotePrefix: true } });
  });

  it("the header is a frozen, bold, grey band and the dates and totals carry the register's formats", () => {
    const book = readWorkbook(buildRegisterExtract([line()], CUTOFF).bytes);
    expect(book.parts["xl/worksheets/sheet1.xml"]).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(book.parts["xl/styles.xml"]).toContain('<fgColor rgb="FFC0C0C0"/>');
    expect(book.rows[0]![0]!.style.bold).toBe(true);
    expect(book.rows[1]![7]!.style.formatCode).toBe("dd/mm/yyyy");
    expect(book.rows[1]![10]!.style.formatCode).toBe('"CHF"\\ #,##0.00');
  });
});

describe("register extract: order and determinism", () => {
  const lines = [
    line({ lineId: "c", date: "2026-10-02", ownerName: "Bruno Verdi", ownerUserId: "u-b", receiptNumber: "BVE26/001", receiptSeq: 1 }),
    line({ lineId: "a", date: "2026-10-20", receiptNumber: "ARO26/006", receiptSeq: 6 }),
    line({ lineId: "b", date: "2026-10-03", receiptNumber: "ARO26/005", receiptSeq: 5 }),
    line({ lineId: "d", date: "2026-09-30", ownerName: "Bruno Verdi", ownerUserId: "u-b", receiptNumber: "BVE26/000", receiptSeq: 0 }),
  ];

  it("by period, then worker, then receipt number", () => {
    expect(rowsOf(lines).slice(1).map((row) => row[2])).toEqual(["BVE26/000", "ARO26/005", "ARO26/006", "BVE26/001"]);
  });

  it("the same lines in any order give the same bytes", () => {
    const a = buildRegisterExtract(lines, CUTOFF).bytes;
    const b = buildRegisterExtract([...lines].reverse(), CUTOFF).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("a foreign line without a rate is refused: the export is blocked before a file is asked for", () => {
    expect(() => buildRegisterExtract([line({ currency: "EUR", rateMicros: null })], CUTOFF)).toThrow(RangeError);
  });
});

describe("register extract: cells", () => {
  it("approver as the register writes it", () => {
    expect(approverCell("Matteo Codogno", "m@x")).toBe("Matteo C.");
    expect(approverCell("  Anna   Maria  rossi ", null)).toBe("Anna R.");
    expect(approverCell("Cher", null)).toBe("Cher");
    expect(approverCell(null, "acct@welld.ch")).toBe("acct@welld.ch");
    expect(approverCell("   ", null)).toBe("");
  });

  it("exact decimals from micros, and the period of a date", () => {
    expect([formatMicros(924_600), formatMicros(700_000), formatMicros(1_000_000), formatMicros(0)]).toEqual(["0.9246", "0.7", "1", "0"]);
    expect(() => formatMicros(-1)).toThrow(RangeError);
    expect([periodOf("2026-01-31"), periodOf("2026-12-01")]).toEqual(["1", "12"]);
    expect(() => periodOf("2026-13-01")).toThrow(RangeError);
  });

  it("sheet name and filename carry no personal data", () => {
    expect(sheetNameOf(CUTOFF)).toBe("2026");
    expect(registerFilename(CUTOFF, "b/1")).toBe("refund-register-2026-10-31-b_1.xlsx");
  });
});
