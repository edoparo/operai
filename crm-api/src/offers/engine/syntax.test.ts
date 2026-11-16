import { describe, expect, it } from "bun:test";
import { parseTemplate, type Inline, type ProblemCode } from "./syntax";
import vectors from "./vectors/syntax.json";

type Entry = string | { repeat: number; line: string };
interface Vector {
  name: string;
  lines: Entry[];
  problems: { line: number; severity: "error" | "warning"; code: ProblemCode; name?: string }[];
}

/** `{x<n>}` stands for n times "x"; `{i}` for the 1-based repetition number. */
function expand(entries: Entry[]): string {
  const out: string[] = [];
  const fill = (text: string, i: number) =>
    text.replace(/\{x(\d+)\}/g, (_, n: string) => "x".repeat(Number(n))).replace(/\{i\}/g, String(i));
  for (const entry of entries) {
    if (typeof entry === "string") out.push(fill(entry, 1));
    else for (let i = 1; i <= entry.repeat; i++) out.push(fill(entry.line, i));
  }
  return out.join("\n");
}

const cases = vectors.cases as unknown as Vector[];

/** The problems about declarations belong to syntax.declarations.test.ts; these vectors pin the structure. */
const DECLARATION_CODES = new Set<string>([
  "field_undeclared", "label_missing", "declared_unused", "choice_too_few_options", "choice_option_unknown",
  "name_duplicate", "table_column_unknown", "column_in_two_tables", "compute_invalid", "compute_cycle",
  "fills_unknown", "source_unknown", "optional_heading_not_last", "declaration_invalid",
]);
const structural = (problems: readonly { code: string }[]) => problems.filter((problem) => !DECLARATION_CODES.has(problem.code));

