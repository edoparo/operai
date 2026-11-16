import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardAnswers, type WizardContext } from "./answers";
import { outline, type Outline, type OutlineItem } from "./outline";
import { parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";
import vectors from "./vectors/outline.json";

const context = answerVectors.context as unknown as WizardContext;
const parse = (lines: readonly string[]) => parseTemplate(lines.join("\n")).ast;
const ast = parse(vectors.template);

function summarize(item: OutlineItem): string {
  switch (item.type) {
    case "field":
    case "list":
    case "table":
    case "choice":
      return `${item.type}:${item.name}`;
    case "block":
      return `block:${item.name}${item.children.length > 0 ? `(${item.children.map(summarize).join(",")})` : ""}`;
    case "costTable":
      return `costs(${item.lines.map((line) => line.key).join(",")}|${item.totals.join(",")})`;
  }
}

const sectionsOf = (step: Outline["steps"][number] | undefined) =>
  step ? step.sections.map((section) => `${section.heading}${section.annex ? `@${section.annex}` : ""}`) : [];
const stepOf = (result: Outline, key: string) => result.steps.find((step) => step.key === key);
const itemsOf = (result: Outline, key: string) => (stepOf(result, key)?.items ?? []).map(summarize);

function find(result: Outline, name: string): OutlineItem | undefined {
  const search = (items: OutlineItem[]): OutlineItem | undefined => {
    for (const item of items) {
      if ("name" in item && item.name === name) return item;
      if (item.type === "block") {
        const inner = search(item.children);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  for (const step of result.steps) {
    const found = search(step.items);
    if (found) return found;
  }
  return undefined;
}

/** specs/20261115-crm-offer-wizard AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-8.2; DD-33. */
describe("outline(ast, null) — the editor's", () => {
  const editor = outline(ast, null);

  it("lists every item, per step, in text order, nested under its block, whatever the block's state", () => {
    expect(editor.steps.map((step) => step.key)).toEqual(["scope", "conditions", "costs", "annexes"]);
    for (const key of ["scope", "conditions", "costs", "annexes"] as const) {
      const expected = vectors.editor[key];
      expect(itemsOf(editor, key)).toEqual(expected.items);
      expect(sectionsOf(stepOf(editor, key))).toEqual(expected.sections);
    }
  });

  it("leaves out what is declared and never used, and what the client block or the system fills", () => {
    expect(find(editor, "UNUSED")).toBeUndefined();
    expect(find(editor, "CLIENTE")).toBeUndefined();
  });

  it("a `step:` override moves the item", () => {
    expect(itemsOf(editor, "conditions")).not.toContain("field:OVR");
    expect(itemsOf(editor, "annexes")).toContain("field:OVR");
  });

  it("never reports a hand edit", () => {
    const edits = JSON.stringify(editor);
    expect(edits).not.toContain('"handEditedIn":["');
  });
});

describe("outline(ast, answers) — the wizard's", () => {
  for (const variant of vectors.wizard) {
    it(variant.name, () => {
      const answers = initialAnswers(ast, context);
      Object.assign(answers.blocks, variant.blocks);
      const wizard = outline(ast, answers);
      expect(itemsOf(wizard, "scope")).toEqual(variant.scope);
      expect(itemsOf(wizard, "conditions")).toEqual(variant.conditions);
      expect(itemsOf(wizard, "costs")).toEqual(variant.costs);
      expect(itemsOf(wizard, "annexes")).toEqual(variant.annexes);
      expect(sectionsOf(stepOf(wizard, "annexes"))).toEqual(variant.annexSections);
    });
  }

  it("a field used only inside an off block is absent from the wizard and present, nested, in the editor", () => {
    const answers = initialAnswers(ast, context);
    answers.blocks.blk = false;
    expect(find(outline(ast, answers), "IN_BLK")).toBeUndefined();
    expect(find(outline(ast, null), "IN_BLK")).toBeDefined();
  });

  it("a field also used outside the block is shown at that other place", () => {
    const template = parse([
      "@@salutation S", "", "## A", "{{b::[F]}}", "", "## B", "@@step costs", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "[F]", "",
      "@@field F", "label: F", "", "@@block b", "label: B",
    ]);
    const answers = initialAnswers(template, context);
    expect(itemsOf(outline(template, answers), "scope")).toEqual(["block:b"]);
    expect(itemsOf(outline(template, answers), "costs")).toEqual(["costs(a|)", "field:F"]);
    answers.blocks.b = true;
    expect(itemsOf(outline(template, answers), "scope")).toEqual(["block:b(field:F)"]);
    expect(itemsOf(outline(template, answers), "costs")).toEqual(["costs(a|)"]);
  });

  it("carries the hand-edited sections an item is read by (AC-5.2)", () => {
    const answers: WizardAnswers = {
      ...initialAnswers(ast, context),
      handEdits: { "OGGETTO#0": { heading: "OGGETTO", body: "x", sourceHeading: "OGGETTO" } },
    };
    const wizard = outline(ast, answers);
    expect((find(wizard, "A") as { handEditedIn: string[] }).handEditedIn).toEqual(["OGGETTO#0"]);
    expect((find(wizard, "C1") as { handEditedIn: string[] }).handEditedIn).toEqual([]);
    expect((find(wizard, "LIST1") as { handEditedIn: string[] }).handEditedIn).toEqual(["OGGETTO#0"]);
  });
});

describe("what an item carries (DD-33)", () => {
  const editor = outline(ast, null);

  it("a field: label, hint, example, kind, default, optional, derived, system, options, fills", () => {
    expect(find(editor, "A")).toEqual({
      type: "field", name: "A", label: "Campo A", hint: "Un aiuto", example: "es. A", kind: "text", default: "ciao",
      options: null, optional: false, derived: false, system: null, fills: [], handEditedIn: [],
    });
  });

  it("optional exactly when every occurrence sits in a {{?…}} naming the field, or only conditions name it", () => {
    expect((find(editor, "B") as { optional: boolean }).optional).toBe(true);
    expect((find(editor, "M") as { optional: boolean }).optional).toBe(false); // once plain, once optional
    expect((find(editor, "NEVER") as { optional: boolean }).optional).toBe(true); // only a {{!…}} names it
    expect((find(editor, "A") as { optional: boolean }).optional).toBe(false);
  });

  it("an @@OPT_START ?F block makes the uses inside it optional", () => {
    const template = parse(["@@salutation S", "", "@@OPT_START ?F", "[F]", "@@OPT_END", "[G]", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@field F", "label: F", "", "@@field G", "label: G"]);
    const result = outline(template, null);
    expect((find(result, "F") as { optional: boolean }).optional).toBe(true);
    expect((find(result, "G") as { optional: boolean }).optional).toBe(false);
  });

  it("derived, system, options and fills", () => {
    expect(find(editor, "DER")).toMatchObject({ derived: true, kind: "number" });
    expect(find(editor, "DEALF")).toMatchObject({ system: "deal", label: "Affare" });
    expect(find(editor, "LATE")).toMatchObject({
      options: ["x", "y"],
      fills: [{ option: "y", assigns: [{ name: "C1", label: "Uno", value: "5" }] }],
    });
  });

  it("a list and a table", () => {
    expect(find(editor, "LIST1")).toEqual({ type: "list", name: "LIST1", label: "Elenco", hint: "Uno per riga", optional: false, handEditedIn: [] });
    expect(find(editor, "TAB")).toEqual({
      type: "table", name: "TAB", label: "Tabella", hint: null, optional: false, handEditedIn: [],
      columns: [
        { name: "TAB", label: "Tabella", kind: "text", required: true },
        { name: "COL", label: "Colonna", kind: "number", required: false },
      ],
    });
  });

  it("a column a cost line uses as unit or quantity is required", () => {
    const template = parse([
      "@@salutation S", "", "[T]", "## C", "@@costs", "@@line a one_off each=T | d | unit=[PRICE] | qty=[QTY]", "@@end", "",
      "@@table T", "label: T", "columns: T, PRICE, QTY, NOTE", "", "@@field PRICE", "label: P", "kind: amount", "", "@@field QTY", "label: Q", "kind: number", "", "@@field NOTE", "label: N",
    ]);
    const table = find(outline(template, null), "T") as Extract<OutlineItem, { type: "table" }>;
    expect(table.columns.map((column) => [column.name, column.required])).toEqual([["T", true], ["PRICE", true], ["QTY", true], ["NOTE", false]]);
  });

  it("a block and a choice", () => {
    expect(find(editor, "blk")).toMatchObject({
      type: "block", label: "Blocco", explain: "Spiega", default: true, fills: [{ name: "C1", label: "Uno", value: "3" }],
    });
    expect(find(editor, "voce")).toMatchObject({ explain: null, default: false, fills: [], children: [] });
    expect(find(editor, "scelta")).toEqual({
      type: "choice", name: "scelta", label: "Scelta", default: "optb",
      options: [
        { block: "opta", label: "Opzione A", fills: [{ name: "IN_B", label: "In B", value: "a" }] },
        { block: "optb", label: "Opzione B", fills: [] },
      ],
    });
  });

  it("a choice defaults to its first option, and its options are never items of their own", () => {
    const template = parse(["@@salutation S", "", "{{p::a}}{{q::b}}", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@block p", "label: P", "", "@@block q", "label: Q", "", "@@choice c", "label: C", "options: p | q"]);
    const result = outline(template, null);
    expect(itemsOf(result, "scope")).toEqual(["choice:c", "costs(a|)"]);
    expect((find(result, "c") as { default: string }).default).toBe("p");
  });

  it("the cost table lists line keys (with the block and the table of each) and total labels without markup", () => {
    const costs = stepOf(editor, "costs")!.items.find((item) => item.type === "costTable") as Extract<OutlineItem, { type: "costTable" }>;
    expect(costs).toEqual({
      type: "costTable",
      lines: [
        { key: "a", kind: "one_off", each: null, block: null },
        { key: "v", kind: "one_off", each: "TAB", block: "voce" },
      ],
      totals: ["TOTALE", "Totale secondo"],
    });
  });
});

describe("steps", () => {
  const minimal = ["@@salutation S", "", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end"];

  it("a step with nothing to ask is omitted, even when it has a section", () => {
    const template = parse(["@@salutation S", "", "## FIXED", "Static text.", "", "## C", "@@step costs", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end"]);
    const result = outline(template, null);
    expect(result.steps.map((step) => step.key)).toEqual(["costs"]);
  });

  it("a template that asks nothing but the cost table has the costs step only", () => {
    expect(outline(parse(minimal), null).steps.map((step) => step.key)).toEqual(["scope"]);
    expect(itemsOf(outline(parse(minimal), null), "scope")).toEqual(["costs(a|)"]);
  });

  it("an empty text has no steps", () => {
    expect(outline(parse([""]), null)).toEqual({ steps: [] });
  });

  it("the fields of the opening go to the first contract section's step", () => {
    const template = parse(["@@salutation S", "", "[F]", "## C", "@@step costs", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@field F", "label: F"]);
    expect(itemsOf(outline(template, null), "costs")).toEqual(["field:F", "costs(a|)"]);
    expect(itemsOf(outline(template, null), "scope")).toEqual([]);
    const plain = parse(["@@salutation S", "", "[F]", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@field F", "label: F"]);
    expect(itemsOf(outline(plain, null), "scope")).toEqual(["field:F", "costs(a|)"]);
  });

  it("a block cannot nest an item that sits in another step", () => {
    const template = parse(["@@salutation S", "", "## A", "{{b::[F]}}", "", "## B", "@@step conditions", "{{b::[G]}}", "[H]", "", "## C", "@@step costs", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@block b", "label: B", "", "@@field F", "label: F", "", "@@field G", "label: G", "", "@@field H", "label: H"]);
    const result = outline(template, null);
    expect(itemsOf(result, "scope")).toEqual(["block:b(field:F)"]);
    expect(itemsOf(result, "conditions")).toEqual(["field:G", "field:H"]);
  });

  it("terminates on blocks that enclose each other in turn", () => {
    const template = parse(["@@salutation S", "", "{{a::{{b::x}}}} {{b::{{a::y}}}}", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@block a", "label: A", "", "@@block b", "label: B"]);
    const result = outline(template, null);
    expect(itemsOf(result, "scope")).toEqual(["block:a(block:b)", "costs(a|)"]);
  });
});
