/**
 * The golden answers (the mockup's state, `golden/answers.*.json`) as `WizardAnswers` for a seed (specs/20261115-crm-offer-wizard
 * T35; AC-9.1, AC-9.6, DD-48, DD-49). Test support: the golden fixtures stay exactly as captured, and the only
 * renames come from the catalog (`WELLD_CH_IT_V1_RENAMES`, DD-48) — nothing is renamed here.
 *
 * What the mockup state holds and where it goes:
 * - `f` — scalar fields. The system values leave it: `CLIENTE`/`INDIRIZZO_CLIENTE` → the client block, `DATA` → the
 *   printed date (and the context's day), `RIF` → the offer's reference, `VALIDITA_GIORNI` → the validity,
 *   `REFERENTE_CLIENTE` → the offer's contact. Every other key must be a stored field of the seed.
 * - `g` — optional blocks and the options of a choice (true = kept); `lists`; `rows` → tables (the renamed column
 *   of DD-48 applied); `tpl` is the mockup id (`T13` = `T1+T3`).
 * - `c` — the figures typed in the cost table: `<block>:<row>:unit|qty|sconto`, `<row>` being the 1-based place of
 *   the row among the table's rows as the template declares them (total rows count); a `sconto` figure is the
 *   table's discount line's entered amount. `x` — extra rows typed in the table, by block id.
 */

import type { CostLineAnswer, WizardAnswers, WizardContext } from "../../offers/engine/answers";
import { initialAnswers, sampleContext } from "../../offers/engine/answers";
import type { CostLineAst, FieldDecl, TemplateAst } from "../../offers/engine/syntax";
import { WELLD_CH_IT_V1_RENAMES, type WizardSeedCode } from "./welldChIt";

export interface GoldenState {
  readonly tpl: string;
  readonly f: Readonly<Record<string, string>>;
  readonly g: Readonly<Record<string, boolean>>;
  readonly lists: Readonly<Record<string, readonly string[]>>;
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>>;
  readonly c: Readonly<Record<string, string>>;
  readonly x: Readonly<Record<string, readonly { readonly label: string; readonly unit: string; readonly qty: string }[]>>;
}

/** The day the golden was captured: the context's `today`, and what `DATA` prints. */
export const GOLDEN_DAY = "2026-11-15";

/** Field names of the mockup that the answers take from somewhere else. */
const SYSTEM_KEYS = new Set(["CLIENTE", "INDIRIZZO_CLIENTE", "DATA", "RIF", "VALIDITA_GIORNI", "REFERENTE_CLIENTE"]);
/** Mockup fields no seed has any more: T5's free list of annexes became the picker of the deal's PDFs (AC-9.6, DD-24). */
const DROPPED_BY_DESIGN: Readonly<Partial<Record<WizardSeedCode, readonly string[]>>> = { T5: ["ELENCO_ALLEGATI"] };

export interface GoldenMapping {
  readonly answers: WizardAnswers;
  readonly context: WizardContext;
  readonly reference: string;
  /** What could not be placed: a key or a value the seed has no home for. Empty when the mapping is complete. */
  readonly unmapped: string[];
}

const cents = (text: string): number | null => {
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
};

function valueOf(field: FieldDecl, text: string, where: string, unmapped: string[]): string | number | null {
  if (field.kind === "amount") {
    const value = cents(text);
    if (value === null) unmapped.push(`${where}: "${text}" is not an amount`);
    return value;
  }
  if (field.kind === "number" || field.kind === "percentage") {
    if (!/^-?\d+(\.\d+)?$/.test(text)) unmapped.push(`${where}: "${text}" is not a number`);
    return text;
  }
  if (field.options !== null && !field.options.includes(text)) unmapped.push(`${where}: "${text}" is not one of the options`);
  return text;
}

