/** The synthetic register workbook builder and the committed header-only fixture (T7). */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRegisterWorkbook, dateSerial, headerOnlyRegisterWorkbook, REGISTER_HEADERS } from "./registerWorkbook";
import { readXlsxSheet } from "../../scripts/release/xlsxReader";

const FIXTURE = join(import.meta.dir, "..", "..", "scripts", "fixtures", "synthetic-register-header-only.xlsx");

describe("registerWorkbook", () => {
  it("the committed fixture's bytes equal the builder's header-only output", () => {
    const committed = new Uint8Array(readFileSync(FIXTURE));
    expect(Buffer.from(committed).equals(Buffer.from(headerOnlyRegisterWorkbook()))).toBe(true);
  });

  it("the fixture holds the header row and nothing else", () => {
    const sheet = readXlsxSheet(new Uint8Array(readFileSync(FIXTURE)), "2026");
    expect([...sheet.rows.keys()]).toEqual([1]);
    expect([...sheet.rows.get(1)!.values()].map((cell) => (cell.kind === "text" ? cell.value : "?"))).toEqual([...REGISTER_HEADERS]);
  });

  it("is deterministic", () => {
    const rows = [{ worker: "Worker Alpha", number: "LC26/001", date: "2026-03-14", total: "24.5" }];
    expect(Buffer.from(buildRegisterWorkbook(rows)).equals(Buffer.from(buildRegisterWorkbook(rows)))).toBe(true);
    expect(Buffer.from(buildRegisterWorkbook(rows, { deflate: true })).equals(Buffer.from(buildRegisterWorkbook(rows, { deflate: true })))).toBe(true);
  });

  it("date serials: 1900 system and 1904 system", () => {
    expect(dateSerial("2026-03-14")).toBe(46095);
    expect(dateSerial("2026-03-14", 1904)).toBe(46095 - 1462);
    expect(() => dateSerial("1900-02-28")).toThrow();
    expect(() => dateSerial("14.03.2026")).toThrow();
  });
});
