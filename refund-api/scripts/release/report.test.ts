/**
 * The pairing report (T11, specs/20261124-receipt-numbers-from-the-register; AC-1.9, AC-2.2, AC-3.1, AC-3.4, AC-4.11, AC-5.6).
 * A fixture that covers every category, a snapshot of the text, and the proof that nothing personal can reach it.
 */

import { describe, expect, it } from "bun:test";
import { buildReportInput, CATEGORY_LABELS, employeeRef, formatPairingReport, type EmployeeReportRow, type ReportInput } from "./report";
import type { RowInventory } from "./pairing";
import type { PairingCategory, PairingProposal, PreReleaseLine } from "./types";

const CATEGORIES = Object.keys(CATEGORY_LABELS) as PairingCategory[];

// Synthetic, and deliberately full of things that must never be printed.
const SECRET_WORKER = "Worker Alpha Secret";
const SECRET_EMAIL = "alpha.secret@example.invalid";
const SECRET_DESCRIPTION = "Taxi to the secret client dinner";

const lines: PreReleaseLine[] = CATEGORIES.map((category, i) => ({
  id: `line-${String(i + 1).padStart(2, "0")}`,
  ownerUserId: "user-1",
  date: `2026-03-${String(i + 1).padStart(2, "0")}`,
  createdAt: "2026-04-01T08:00:00.000Z",
  approvedTotalCents: category === "exact" ? 123_456 : 1000 + i * 111,
  currency: i % 2 === 0 ? "CHF" : "EUR",
}));

const proposals: PairingProposal[] = CATEGORIES.map((category, i) => {
  const doubtful = !["exact", "split_receipt", "no_counterpart", "outside_2026"].includes(category);
  return {
    lineId: lines[i]!.id,
    employeeKey: "E1",
    category,
    reason: doubtful ? `${CATEGORY_LABELS[category]}: R${40 + i} AB26/0${10 + i}` : null,
    proposed: doubtful ? null : "paper",
    proposedNumber: doubtful ? null : `AB26/0${10 + i}`,
    group: category === "split_receipt" ? "S1" : null,
    registerRows: category === "no_counterpart" || category === "outside_2026" ? [] : [40 + i],
    state: doubtful ? "unresolved" : "proposed",
  };
});

const inventory: RowInventory = {
  rowsWithNoLine: 21,
  rowsWithoutNumber: 6,
  rowsWithoutDateOrTotal: [101, 102],
  malformed: [{ position: 103, shape: "AA99/9A" }],
  noWorker: [104],
  unmappedWorkers: ["W3", "W4"],
};

const employees: EmployeeReportRow[] = [
  { ref: employeeRef("LCM", "1a2b3c4d5e6f"), offsets: 30, registerMax: 39, importedMax: 41, baseline: 41, firstNew: "LCM26/042", lines: 12, noMappedWorker: false, needsCode: false, excluded: false },
  { ref: employeeRef("FR", "9z8y7x6w5v"), offsets: 0, registerMax: 5, importedMax: 0, baseline: 5, firstNew: "FR26/006", lines: 3, noMappedWorker: false, needsCode: true, excluded: false },
  { ref: employeeRef("XX", "00000000zz"), offsets: 0, registerMax: 0, importedMax: 0, baseline: 0, firstNew: "XX26/001", lines: 3, noMappedWorker: true, needsCode: false, excluded: true },
  { ref: "not yet in Refund", offsets: 7, registerMax: 7, importedMax: 0, baseline: 7, firstNew: null, lines: 0, noMappedWorker: false, needsCode: false, excluded: false },
];

const input: ReportInput = buildReportInput({
  mode: "propose",
  sheet: "2026",
  registerRows: 321,
  registerLastDate: "2026-11-20",
  lines,
  proposals,
  inventory,
  formulasWithoutValue: 0,
  employees,
});

