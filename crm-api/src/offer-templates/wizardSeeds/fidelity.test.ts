/**
 * Golden fidelity (specs/20261115-crm-offer-wizard T35; AC-9.1, AC-9.6, DD-48): for each of the seven seeds, and every
 * file of `golden/variants/`, the printed text with the golden answers equals the text the mockup printed for them,
 * except the differences AC-9.6 lists — the six of `ALLOWED_DIFFERENCES`, then SA-5's three of `OBSERVED_DRIFT`, each
 * counted and required to still occur — and nothing else. SA-6's currency-free labels are not a print difference: they
 * are the seeds' own text, and the last `describe` proves no label, hint or example names a currency. The golden answers are the mockup's state; `goldenAnswers.ts`
 * maps them to `WizardAnswers` through the catalog's renames (DD-48). The printed text is the engine's document text
 * (`documentText`, which the T34 parity test proves equal to the PDF's draw log), read in the golden's plain format.
 *
 * The allow-list below is the AC-9.6 list and nothing else. Beside it, `read` turns both texts into lines the same
 * way (whitespace, a cell's amount as a number); that is how a line is READ, not a tolerated difference.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WizardContext } from "../../offers/engine/answers";
import { numberOffer } from "../../offers/engine/numbering";
import { resolveOffer } from "../../offers/engine/resolve";
import { parseTemplate } from "../../offers/engine/syntax";
import { costsOf, documentText, type DocPart } from "../../test-support/documentText";
import "../../test-support/world";
import { goldenToAnswers, type GoldenState } from "./goldenAnswers";
import { WELLD_CH_IT_V1, WELLD_CH_IT_V1_RENAMES, type WizardSeedCode } from "./welldChIt";

const GOLDEN = join(import.meta.dir, "golden");

// ─── What is read from a printed document ──────────────────────────────────────────

type LineKind = "text" | "heading" | "annexHeading" | "cost";
interface Line {
  readonly text: string;
  readonly kind: LineKind;
  /** A cost line: the kind of the row (a discount row leaves its unit and quantity cells out). */
  readonly cost?: string;
}

const squeeze = (text: string): string => text.replace(/\s*\n\s*/g, " / ").replace(/\s+/g, " ").trim();

/** The engine's document text as the golden's plain format: one line per block, `| a | b |` per table row. */
function printedLines(parts: readonly DocPart[], skipRegions: ReadonlySet<string>): Line[] {
  const lines: Line[] = [];
  let marker = "";
  const rows = new Map<string, { cells: string[]; columns: number; cost: DocPart["cell"] }>();
  const columns = new Map<number, number>();
  for (const part of parts) if (part.cell) columns.set(part.cell.table, Math.max(columns.get(part.cell.table) ?? 0, part.cell.col + 1));

  const flushed = new Set<string>();
  for (const part of parts) {
    if (skipRegions.has(part.region)) continue;
    if (part.cell) {
      const id = `${part.cell.table}:${part.cell.row}`;
      let row = rows.get(id);
      if (!row) {
        row = { cells: Array.from({ length: columns.get(part.cell.table)! }, () => ""), columns: columns.get(part.cell.table)!, cost: part.cell };
        rows.set(id, row);
        lines.push({ text: id, kind: part.cell.cost ? "cost" : "text", ...(part.cell.cost ? { cost: part.cell.cost } : {}) });
      }
      row.cells[part.cell.col] = row.cells[part.cell.col] === "" ? squeeze(part.text) : `${row.cells[part.cell.col]} / ${squeeze(part.text)}`;
      flushed.delete(id);
      continue;
    }
    if (part.trailing) {
      marker = part.text === "•" ? "-" : part.text;
      continue;
    }
    const text = marker !== "" ? `${marker} ${squeeze(part.text)}` : squeeze(part.text);
    marker = "";
    const kind: LineKind = part.role === "annexHeading" ? "annexHeading" : part.role === "heading" || part.role === "subheading" ? "heading" : "text";
    lines.push({ text, kind });
  }
  // the table rows are placed where their first cell was
  return lines.map((line) => {
    const row = rows.get(line.text);
    if (!row || (line.kind !== "cost" && line.kind !== "text")) return line;
    return { ...line, text: `| ${row.cells.join(" | ")} |` };
  });
}

// ─── The AC-9.6 differences, and nothing else ──────────────────────────────────────────

interface Difference {
  readonly id: string;
  readonly what: string;
}

