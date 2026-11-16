import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardAnswers, type WizardContext } from "./answers";
import { resolveOffer, type ResolvedOffer } from "./resolve";
import { parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";
import costVectors from "./vectors/resolve.costs.json";
import textVectors from "./vectors/resolve.json";

const context = answerVectors.context as unknown as WizardContext;

const templates = {
  main: parseTemplate(costVectors.templates.main.join("\n")).ast,
  edge: parseTemplate(costVectors.templates.edge.join("\n")).ast,
};

interface Patch {
  fields?: WizardAnswers["fields"];
  blocks?: WizardAnswers["blocks"];
  tables?: WizardAnswers["tables"];
  client?: Partial<WizardAnswers["client"]>;
  costs?: { lines?: WizardAnswers["costs"]["lines"]; extra?: WizardAnswers["costs"]["extra"] };
}

function answersFor(ast: (typeof templates)["main"], patch: Patch): WizardAnswers {
  const answers = initialAnswers(ast, context);
  Object.assign(answers.fields, patch.fields);
  Object.assign(answers.blocks, patch.blocks);
  Object.assign(answers.tables, patch.tables);
  Object.assign(answers.client, patch.client);
  Object.assign(answers.costs.lines, patch.costs?.lines);
  if (patch.costs?.extra) answers.costs.extra = patch.costs.extra;
  return answers;
}

const rowTuple = (row: ResolvedOffer["costs"]["rows"][number]) =>
  row.type === "total" ? ["total", row.label] : [row.name, row.kind, row.unitCents, row.percentBp, row.quantity, row.description];

/** specs/20261115-crm-offer-wizard AC-1.8, AC-3.5, AC-3.6, AC-4.3, AC-4.4, AC-4.6, AC-5.2, AC-5.4; DD-32, DD-39. */
describe("resolveOffer — the cost table, missing and invalid", () => {
  for (const vector of costVectors.cases as {
    name: string;
    template: "main" | "edge";
    patch: Patch;
    expect: { rows?: unknown[]; missing?: unknown[]; invalid?: unknown[]; price?: number[] };
  }[]) {
    it(vector.name, () => {
      const ast = templates[vector.template];
      const offer = resolveOffer(ast, answersFor(ast, vector.patch), context);
      if (vector.expect.rows) expect(offer.costs.rows.map(rowTuple)).toEqual(vector.expect.rows as never);
      if (vector.expect.missing) expect(offer.missing.map((issue) => [issue.name, issue.label, issue.step])).toEqual(vector.expect.missing as never);
      if (vector.expect.invalid) expect(offer.invalid.map((issue) => [issue.name, issue.label, issue.step, issue.code])).toEqual(vector.expect.invalid as never);
      if (vector.expect.price) expect([offer.costs.result.oneOffCents, offer.costs.result.yearlyCents]).toEqual(vector.expect.price as never);
    });
  }

  it("a line the person adds is priced with the others and numbered after them", () => {
    const ast = templates.main;
    const offer = resolveOffer(
      ast,
      answersFor(ast, {
        fields: { TITOLO: "S", TARIFFA: 100, ACC: "10", OPZ: "Alfa", QUOTA: 1 },
        tables: { ATT: [{ id: "r1", cells: { ATT: "A", GIORNI: "1" } }] },
        costs: {
          lines: { a: { unitCents: 100, quantity: 1 }, opt: { unitCents: 10, quantity: 1 } },
          extra: [{ id: "x", description: "Extra", kind: "yearly", unitCents: 7, percentBp: null, quantity: 3 }],
        },
      }),
      context,
    );
    const result = offer.costs.result.rows.filter((row) => row.type === "line").map((row) => [row.name, row.position, row.totalCents]);
    expect(result).toEqual([
      ["cost:a", 1, 100],
      ["cost:rel#1", 2, 476_200],
      ["cost:rel#2", 3, 523_800],
      ["cost:gg#1", 4, 100],
      ["cost:extra:x", 5, 21],
      ["cost:opt", 6, 10],
    ]);
  });

  it("an extra line goes at the end when the table has no total row", () => {
    const ast = parseTemplate(["@@salutation S", "## C", "@@costs", "@@line a one_off | A | unit=? | qty=1", "@@end"].join("\n")).ast;
    const answers = initialAnswers(ast, context);
    answers.costs.lines.a = { unitCents: 100, quantity: 1 };
    answers.costs.extra = [{ id: "x", description: "Extra", kind: "one_off", unitCents: 5, percentBp: null, quantity: 1 }];
    expect(resolveOffer(ast, answers, context).costs.rows.map((row) => row.type === "line" && row.name)).toEqual(["cost:a", "cost:extra:x"]);
  });

  it("an extra line with no description or no amount is missing, with no label", () => {
    const ast = templates.edge;
    const answers = answersFor(ast, { costs: { lines: { a: { unitCents: 1, quantity: 1 }, o: { unitCents: 1, quantity: 1 } } } });
    answers.costs.extra = [{ id: "z", description: " ", kind: "one_off", unitCents: null, percentBp: null, quantity: 1 }];
    const offer = resolveOffer(ast, answers, context);
    expect(offer.missing).toEqual([{ name: "cost:extra:z", label: null, step: "costs" }]);
  });

  it("the invalid list holds names and labels, never an answer's value", () => {
    const ast = templates.main;
    const secret = "TOP-SECRET-VALUE";
    const answers = answersFor(ast, { fields: { OPZ: secret, TITOLO: secret }, client: { date: "2027-06-01" } });
    const json = JSON.stringify(resolveOffer(ast, answers, context).invalid);
    expect(json).not.toContain(secret);
  });

  it("records an invalid value once however often it is printed, and not when it is not printed", () => {
    const ast = parseTemplate(["@@salutation S", "## S", "[P] [P]", "{{x::[Q]}}", "", "@@field P", "label: P", "kind: percentage", "", "@@field Q", "label: Q", "kind: percentage", "", "@@block x", "label: X"].join("\n")).ast;
    const answers = initialAnswers(ast, context);
    answers.fields.P = "150";
    answers.fields.Q = "-3";
    expect(resolveOffer(ast, answers, context).invalid.map((issue) => [issue.name, issue.code])).toEqual([["P", "out_of_range"]]);
  });
});

/** The big template of resolve.json: hand edits (AC-5.2, AC-5.4; DD-17, DD-32). */
describe("resolveOffer — hand-edited sections", () => {
  const ast = parseTemplate(textVectors.template.join("\n")).ast;
  const resolve = (answers: WizardAnswers) => resolveOffer(ast, answers, context);
  const keyOf = (heading: string) => ast.sections.find((section) => section.heading === heading)!.key;
  const edit = (heading: string, body: string, key = keyOf("OGGETTO")): WizardAnswers => {
    const answers = initialAnswers(ast, context);
    answers.handEdits[key] = { heading, body, sourceHeading: "OGGETTO" };
    return answers;
  };

  it("prints the person's heading and text as they are and marks the section", () => {
    const offer = resolve(edit("Nuovo titolo", "Testo **mio** [DESC]"));
    const section = offer.sections.find((candidate) => candidate.key === keyOf("OGGETTO"))!;
    expect(section).toMatchObject({ heading: "Nuovo titolo", body: "Testo **mio** [DESC]", handEdited: true, step: "scope" });
    expect(section.uses).toEqual(["DESC", "DATA", "blk", "IN_BLK", "NOTE", "ELENCO", "ATT", "GG", "ORE"]);
  });

  it("ignores later changes of the fields it reads, and does not ask for them", () => {
    const answers = edit("T", "Testo");
    const before = resolve(answers);
    answers.fields.DESC = "cambiato";
    answers.lists.ELENCO = ["x"];
    const after = resolve(answers);
    expect(after.sections.find((section) => section.handEdited)).toEqual(before.sections.find((section) => section.handEdited));
    const names = before.missing.map((issue) => issue.name);
    expect(names).not.toContain("ELENCO");
    expect(names).toContain("DESC");
    // ATT is still asked: the cost table's `each=ATT` line reads it, and the table is not the edited text
    expect(names).toContain("ATT");
  });

  it("stands even when the wizard's own text for the section would be empty", () => {
    const offer = resolve(edit("Vuoto", "Resta", keyOf("VUOTA")));
    expect(offer.sections.find((section) => section.key === keyOf("VUOTA"))).toMatchObject({ heading: "Vuoto", body: "Resta", handEdited: true });
  });

  it("is not printed while its block is off, and costs nothing then", () => {
    const optional = parseTemplate(["@@salutation S", "", "@@OPT_START opt", "## OPZ", "Testo", "@@OPT_END", "", "@@block opt", "label: Opz"].join("\n")).ast;
    const answers = initialAnswers(optional, context);
    answers.handEdits[optional.sections[0]!.key] = { heading: "Mio", body: "x".repeat(25_000), sourceHeading: "OPZ" };
    const off = resolveOffer(optional, answers, context);
    expect(off.sections).toEqual([]);
    expect(off.invalid).toEqual([]);
    answers.blocks.opt = true;
    const on = resolveOffer(optional, answers, context);
    expect(on.sections[0]).toMatchObject({ heading: "Mio", handEdited: true });
    expect(on.invalid.map((issue) => issue.code)).toEqual(["section_too_long"]);
  });

  it("refuses a heading above 120 and a text above 20 000, at the section", () => {
    const offer = resolve(edit("h".repeat(121), "b".repeat(20_001)));
    expect(offer.invalid.map((issue) => [issue.name, issue.label, issue.step, issue.code])).toEqual([
      [`section:${keyOf("OGGETTO")}`, "OGGETTO", "scope", "heading_too_long"],
      [`section:${keyOf("OGGETTO")}`, "OGGETTO", "scope", "section_too_long"],
    ]);
    expect(resolve(edit("h".repeat(120), "b".repeat(20_000))).invalid).toEqual([]);
  });

  it("keeps the cost table computed when the costs section's notes are edited", () => {
    const answers = edit("Costi", "Mie note", keyOf("COSTI"));
    answers.fields.TARIFFA = 5000;
    answers.fields.TITOLO = "T";
    const offer = resolve(answers);
    expect(offer.sections.find((section) => section.costs)).toMatchObject({ heading: "Costi", body: "Mie note", handEdited: true, costs: true });
    expect(offer.costs.rows[0]).toMatchObject({ name: "cost:a", description: "T", unitCents: 5000 });
  });

  it("never lets an edit carry a marker character in", () => {
    const offer = resolve(edit("T", "ab⟦c⟧"));
    const section = offer.sections.find((candidate) => candidate.handEdited)!;
    expect(section.heading).toBe("T?");
    expect(section.body).toBe("a?b?c?");
  });
});
