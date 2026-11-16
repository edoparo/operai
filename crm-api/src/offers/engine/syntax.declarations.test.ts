import { describe, expect, it } from "bun:test";
import { parseTemplate, type ProblemCode } from "./syntax";
import vectors from "./vectors/declarations.json";

interface Vector {
  name: string;
  lines: string[];
  problems: { line: number; severity: "error" | "warning"; code: ProblemCode; name?: string }[];
}

const cases = vectors.cases as unknown as Vector[];

/** specs/20261115-crm-offer-wizard AC-1.3, AC-1.8, AC-1.9, AC-4.5, AC-8.1, AC-8.3 — the declarations and their problems. */
describe("vectors/declarations.json", () => {
  for (const vector of cases) {
    it(vector.name, () => {
      expect(parseTemplate(vector.lines.join("\n")).problems).toEqual(vector.problems);
    });
  }

  it("has a vector for every declaration code", () => {
    const codes = new Set<string>(cases.flatMap((vector) => vector.problems.map((problem) => problem.code)));
    for (const code of [
      "field_undeclared", "label_missing", "declared_unused", "choice_too_few_options", "choice_option_unknown",
      "name_duplicate", "table_column_unknown", "column_in_two_tables", "compute_invalid", "compute_cycle",
      "fills_unknown", "source_unknown", "step_unknown", "optional_heading_not_last", "declaration_invalid",
    ]) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

const TEMPLATE = [
  "@@salutation S",
  "",
  "[CLIENTE] [DESC] [PROFILO] [IMPORTO] [PERC] [DATA] [SALDO] {{blocco::x}} {{altro::y}} [ELENCO]",
  "",
  "## COSTI",
  "@@costs",
  "@@line a one_off each=SERVIZI | [SERVIZI] | unit=[PREZZO] | qty=1",
  "@@end",
  "",
  "@@field CLIENTE",
  "source: client",
  "",
  "@@field DESC",
  "label: Descrizione",
  "hint: Una frase",
  "example: es. Portale",
  "kind: longtext",
  "default: ciao",
  "step: conditions",
  "",
  "@@field PROFILO",
  "label: Profilo",
  "options: Base | Gold | Platinum",
  "default: Gold",
  "fills Gold: IMPORTO = 5000",
  "fills Gold: PERC = 10",
  "fills Platinum: PERC = 20",
  "",
  "@@field IMPORTO",
  "label: Importo",
  "kind: amount",
  "",
  "@@field PERC",
  "label: Percentuale",
  "kind: percentage",
  "default: 12.5",
  "",
  "@@field DATA",
  "label: Data",
  "kind: date",
  "default: today",
  "",
  "@@field SALDO",
  "label: Saldo",
  "kind: percentage",
  "compute: 100 - PERC - sum(PREZZO)",
  "",
  "@@field PREZZO",
  "label: Prezzo",
  "kind: amount",
  "",
  "@@list ELENCO",
  "label: Elenco",
  "hint: Uno per riga",
  "step: scope",
  "",
  "@@table SERVIZI",
  "label: Servizi",
  "columns: SERVIZI, PREZZO",
  "",
  "@@block blocco",
  "label: Blocco",
  "explain: Spiega",
  "default: on",
  "fills: IMPORTO = 100",
  "step: costs",
  "",
  "@@block altro",
  "label: Altro",
  "",
  "@@choice scelta",
  "label: Scelta",
  "options: blocco | altro",
  "default: altro",
].join("\n");

describe("parseTemplate declarations", () => {
  const { ast, problems } = parseTemplate(TEMPLATE);

  it("reads the full example without an error", () => {
    expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
  });

  it("reads a source-only field, with every optional key empty", () => {
    expect(ast.fields.find((field) => field.name === "CLIENTE")).toEqual({
      name: "CLIENTE",
      line: 10,
      label: null,
      hint: null,
      example: null,
      kind: "text",
      default: null,
      options: null,
      fills: [],
      source: "client",
      compute: null,
      step: null,
    });
  });

  it("reads label, hint, example, kind, default and step", () => {
    expect(ast.fields.find((field) => field.name === "DESC")).toMatchObject({
      label: "Descrizione",
      hint: "Una frase",
      example: "es. Portale",
      kind: "longtext",
      default: "ciao",
      step: "conditions",
    });
  });

  it("reads options and the fills of each option, grouped", () => {
    const profile = ast.fields.find((field) => field.name === "PROFILO")!;
    expect(profile.options).toEqual(["Base", "Gold", "Platinum"]);
    expect(profile.default).toBe("Gold");
    expect(profile.fills).toEqual([
      { option: "Gold", assigns: [{ name: "IMPORTO", value: "5000" }, { name: "PERC", value: "10" }] },
      { option: "Platinum", assigns: [{ name: "PERC", value: "20" }] },
    ]);
  });

  it("reads a derived field with its expression", () => {
    const saldo = ast.fields.find((field) => field.name === "SALDO")!;
    expect(saldo.compute).toMatchObject({ source: "100 - PERC - sum(PREZZO)" });
    expect(saldo.compute!.line).toBe(46);
  });

  it("reads lists, tables, blocks and choices", () => {
    expect(ast.lists).toEqual([{ name: "ELENCO", line: 52, label: "Elenco", hint: "Uno per riga", step: "scope" }]);
    expect(ast.tables).toEqual([{ name: "SERVIZI", line: 57, label: "Servizi", hint: null, columns: ["SERVIZI", "PREZZO"], step: null }]);
    expect(ast.blocks).toEqual([
      { name: "blocco", line: 61, label: "Blocco", explain: "Spiega", default: true, fills: [{ name: "IMPORTO", value: "100" }], step: "costs" },
      { name: "altro", line: 68, label: "Altro", explain: null, default: false, fills: [], step: null },
    ]);
    expect(ast.choices).toEqual([{ name: "scelta", line: 71, label: "Scelta", options: ["blocco", "altro"], default: "altro", step: null }]);
  });

  it("lists every @@OPT_START with its line, for the wizard and the editor", () => {
    const parsed = parseTemplate("@@salutation S\n@@OPT_START x\n@@OPT_START ?A,B\nt\n@@OPT_END\n@@OPT_END\n");
    expect(parsed.ast.optBlocks).toEqual([
      { line: 2, cond: { op: "on", names: ["x"] } },
      { line: 3, cond: { op: "any", names: ["A", "B"] } },
    ]);
  });

  it("a choice defaults to none until the engine picks the first option", () => {
    const parsed = parseTemplate("@@salutation S\n{{x::a}}{{y::b}}\n\n@@block x\nlabel: X\n\n@@block y\nlabel: Y\n\n@@choice c\nlabel: C\noptions: x | y");
    expect(parsed.ast.choices[0]!.default).toBeNull();
  });
});