export function goldenToAnswers(code: WizardSeedCode, golden: GoldenState, ast: TemplateAst): GoldenMapping {
  const unmapped: string[] = [];
  const fieldsByName = new Map(ast.fields.map((field) => [field.name, field]));
  const costs = ast.sections.find((section) => section.costs !== null)?.costs ?? null;
  const items = costs?.items ?? [];
  const reference = golden.f.RIF ?? "";

  const referent = golden.f.REFERENTE_CLIENTE;
  const base = sampleContext("it");
  const context: WizardContext = {
    ...base,
    today: GOLDEN_DAY,
    dealAmountCents: null,
    // the profile the mockup's seeds had written into their texts (DD-63 run 1); the fidelity test runs another one too
    issuerLegalName: "WellD Sagl",
    issuerAddressLines: ["Via Pessina 9", "CP 1920", "CH-6901 Lugano"],
    clientLines: { it: [golden.f.CLIENTE ?? "", ...(golden.f.INDIRIZZO_CLIENTE ?? "").split("\n").filter((line) => line !== "")], en: [] },
    contacts: referent ? [{ id: "golden-contact", name: referent }] : [],
    attachments: [],
    estimate: null,
  };

  const answers = initialAnswers(ast, context);
  answers.client.contactIds = referent ? ["golden-contact"] : [];
  answers.client.date = golden.f.DATA ?? null;
  if (golden.f.VALIDITA_GIORNI) answers.validityDays = Number(golden.f.VALIDITA_GIORNI);

  // scalar fields: exactly what the golden holds, none of the seed's own defaults
  answers.fields = {};
  answers.prefilled = {};
  for (const [name, text] of Object.entries(golden.f)) {
    if (SYSTEM_KEYS.has(name) || DROPPED_BY_DESIGN[code]?.includes(name)) continue;
    const field = fieldsByName.get(name);
    if (!field || field.compute !== null || field.source !== null) {
      unmapped.push(`f.${name}: the seed has no stored field of that name`);
      continue;
    }
    const value = valueOf(field, text, `f.${name}`, unmapped);
    if (value !== null && value !== "") answers.fields[name] = value;
  }

  // blocks and the options of a choice
  for (const name of Object.keys(golden.g)) {
    if (!ast.blocks.some((block) => block.name === name)) unmapped.push(`g.${name}: the seed has no such block`);
  }
  answers.blocks = {};
  for (const block of ast.blocks) answers.blocks[block.name] = golden.g[block.name] === true;
  for (const choice of ast.choices) {
    const on = choice.options.filter((option) => answers.blocks[option]);
    if (on.length !== 1) unmapped.push(`g: ${choice.name} has ${on.length} options on, not one`);
  }

  // lists and tables
  for (const name of Object.keys(golden.lists)) if (!ast.lists.some((list) => list.name === name)) unmapped.push(`lists.${name}: the seed has no such list`);
  answers.lists = {};
  for (const list of ast.lists) answers.lists[list.name] = [...(golden.lists[list.name] ?? [])];
  for (const name of Object.keys(golden.rows)) if (!ast.tables.some((table) => table.name === name)) unmapped.push(`rows.${name}: the seed has no such table`);
  const renames = WELLD_CH_IT_V1_RENAMES[code] ?? [];
  answers.tables = {};
  for (const table of ast.tables) {
    answers.tables[table.name] = (golden.rows[table.name] ?? []).map((row, index) => {
      const cells: Record<string, string | number> = {};
      for (const [column, text] of Object.entries(row)) {
        const target = renames.find((rename) => rename.table === table.name && rename.from === column)?.to ?? column;
        if (!table.columns.includes(target)) {
          unmapped.push(`rows.${table.name}[${index}].${column}: the table has no column ${target}`);
          continue;
        }
        const field = fieldsByName.get(target);
        const value = !field ? text : valueOf(field, text, `rows.${table.name}[${index}].${column}`, unmapped);
        if (value !== null && value !== "") cells[target] = value;
      }
      return { id: `row${index + 1}`, cells };
    });
  }

  // the cost table: figures typed in it, then the extra rows
  answers.costs.lines = {};
  const lineAt = (row: number): CostLineAst | null => {
    const item = items[row - 1];
    return item?.type === "line" ? item : null;
  };
  const entry = (line: CostLineAst): CostLineAnswer => (answers.costs.lines[line.key] ??= {});
  const discountLine = items.find((item): item is CostLineAst => item.type === "line" && item.kind === "discount") ?? null;
  for (const [key, text] of Object.entries(golden.c)) {
    const [, rowText, what] = key.split(":");
    const line = what === "sconto" ? discountLine : lineAt(Number(rowText));
    if (!line) {
      unmapped.push(`c.${key}: no cost line there`);
      continue;
    }
    if (what === "qty") {
      entry(line).quantity = Number(text);
    } else {
      const value = cents(text);
      if (value === null) unmapped.push(`c.${key}: "${text}" is not an amount`);
      else entry(line).unitCents = value;
    }
  }
  answers.costs.extra = Object.values(golden.x).flatMap((rows) =>
    rows.map((row, index) => ({
      id: `extra${index + 1}`,
      description: row.label,
      kind: "one_off" as const,
      unitCents: cents(row.unit),
      percentBp: null,
      quantity: Number(row.qty),
    })),
  );

  return { answers, context, reference, unmapped };
}