/**
 * The first six differences of AC-9.6. Each says what it removes or rewrites; `compare` applies them below.
 * 1. CRM-drawn header / acceptance / "Allegati:" — dropped from the golden, and not part of what the seed prints
 * 2. section numbers (and the upper case) the renderer gives headings — compared by their text
 * 3. the annex heading style of 018 ("ALLEGATO A – …" for "ALLEGATO A — …")
 * 4. T5's free "Allegati" field is replaced by the picker of the deal's PDFs — the golden's "Allegati:" list line
 * 5. a literal "CHF" next to an amount is the deal's currency
 * 6. the mockup's table column-width hints are not kept — the golden carries none
 */
export const ALLOWED_DIFFERENCES: readonly Difference[] = [
  { id: "crm-drawn-blocks", what: "page-1 header, acceptance block and the \"Allegati:\" list are drawn by the CRM" },
  { id: "renderer-section-numbers", what: "section and sub-heading numbers are assigned by the renderer (and its heading case)" },
  { id: "annex-heading-style", what: "an annex heading uses the 018 style" },
  { id: "annex-picker", what: "T5's free \"Allegati\" field is the deal's PDF picker" },
  { id: "deal-currency", what: "a literal \"CHF\" next to an amount is the deal's currency" },
  { id: "no-width-hints", what: "the mockup's column-width hints are not kept" },
];

/** 1 + 4: the golden without what the CRM draws: up to the title, the acceptance block, the "Allegati:" line. */
function dropCrmDrawn(golden: readonly string[]): string[] {
  const title = golden.findIndex((line) => /^CONTRATTO DI FORNITURA – Rif\. /.test(line));
  if (title < 0) throw new Error("the golden has no title line");
  const rest = golden.slice(title + 1);
  const from = rest.findIndex((line) => line.startsWith("Per accettazione"));
  const to = rest.findIndex((line) => line.startsWith("Firma valida del Cliente:"));
  if (from < 0 || to < from) throw new Error("the golden has no acceptance block");
  return [...rest.slice(0, from), ...rest.slice(to + 1)].filter((line) => !line.startsWith("Allegati:"));
}

// ─── Differences found beyond the six (reported, see the handback and decisions) ──────────

/**
 * The three print differences SA-5 added to AC-9.6, found by the comparison. They are not part of the first six: each
 * is a place where the plan's own decisions (engine and renderer, frozen) print something other than the mockup, and no seed text can
 * change it. They are named here so that the test states them, counts that each still occurs (so one that goes
 * away is removed), and so that nothing else can hide behind them. AC-9.6 lists these three since SA-5 (delegated
 * amendment, owner to review; the decimal comma is open question O4): the spec follows the engine, not the reverse.
 */
export const OBSERVED_DRIFT: readonly Difference[] = [
  { id: "decimal-separator", what: "an Italian offer prints a number field with a comma (0,5), the mockup with a dot (0.5) — engine formatNumber, plan DD-21" },
  { id: "amount-representation", what: "document amounts are 48’000 (018 formatting, DD-21), the mockup's 48'000.-; a discount row also prints its unit and quantity" },
  { id: "extra-row-placement", what: "a row typed into the cost table sits before the last total row (D-21/DD-35); the mockup puts it before the discount" },
];

// ─── Reading a line the same way on both sides ─────────────────────────────────────────