describe("the report text (AC-2.2)", () => {
  const text = formatPairingReport(input).join("\n");

  it("matches its snapshot over a fixture that covers every category", () => {
    expect(text).toMatchSnapshot();
  });

  it("states counts per category (lines and rows), splits, the row lists, the codes needed and the per-employee figures", () => {
    for (const label of Object.values(CATEGORY_LABELS)) expect(text).toContain(label);
    expect(text).toContain("split receipts: 1 line, 1 row, 1 group");
    expect(text).toContain("with no pre-release line (feed an employee's maximum only): 21");
    expect(text).toContain("with a malformed number (to be acknowledged, count toward nothing): 1 (R103 AA99/9A)");
    expect(text).toContain("workers not mapped to an employee: 2");
    expect(text).toContain("Employees that need a receipt code (a prefix shared with another employee, AC-4.11): 1\n  FR · 9z8y7x6w");
    expect(text).toContain("LCM · 1a2b3c4d: 12 lines; offsets 30, register maximum 39, imported maximum 41, baseline 41; first new number LCM26/042; offsets 30 differ from the register maximum 39");
    expect(text).toContain("XX · 00000000: 3 lines;");
    expect(text).toContain("excluded from the register; has pre-release lines and no mapped worker: check the mapping");
    expect(text).toContain("last expense date 2026-11-20");
  });

  it("says plainly how many decisions are open and what the real run would do", () => {
    expect(text).toContain("decisions still open: the real run would refuse (exit 8)");
    const check = formatPairingReport({ ...input, mode: "check", openDecisions: 0 }).join("\n");
    expect(check).toContain("0 decisions still open in the file");
    expect(check).not.toContain("would refuse");
  });

  it("lists every doubtful line by id with its own date, amount, currency and reason, and only those", () => {
    const doubtful = proposals.filter((p) => p.state === "unresolved");
    expect(input.doubtful).toHaveLength(doubtful.length);
    for (const p of doubtful) {
      const line = lines.find((l) => l.id === p.lineId)!;
      expect(text).toContain(`${line.id}  ${line.date}  ${(line.approvedTotalCents / 100).toFixed(2)} ${line.currency}  ${p.reason}`);
    }
  });

  it("names the formula hint when a formula had no stored value", () => {
    const hinted = formatPairingReport({ ...input, rows: { ...input.rows, formulasWithoutValue: 3 } }).join("\n");
    expect(hinted).toContain("3 formula cells hold no computed value");
    expect(hinted).toContain("save the workbook in Excel");
  });
});

describe("privacy by construction (AC-5.6)", () => {
  it("the text holds none of the fixture's worker names, emails or descriptions, and no amount of a line that is not doubtful", () => {
    const text = formatPairingReport(input).join("\n");
    for (const secret of [SECRET_WORKER, SECRET_EMAIL, SECRET_DESCRIPTION, "Worker", "@", "secret"]) expect(text).not.toContain(secret);
    const exact = lines[CATEGORIES.indexOf("exact")]!;
    expect(text).not.toContain("1234.56");
    expect(text).not.toContain(exact.date);
  });

  it("the input type has no place for a name: a hostile string in an unexpected field is not copied from the proposals or the lines", () => {
    const hostile = buildReportInput({
      mode: "propose",
      sheet: "2026",
      registerRows: 1,
      registerLastDate: null,
      lines: lines.map((l) => ({ ...l, worker: SECRET_WORKER, description: SECRET_DESCRIPTION, email: SECRET_EMAIL }) as PreReleaseLine),
      proposals,
      inventory,
      formulasWithoutValue: 0,
      employees,
    });
    const json = JSON.stringify(hostile);
    for (const secret of [SECRET_WORKER, SECRET_DESCRIPTION, SECRET_EMAIL]) expect(json).not.toContain(secret);
    expect(formatPairingReport(hostile).join("\n")).toContain("last expense date unknown");
  });

  it("an employee is shown as <prefix> · <first 8 of the user id> only", () => {
    expect(employeeRef("LCM", "1a2b3c4d5e6f")).toBe("LCM · 1a2b3c4d");
  });
});