/** specs/20261115-crm-offer-wizard AC-8.3, AC-9.5, AC-4.6, AC-4.7 — the structural problems, each with its line. */
describe("vectors/syntax.json", () => {
  for (const vector of cases) {
    it(vector.name, () => {
      expect(structural(parseTemplate(expand(vector.lines)).problems)).toEqual(vector.problems);
    });
  }

  it("has a vector for every structural code", () => {
    const codes = new Set<string>(cases.flatMap((vector) => vector.problems.map((problem) => problem.code)));
    for (const code of [
      "block_not_closed", "unexpected_close", "no_costs_section", "costs_not_first", "costs_not_closed",
      "cost_line_invalid", "cost_key_duplicate", "cost_line_after_last_total", "percent_discount_multi_total",
      "annex_designation_invalid", "annex_designation_duplicate", "salutation_missing", "too_many_sections",
      "too_many_annexes", "too_many_annex_sections", "heading_too_long", "too_large", "nesting_too_deep",
      "reserved_character", "non_printable_character", "step_unknown",
    ]) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

const WORKED = [
  "@@salutation Spett.le",
  "@@acceptance Il Cliente",
  "@@effort-annex on",
  "",
  "Con riferimento alle discussioni, offerta per **[CLIENTE]**.",
  "",
  "## DEFINIZIONI",
  "@@step scope",
  "**Collaudo:** verifica nel par. 2{{allegato_a:: e nell'Allegato A}}.",
  "",
  "## OGGETTO DELLA FORNITURA",
  "Oggetto è **[OGGETTO]**{{?DESCR::: **[DESCR]**}}.",
  "",
  "- {{?FUNZ::**[FUNZ]**}}",
  "",
  "## COSTI",
  "@@step costs",
  "@@costs position unit",
  "@@costlabels [VALUTA] / giorno | Giorni",
  "@@line oggetto one_off | **[OGGETTO]**, a corpo | unit=deal | qty=1",
  "@@OPT_START voce2",
  "@@line voce2 one_off each=TAB | **[SECONDA]** | unit=[PREZZO] | qty=manDays",
  "@@OPT_END",
  "@@OPT_START sconto",
  "@@line sconto discount | Scontistica | unit=?",
  "@@OPT_END",
  "@@total **TOTALE**",
  "@@line scelta option | □ **[VOCE]** | unit=150.50 | qty=?",
  "@@end",
  "",
  "**Note:** testo.",
  "",
  "## CONDIZIONI",
  "Altro.",
  "",
  "@@OPT_START allegato_a",
  "@@annex A Perimetro{{?STIMA:: e stime}}",
  "@@subtitle [RIF]",
  "Intro dell'allegato.",
  "## PRIMA PARTE",
  "Testo.",
  "@@OPT_END",
  "",
  "@@field CLIENTE",
  "label: Cliente",
  "source: client",
  "",
  "@@block voce2",
  "label: Seconda voce",
  "fills: A = b: c",
].join("\n");

const textOf = (nodes: readonly Inline[]): string =>
  nodes
    .map((node) =>
      node.type === "text"
        ? node.text
        : node.type === "field"
          ? `[${node.name}]`
          : `{{${node.cond.op}:${node.cond.names.join(",")}:${textOf(node.children)}}}`,
    )
    .join("");

describe("parseTemplate structure", () => {
  const { ast, problems } = parseTemplate(WORKED);

  it("reads the worked example without a structural problem", () => {
    expect(structural(problems)).toEqual([]);
  });

  it("reads the opening and the directives", () => {
    expect(ast.salutation).toBe("Spett.le");
    expect(ast.acceptanceLabel).toBe("Il Cliente");
    expect(ast.effortAnnex).toBe(true);
    const lines = ast.opening.filter((line) => line.nodes.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.line).toBe(5);
    expect(textOf(lines[0]!.nodes)).toBe("Con riferimento alle discussioni, offerta per **[CLIENTE]**.");
  });

  it("defaults to no acceptance label and no effort annex", () => {
    const bare = parseTemplate("@@salutation X\n## C\n@@costs\n@@line a one_off | d | unit=? | qty=1\n@@end").ast;
    expect(bare.acceptanceLabel).toBeNull();
    expect(bare.effortAnnex).toBe(false);
  });

  it("splits the sections with keys, steps and the costs section", () => {
    expect(ast.sections.map((section) => section.key)).toEqual([
      "DEFINIZIONI#0",
      "OGGETTO DELLA FORNITURA#0",
      "COSTI#0",
      "CONDIZIONI#0",
    ]);
    expect(ast.sections.map((section) => section.step)).toEqual(["scope", "scope", "costs", "costs"]);
    expect(ast.sections.map((section) => section.costs !== null)).toEqual([false, false, true, false]);
  });

  it("gives the first section the step scope when none is written", () => {
    const plain = parseTemplate(
      "@@salutation X\n## A\ntext\n## C\n@@costs\n@@line a one_off | d | unit=? | qty=1\n@@end",
    ).ast;
    expect(plain.sections.map((section) => section.step)).toEqual(["scope", "scope"]);
  });

  it("reads conditions inline, nested and with the first :: ending the head", () => {
    const body = ast.sections[0]!.body.find((line) => line.nodes.length > 0)!;
    expect(textOf(body.nodes)).toBe("**Collaudo:** verifica nel par. 2{{on:allegato_a: e nell'Allegato A}}.");
    const subject = ast.sections[1]!.body.find((line) => line.nodes.length > 0)!;
    expect(textOf(subject.nodes)).toBe("Oggetto è **[OGGETTO]**{{any:DESCR:: **[DESCR]**}}.");
  });

  it("reads a list line that holds only a conditional field", () => {
    const list = ast.sections[1]!.body.find((line) => line.nodes.length > 0 && textOf(line.nodes).startsWith("- "))!;
    expect(textOf(list.nodes)).toBe("- {{any:FUNZ:**[FUNZ]**}}");
  });

  it("reads the cost table: columns, labels, lines, blocks, totals", () => {
    const costs = ast.sections[2]!.costs!;
    expect(costs.line).toBe(18);
    expect(costs.columns).toEqual({ position: true, unit: true });
    expect(textOf(costs.labels!.unit)).toBe("[VALUTA] / giorno");
    expect(textOf(costs.labels!.quantity!)).toBe("Giorni");
    expect(costs.items.map((item) => item.type)).toEqual(["line", "line", "line", "total", "line"]);
    const [first, second, discount, total, option] = costs.items as never as {
      type: string;
      key: string;
      kind: string;
      each: string | null;
      unit: unknown;
      qty: unknown;
      conds: unknown[];
      line: number;
      description: Inline[];
      label: Inline[];
    }[];
    expect(first).toMatchObject({
      key: "oggetto",
      kind: "one_off",
      each: null,
      unit: { type: "deal" },
      qty: { type: "literal", value: 1 },
      conds: [],
      line: 20,
    });
    expect(textOf(first!.description)).toBe("**[OGGETTO]**, a corpo");
    expect(second).toMatchObject({
      key: "voce2",
      each: "TAB",
      unit: { type: "field", name: "PREZZO" },
      qty: { type: "manDays" },
      conds: [{ op: "on", names: ["voce2"] }],
      line: 22,
    });
    expect(discount).toMatchObject({
      kind: "discount",
      unit: { type: "entered" },
      qty: null,
      conds: [{ op: "on", names: ["sconto"] }],
    });
    expect(textOf(total!.label)).toBe("**TOTALE**");
    expect(option).toMatchObject({ kind: "option", unit: { type: "amount", cents: 15050 }, qty: { type: "entered" } });
  });

  it("reads the unit forms", () => {
    const parse = (unit: string, kind = "discount") =>
      (
        parseTemplate(
          `@@salutation X\n## C\n@@costs\n@@line a ${kind} | d | unit=${unit}${kind === "discount" ? "" : " | qty=1"}\n@@end`,
        ).ast.sections[0]!.costs!.items[0] as { unit: unknown }
      ).unit;
    expect(parse("10%")).toEqual({ type: "percent", bp: 1000 });
    expect(parse("12.5%")).toEqual({ type: "percent", bp: 1250 });
    expect(parse("150", "one_off")).toEqual({ type: "amount", cents: 15000 });
    expect(parse("perRelease", "yearly")).toEqual({ type: "perRelease" });
  });

  it("keeps the notes after the table as the section's body", () => {
    const notes = ast.sections[2]!.body.filter((line) => line.nodes.length > 0);
    expect(textOf(notes[0]!.nodes)).toBe("**Note:** testo.");
  });

  it("reads an annex inside a block, with its title, subtitle, intro and sections", () => {
    expect(ast.annexes).toHaveLength(1);
    const annex = ast.annexes[0]!;
    expect(annex.designation).toBe("A");
    expect(textOf(annex.title)).toBe("Perimetro{{any:STIMA: e stime}}");
    expect(textOf(annex.subtitle!)).toBe("[RIF]");
    expect(annex.conds).toEqual([{ op: "on", names: ["allegato_a"] }]);
    expect(annex.intro.some((line) => textOf(line.nodes) === "Intro dell'allegato.")).toBe(true);
    expect(annex.sections.map((section) => [section.key, section.step, section.conds.length])).toEqual([
      ["PRIMA PARTE#0", "annexes", 1],
    ]);
  });

  it("carries the enclosing blocks on every body line", () => {
    const part = ast.annexes[0]!.sections[0]!.body.find((line) => line.nodes.length > 0)!;
    expect(part.conds).toEqual([{ op: "on", names: ["allegato_a"] }]);
    expect(ast.sections[0]!.body.every((line) => line.conds.length === 0)).toBe(true);
  });

  it("collects the declarations raw, with their lines", () => {
    expect(ast.declarations).toEqual([
      {
        kind: "field",
        name: "CLIENTE",
        line: 44,
        entries: [
          { line: 45, key: "label", value: "Cliente" },
          { line: 46, key: "source", value: "client" },
        ],
      },
      {
        kind: "block",
        name: "voce2",
        line: 48,
        entries: [
          { line: 49, key: "label", value: "Seconda voce" },
          { line: 50, key: "fills", value: "A = b: c" },
        ],
      },
    ]);
  });
});

describe("parseTemplate details", () => {
  const section = (body: string) =>
    parseTemplate(`@@salutation X\n## A\n${body}\n## C\n@@costs\n@@line a one_off | d | unit=? | qty=1\n@@end`).ast
      .sections[0]!;

  it("keeps an escaped bracket or brace literal", () => {
    const line = section("Price \\[X] and \\{{a::b}}").body[0]!;
    expect(textOf(line.nodes)).toBe("Price \\[X] and \\{{a::b}}");
  });

  it("reads a list of fields, ! and a condition on several fields", () => {
    const line = section("{{!A,B::none}}{{?C,D::any}}").body[0]!;
    expect(textOf(line.nodes)).toBe("{{none:A,B:none}}{{any:C,D:any}}");
  });

  it("a condition head that is not a condition stays text", () => {
    expect(textOf(section("{{ not a cond }} and [1] and [lower]").body[0]!.nodes)).toBe(
      "{{ not a cond }} and [1] and [lower]",
    );
  });

  it("a field name keeps accents, digits and underscores, up to 40 characters", () => {
    const tooLong = "A" + "B".repeat(40);
    const nodes = section(`[FUNZIONALITÀ_1] [${tooLong}]`).body[0]!.nodes;
    expect(nodes.filter((node) => node.type === "field").map((node) => (node as { name: string }).name)).toEqual([
      "FUNZIONALITÀ_1",
    ]);
    const longest = "A" + "B".repeat(39);
    const ok = section(`[${longest}]`).body[0]!.nodes;
    expect(ok).toEqual([{ type: "field", name: longest }]);
  });

  it("numbers repeated headings and reads CRLF files", () => {
    const { ast } = parseTemplate(
      "@@salutation X\r\n## A\r\nx\r\n## A\r\ny\r\n## C\r\n@@costs\r\n@@line a one_off | d | unit=? | qty=1\r\n@@end\r\n",
    );
    expect(ast.sections.map((s) => s.key)).toEqual(["A#0", "A#1", "C#0"]);
  });

  it("@@step on an annex section overrides the default", () => {
    const { ast } = parseTemplate(
      "@@salutation X\n## C\n@@costs\n@@line a one_off | d | unit=? | qty=1\n@@end\n@@annex SLA Titolo\n## P\n@@step conditions\nx",
    );
    expect(ast.annexes[0]!.sections[0]!.step).toBe("conditions");
  });

  it("a declaration ends at a blank line or the next @@ line", () => {
    const { ast } = parseTemplate(
      "@@salutation X\n@@field A\nlabel: a\n@@field B\nlabel: b\n\ntext\n## C\n@@costs\n@@line a one_off | d | unit=? | qty=1\n@@end",
    );
    expect(ast.declarations.map((d) => [d.name, d.entries.length])).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
    expect(ast.opening.some((line) => textOf(line.nodes) === "text")).toBe(true);
  });
});