/** A cell that is a figure: `48'000.-` and `48’000` are 48000, `– 2'500.-` and `- 2’500` are -2500. */
function figure(cell: string, seen: Set<string>): string {
  const match = /^([-–]\s*)?(\d[\d'’]*(?:\.\d+)?)(\.-)?$/.exec(cell);
  if (!match) return cell;
  const out = `${match[1] ? "-" : ""}${match[2]!.replace(/['’]/g, "")}`;
  if (out !== cell && (match[3] || cell.includes("'"))) seen.add("amount-representation");
  return out;
}

function readCost(text: string, seen: Set<string>): string {
  const cells = text.slice(2, -2).split(" | ").map((cell) => figure(cell.trim(), seen));
  const columns = cells.length;
  // a discount row (a negative total): the mockup leaves the unit and quantity cells empty where the table prints the amount again
  const discount = columns >= 4 && cells[columns - 1]!.startsWith("-");
  const kept = discount ? cells.filter((_, index) => index < columns - 3 || index === columns - 1) : cells;
  if (discount && cells.slice(columns - 3, columns - 1).some((cell) => cell !== "")) seen.add("amount-representation");
  return kept.filter((cell) => cell !== "").join(" | ");
}

const stripNumber = (text: string): string => text.replace(/^\d+(?:\.\d+)*\.?\s+/, "").toLowerCase();
const annexHeading = (text: string): string => text.toUpperCase().replace(/^(ALLEGATO \S+)\s+[—–-]\s+/, "$1 – ");
const decimals = (text: string, seen: Set<string>): string => {
  const out = text.replace(/(\d),(\d)/g, "$1.$2");
  if (out !== text) seen.add("decimal-separator");
  return out;
};

/** Rows typed into the cost table (their descriptions) go just before the table's last total row, on both sides. */
function placeExtras(lines: string[], from: number, to: number, totalAt: number, labels: readonly string[], seen: Set<string>): void {
  const isExtra = (line: string) => line.startsWith("|") && line.slice(2, -2).split(" | ").some((cell) => labels.includes(cell.trim()));
  const segment = lines.slice(from, to);
  const extras = segment.filter(isExtra);
  if (extras.length === 0) return;
  const rest = segment.filter((line) => !isExtra(line));
  const total = totalAt - from - segment.slice(0, totalAt - from).filter(isExtra).length;
  const placed = totalAt < 0 ? [...rest, ...extras] : [...rest.slice(0, total), ...extras, ...rest.slice(total)];
  if (placed.join("\n") !== segment.join("\n")) seen.add("extra-row-placement");
  lines.splice(from, to - from, ...placed);
}

interface Compared {
  readonly mine: string[];
  readonly golden: string[];
  /** Which of the `OBSERVED_DRIFT` entries this comparison needed. */
  readonly drift: Set<string>;
  /** How many times each new difference was applied to the golden (zero for a run without an `IssuerRun`). */
  readonly substituted: { readonly name: number; readonly address: number };
}

/** What the golden says of the issuer: the mockup's profile, which every seed printed as literals before US-12 (DD-63). */
const GOLDEN_ISSUER = "WellD Sagl";
const GOLDEN_ADDRESS = "Via Pessina 9, CP 1920, CH-6901 Lugano";

/** The profile a second run prints; the golden is then read with exactly the two new differences of US-12 (AC-9.6). */
interface IssuerRun {
  readonly name: string;
  /** The address lines as saved; none leaves the SLA parties cell with the name alone (AC-12.12). */
  readonly addressLines: readonly string[];
}

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

function compare(mine: readonly Line[], goldenText: string, currency: string, extraLabels: readonly string[], issuer?: IssuerRun): Compared {
  const seen = new Set<string>();
  const substituted = { name: 0, address: 0 };
  const goldenLines = dropCrmDrawn(goldenText.split("\n").filter((line) => line !== "")).map((raw) => {
    let line = (raw.startsWith("|") ? raw : squeeze(raw)).replace(/\bCHF\b/g, currency);
    if (issuer) {
      // the two differences US-12 adds, and nothing else: the address first (it follows the name), then the name
      const address = issuer.addressLines.join(", ");
      substituted.address += occurrences(line, GOLDEN_ADDRESS);
      line = line.split(address === "" ? `, ${GOLDEN_ADDRESS}` : GOLDEN_ADDRESS).join(address);
      substituted.name += occurrences(line, GOLDEN_ISSUER);
      line = line.split(GOLDEN_ISSUER).join(issuer.name);
    }
    return line;
  });
  const ownLines = mine.map((line) => line.text);

  // the cost table's rows: where the seed's table runs, the golden's is at the same place
  let at = 0;
  while (at < mine.length) {
    if (mine[at]!.kind !== "cost") {
      at += 1;
      continue;
    }
    let end = at;
    while (end < mine.length && mine[end]!.kind === "cost") end += 1;
    let total = -1;
    for (let index = at; index < end; index += 1) if (mine[index]!.cost === "total") total = index;
    placeExtras(ownLines, at, end, total, extraLabels, seen);
    placeExtras(goldenLines, at, Math.min(end, goldenLines.length), total, extraLabels, seen);
    at = end;
  }

  const read = (line: string, kind: LineKind | undefined): string => {
    if (kind === "heading") return decimals(stripNumber(line), seen);
    if (kind === "annexHeading") return annexHeading(line);
    if (kind === "cost" && line.startsWith("|")) return readCost(line, seen);
    return decimals(line, seen);
  };
  return {
    mine: ownLines.map((line, index) => read(line, mine[index]!.kind)),
    golden: goldenLines.map((line, index) => read(line, mine[index]?.kind)),
    drift: seen,
    substituted,
  };
}

/** The first line where the two differ, with a little context; null when they are equal. */
function firstDifference({ mine, golden }: Pick<Compared, "mine" | "golden">): string | null {
  const length = Math.max(mine.length, golden.length);
  for (let at = 0; at < length; at += 1) {
    if (mine[at] !== golden[at]) {
      return [`line ${at + 1}`, `  seed:   ${mine[at] ?? "(none)"}`, `  golden: ${golden[at] ?? "(none)"}`, `  before: ${mine[at - 1] ?? "(start)"}`].join("\n");
    }
  }
  return null;
}

// ─── The fixtures ─────────────────────────────────────────────────────────────────

interface Case {
  readonly code: WizardSeedCode;
  readonly file: string;
  readonly answers: GoldenState;
  readonly text: string;
}

function cases(): Case[] {
  const out: Case[] = [];
  const read = (dir: string, name: string): Case => {
    const stem = name.replace(/^answers\./, "").replace(/\.json$/, "");
    const code = stem.replace(/-(minimal|consuntivo|corpo|rinnovo-tacito)$/, "") as WizardSeedCode;
    return {
      code,
      file: dir === GOLDEN ? stem : `variants/${stem}`,
      answers: JSON.parse(readFileSync(join(dir, name), "utf8")) as GoldenState,
      text: readFileSync(join(dir, `text.${stem}.txt`), "utf8"),
    };
  };
  for (const name of readdirSync(GOLDEN).filter((entry) => /^answers\..*\.json$/.test(entry)).sort()) out.push(read(GOLDEN, name));
  const variants = join(GOLDEN, "variants");
  for (const name of readdirSync(variants).filter((entry) => /^answers\..*\.json$/.test(entry)).sort()) out.push(read(variants, name));
  return out;
}

function printed(testCase: Case, context?: (base: WizardContext) => WizardContext) {
  const seed = WELLD_CH_IT_V1.find((entry) => entry.code === testCase.code)!;
  const { ast } = parseTemplate(seed.source);
  const mapping = goldenToAnswers(testCase.code, testCase.answers, ast);
  const ctx = context ? context(mapping.context) : mapping.context;
  const resolved = resolveOffer(ast, mapping.answers, ctx, { reference: mapping.reference });
  const numbered = numberOffer({
    language: resolved.language,
    sections: resolved.sections.map((section) => ({ key: section.key, heading: section.heading, body: section.body })),
    annexes: resolved.annexes.map((annex) => ({
      designation: annex.designation,
      title: annex.title,
      sections: annex.sections.map((section) => ({ key: section.key, heading: section.heading, body: section.body })),
    })),
    effortAnnex: false,
    attachmentNames: [],
  });
  const parts = documentText({ resolved, numbered, costs: costsOf(resolved), reference: mapping.reference, currency: ctx.currency, effort: null });
  return { mapping, resolved, parts, ctx };
}

const ALL = cases();
const extraLabels = (testCase: Case): string[] => Object.values(testCase.answers.x).flatMap((rows) => rows.map((row) => row.label));
const NEEDED = new Set<string>();
const SKIPPED = new Set(["header", "acceptance", "annexList", "index", "effort"]);

describe("the golden fixtures are all there", () => {
  it("has the seven mockup codes and every variant", () => {
    expect(ALL.filter((entry) => !entry.file.startsWith("variants/")).map((entry) => entry.code).sort()).toEqual(["T1", "T1+T3", "T2", "T3", "T4", "T5", "T6"]);
    expect(ALL.length).toBeGreaterThanOrEqual(17);
    expect(new Set(WELLD_CH_IT_V1.map((seed) => seed.code)).size).toBe(7);
  });

  it("the allow-list is the six differences of AC-9.6 and nothing else", () => {
    expect(ALLOWED_DIFFERENCES.map((difference) => difference.id)).toEqual([
      "crm-drawn-blocks",
      "renderer-section-numbers",
      "annex-heading-style",
      "annex-picker",
      "deal-currency",
      "no-width-hints",
    ]);
  });

  it("the golden answers are mapped through the catalog's renames, none written here (DD-48)", () => {
    expect(WELLD_CH_IT_V1_RENAMES.T4).toEqual([{ table: "MODULO", from: "ORE", to: "ORE_MODULO" }]);
    const t4 = ALL.find((entry) => entry.file === "T4")!;
    const { mapping } = printed(t4);
    expect(mapping.answers.tables.MODULO![0]!.cells.ORE_MODULO).toBeDefined();
    expect(mapping.answers.tables.MODULO![0]!.cells.ORE).toBeUndefined();
  });
});

/** The profile the mockup's seeds had written into their texts: run 1 of DD-63 (the bindings stand where the literals stood). */
const MOCKUP_PROFILE = (base: WizardContext): WizardContext => ({
  ...base,
  issuerLegalName: GOLDEN_ISSUER,
  issuerAddressLines: ["Via Pessina 9", "CP 1920", "CH-6901 Lugano"],
});

/** Run 2: another legal name and address; the golden is read with the two new differences only (AC-12.3, AC-12.10). */
const OTHER_ISSUER: IssuerRun = { name: "wellD SA", addressLines: ["Via Example 1", "6900 Lugano"] };
const OTHER_PROFILE = (issuer: IssuerRun) => (base: WizardContext): WizardContext => ({
  ...base,
  issuerLegalName: issuer.name,
  issuerAddressLines: issuer.addressLines,
});

/** How often the golden names the issuer ("WellD Sagl") per seed, and its address (once, in the SLA parties row). */
const NAME_COUNTS: Readonly<Record<WizardSeedCode, number>> = { T1: 2, T2: 2, T3: 5, T4: 2, T5: 2, T6: 2, "T1+T3": 5 };
const ADDRESS_COUNTS: Readonly<Record<WizardSeedCode, number>> = { T1: 0, T2: 0, T3: 1, T4: 0, T5: 0, T6: 0, "T1+T3": 1 };

describe("a seed prints what the mockup printed (AC-9.1, AC-9.6; run 1 of DD-63: the mockup's profile)", () => {
  for (const testCase of ALL) {
    it(`${testCase.file}`, () => {
      const { mapping, resolved, parts } = printed(testCase, MOCKUP_PROFILE);
      expect(mapping.unmapped).toEqual([]);
      expect(resolved.missing).toEqual([]);
      expect(resolved.invalid).toEqual([]);
      const mine = printedLines(parts, SKIPPED);
      expect(mine.length).toBeGreaterThan(20);
      const compared = compare(mine, testCase.text, "CHF", extraLabels(testCase));
      expect(firstDifference(compared)).toBeNull();
      for (const id of compared.drift) NEEDED.add(id);
    });
  }

  it("beyond the six, the only differences are the three reported ones, and each still occurs", () => {
    expect([...NEEDED].sort()).toEqual(OBSERVED_DRIFT.map((drift) => drift.id).sort());
  });
});

describe("another issuer prints the same text but for the two new differences (AC-9.6 changed, AC-12.3, AC-12.10; run 2 of DD-63)", () => {
  for (const testCase of ALL) {
    it(`${testCase.file}`, () => {
      const { resolved, parts } = printed(testCase, OTHER_PROFILE(OTHER_ISSUER));
      expect(resolved.missing).toEqual([]);
      const mine = printedLines(parts, SKIPPED);
      const compared = compare(mine, testCase.text, "CHF", extraLabels(testCase), OTHER_ISSUER);
      expect(firstDifference(compared)).toBeNull();
      // nothing of the old issuer is left, and the name was substituted as often as the golden says it
      expect(mine.some((line) => line.text.includes("WellD Sagl") || line.text.includes("Pessina"))).toBe(false);
      if (!testCase.file.startsWith("variants/")) {
        expect(compared.substituted).toEqual({ name: NAME_COUNTS[testCase.code], address: ADDRESS_COUNTS[testCase.code] });
      }
    });
  }

  it("the SLA parties cell reads the name and the address, comma-separated; «WellD» and the other Lugano stay (AC-12.10)", () => {
    for (const code of ["T3", "T1+T3"] as const) {
      const testCase = ALL.find((entry) => entry.file === code)!;
      const lines = printedLines(printed(testCase, OTHER_PROFILE(OTHER_ISSUER)).parts, SKIPPED).map((line) => line.text);
      expect(lines.filter((line) => line.includes("| wellD SA, Via Example 1, 6900 Lugano |"))).toHaveLength(1);
      expect(lines.some((line) => line.includes("wellD SA («WellD»)"))).toBe(true);
      expect(lines.filter((line) => line.includes("Lugano (Svizzera)")).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("with no address the parties cell is the name alone, no dangling comma (AC-12.12)", () => {
    const none: IssuerRun = { name: "wellD SA", addressLines: [] };
    for (const code of ["T3", "T1+T3"] as const) {
      const testCase = ALL.find((entry) => entry.file === code)!;
      const { parts } = printed(testCase, OTHER_PROFILE(none));
      const mine = printedLines(parts, SKIPPED);
      expect(firstDifference(compare(mine, testCase.text, "CHF", extraLabels(testCase), none))).toBeNull();
      expect(mine.map((line) => line.text)).toContain("| Fornitore | wellD SA | — |");
    }
  });

  it("is not vacuous: a golden read without the substitution differs (test of the test)", () => {
    const testCase = ALL.find((entry) => entry.file === "T3")!;
    const mine = printedLines(printed(testCase, OTHER_PROFILE(OTHER_ISSUER)).parts, SKIPPED);
    expect(firstDifference(compare(mine, testCase.text, "CHF", extraLabels(testCase)))).not.toBeNull();
  });
});

describe("the test fails when the seed's text differs (test of the test)", () => {
  it("a changed word in the golden is a difference", () => {
    const testCase = ALL.find((entry) => entry.file === "T1")!;
    const { parts } = printed(testCase);
    const mine = printedLines(parts, SKIPPED);
    const altered = testCase.text.replace("Collaudo: verifica", "Collaudo: controllo");
    expect(altered).not.toBe(testCase.text);
    expect(firstDifference(compare(mine, altered, "CHF", extraLabels(testCase)))).not.toBeNull();
  });

  it("a changed figure is a difference", () => {
    const testCase = ALL.find((entry) => entry.file === "T1")!;
    const { parts } = printed(testCase);
    const mine = printedLines(parts, SKIPPED);
    const altered = testCase.text.replace("58'900.50", "58'900.51");
    expect(altered).not.toBe(testCase.text);
    expect(firstDifference(compare(mine, altered, "CHF", extraLabels(testCase)))).not.toBeNull();
  });

  it("a dropped answer shows as a missing value, not as equal text", () => {
    const testCase = ALL.find((entry) => entry.file === "T1")!;
    const without = { ...testCase.answers, f: { ...testCase.answers.f, DURATA: "" } };
    const { resolved } = printed({ ...testCase, answers: without });
    expect(resolved.missing.length).toBeGreaterThan(0);
  });
});

describe("the deal's currency replaces a literal CHF (AC-9.6, AC-2.5)", () => {
  it("an EUR deal prints EUR where the mockup printed CHF", () => {
    const testCase = ALL.find((entry) => entry.file === "T1")!;
    const { parts } = printed(testCase, (base) => ({ ...base, currency: "EUR" }));
    const mine = printedLines(parts, SKIPPED).map((line) => line.text);
    expect(mine.some((line) => line.includes("140.- EUR/ora"))).toBe(true);
    expect(mine.some((line) => /\bCHF\b/.test(line))).toBe(false);
  });

  it("no label, hint or example of any seed names a currency, whatever the deal's currency (AC-9.6 SA-6, AC-2.5, QE D4, D8)", () => {
    const named: string[] = [];
    const CURRENCY = /\b(?:CHF|EUR|USD)\b|[€$]|\bFr\./;
    type Declared = { name: string; label: string | null; hint?: string | null; example?: string | null; explain?: string | null; default?: string | null; options?: string[] | null; columns?: string[] };
    for (const seed of WELLD_CH_IT_V1) {
      const { ast } = parseTemplate(seed.source);
      const declared = [...ast.fields, ...ast.lists, ...ast.tables, ...ast.blocks, ...ast.choices] as Declared[];
      for (const decl of declared) {
        const shown: [string, string | null | undefined][] = [
          ["label", decl.label],
          ["hint", decl.hint],
          ["example", decl.example],
          ["explain", decl.explain],
          ["default", decl.default],
          ...(decl.options ?? []).map((option): [string, string] => ["option", option]),
          ...(decl.columns ?? []).map((column): [string, string] => ["column", column]),
        ];
        for (const [member, text] of shown) if (text && CURRENCY.test(text)) named.push(`${seed.code} ${decl.name} ${member}: ${text}`);
      }
    }
    expect(named).toEqual([]);
  });
});
