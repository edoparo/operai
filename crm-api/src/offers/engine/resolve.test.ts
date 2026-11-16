import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardAnswers, type WizardContext } from "./answers";
import { parseMarkup, parseInline, type Block } from "./markup";
import { resolveOffer, resolveSectionText, type ResolvedOffer } from "./resolve";
import { parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";
import vectors from "./vectors/resolve.json";

const baseContext = answerVectors.context as unknown as WizardContext;
const ast = parseTemplate(vectors.template.join("\n")).ast;

interface Patch {
  fields?: WizardAnswers["fields"];
  blocks?: WizardAnswers["blocks"];
  lists?: WizardAnswers["lists"];
  tables?: WizardAnswers["tables"];
  client?: Partial<WizardAnswers["client"]>;
}

function answersWith(patch: Patch, context: WizardContext = baseContext): WizardAnswers {
  const answers = initialAnswers(ast, context);
  Object.assign(answers.fields, patch.fields);
  Object.assign(answers.blocks, patch.blocks);
  Object.assign(answers.lists, patch.lists);
  Object.assign(answers.tables, patch.tables);
  Object.assign(answers.client, patch.client);
  return answers;
}

const byHeading = (offer: ResolvedOffer, heading: string) => offer.sections.find((section) => section.heading === heading);

interface Expect {
  opening?: string;
  sections?: Record<string, string>;
  absent?: string[];
  annexes?: { designation: string; title: string; subtitle: string | null; intro: string; sections: Record<string, string> }[];
  missing?: string[][];
  clientDate?: string;
}

/** specs/20261115-crm-offer-wizard AC-1.5, AC-1.7, AC-2.2, AC-3.3, AC-4.5, AC-10.1. */
describe("resolveOffer — the text", () => {
  for (const vector of vectors.cases as { name: string; patch: Patch; context?: Partial<WizardContext>; expect: Expect }[]) {
    it(vector.name, () => {
      const context = { ...baseContext, ...vector.context } as WizardContext;
      const offer = resolveOffer(ast, answersWith(vector.patch, context), context);
      const expected = vector.expect;
      if (expected.opening !== undefined) expect(offer.opening).toBe(expected.opening);
      for (const [heading, body] of Object.entries(expected.sections ?? {})) {
        expect(byHeading(offer, heading)?.body).toBe(body);
      }
      for (const heading of expected.absent ?? []) expect(byHeading(offer, heading)).toBeUndefined();
      if (expected.annexes) {
        expect(
          offer.annexes.map((annex) => ({
            designation: annex.designation,
            title: annex.title,
            subtitle: annex.subtitle,
            intro: annex.intro,
            sections: Object.fromEntries(annex.sections.map((section) => [section.heading, section.body])),
          })),
        ).toEqual(expected.annexes);
      }
      if (expected.missing) expect(offer.missing.map((issue) => [issue.name, issue.label, issue.step])).toEqual(expected.missing);
      if (expected.clientDate) expect(offer.client.date).toBe(expected.clientDate);
      expect(JSON.stringify(offer)).not.toMatch(/[⟪⟫]/); // DD-52: the reference token never reaches a resolved offer
    });
  }

  it("lists the printed sections in the template's order with their step, and drops the ones that print nothing", () => {
    const offer = resolveOffer(ast, answersWith({}), baseContext);
    expect(offer.sections.map((section) => [section.heading, section.step, section.costs])).toEqual([
      ["OGGETTO", "scope", false],
      ["FATTURAZIONE", "conditions", false],
      ["COSTI", "costs", true],
    ]);
  });

  it("lists what a section reads, blocks and conditions included, once, in text order", () => {
    const section = byHeading(resolveOffer(ast, answersWith({}), baseContext), "OGGETTO");
    expect(section?.uses).toEqual(["DESC", "DATA", "blk", "IN_BLK", "NOTE", "ELENCO", "ATT", "GG", "ORE"]);
    expect(section?.handEdited).toBe(false);
  });

  it("emits the pending marker for the reference, and the reference itself once it is assigned", () => {
    const answers = answersWith({});
    expect(resolveOffer(ast, answers, baseContext).opening).toContain("Riferimento");
    const assigned = resolveOffer(ast, answers, baseContext, { reference: "0017/2026r1" });
    expect(assigned.opening).toBe("Apertura per Acme SA - Rif. 0017/2026r1");
    expect(assigned.annexes[0]?.subtitle).toBe("0017/2026r1");
    expect(assigned.missing.map((issue) => issue.name)).not.toContain("RIF");
  });

  it("never reports the pending reference or a derived field as missing", () => {
    const names = resolveOffer(ast, answersWith({ blocks: { rate: true } }), baseContext).missing.map((issue) => issue.name);
    expect(names).not.toContain("RIF");
    expect(names).not.toContain("SALDO");
  });

  it("gives the client block, the contacts of the draft and the printed date", () => {
    const offer = resolveOffer(ast, answersWith({ client: { contactIds: ["c2", "c1", "gone"] } }), baseContext);
    expect(offer.client).toEqual({ lines: ["Acme SA", "Via Roma 1", "6900 Lugano", "Svizzera"], contacts: ["Anna Bianchi", "Mario Rossi"], place: "Lugano", date: "2026-11-15" });
    expect(offer.salutation).toBe("Spett.le");
    expect(offer.acceptanceLabel).toBe("Il Cliente");
  });

  it("an Italian template prints Italian whatever the language of the context says", () => {
    const english = { ...baseContext, language: "en" } as WizardContext;
    const offer = resolveOffer(ast, answersWith({}, english), english);
    expect(offer.salutation).toBe("Spett.le");
    expect(byHeading(offer, "FATTURAZIONE")?.body).toContain("% acconto");
    expect(offer.language).toBe("en");
  });

  it("a list holding only empty items is missing, like an empty one", () => {
    const offer = resolveOffer(ast, answersWith({ lists: { ELENCO: ["", "  "] } }), baseContext);
    expect(offer.missing.find((issue) => issue.name === "ELENCO")).toEqual({ name: "ELENCO", label: "Elenco", step: "scope" });
    expect(byHeading(offer, "OGGETTO")?.body).toContain("- \uE000Elenco\uE001");
  });

  it("template text goes through the printable mapping too", () => {
    const template = parseTemplate(["@@salutation S", "", "Apertura 日本 {{x::☃}}", "", "## Titolo ✓", "Testo €", "", "@@block x", "label: X"].join("\n")).ast;
    const answers = initialAnswers(template, baseContext);
    answers.blocks.x = true;
    const offer = resolveOffer(template, answers, baseContext);
    expect(offer.opening).toBe("Apertura ?? ?");
    expect(offer.sections[0]).toMatchObject({ heading: "Titolo ?", body: "Testo €" });
  });

  it("leaves its inputs alone", () => {
    const answers = answersWith({ lists: { ELENCO: ["b", "", "a"] } });
    const before = structuredClone(answers);
    resolveOffer(ast, answers, baseContext);
    expect(answers).toEqual(before);
  });
});

describe("resolveOffer — a value never becomes markup (DD-5)", () => {
  const hostile = ["**x**", "## y", "| z |", "- a", "• a", "1. a", "e.g. a", "### h", "\\*x", "a\n| b |", "{{x::y}}", "__u__", "*i*", "[DESC]", "a\n\n\n\nb", "  - a", "x\n- y\n1. z", "<br>y"];

  const textOf = (blocks: readonly Block[]): string =>
    blocks
      .map((block) => {
        if (block.type === "paragraph") return block.runs.map((run) => run.text).join("");
        if (block.type === "list") return block.items.map((item) => item.runs.map((run) => run.text).join("")).join("\n");
        return `<${block.type}>`;
      })
      .join("\n\n");

  it("prints each hostile value as text, in a paragraph", () => {
    const template = parseTemplate(["@@salutation S", "", "## S", "[V]", "", "@@field V", "label: V"].join("\n")).ast;
    for (const value of hostile) {
      const answers = initialAnswers(template, baseContext);
      answers.fields.V = value;
      const body = resolveOffer(template, answers, baseContext).sections[0]!.body;
      const blocks = parseMarkup(body);
      expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
      expect(textOf(blocks)).toBe(value.trim().replace(/\n(?:[ \t]*\n){2,}/g, "\n\n"));
    }
  });

  it("prints a hostile value inside a list item and a table cell as that item's or cell's text", () => {
    const template = parseTemplate(
      ["@@salutation S", "", "## S", "- before [V]", "", "| a | [V] |", "|---|---|", "| [V] | b |", "", "@@field V", "label: V"].join("\n"),
    ).ast;
    for (const value of hostile) {
      const answers = initialAnswers(template, baseContext);
      answers.fields.V = value;
      const blocks = parseMarkup(resolveOffer(template, answers, baseContext).sections[0]!.body);
      expect(blocks.map((block) => block.type)).toEqual(["list", "table"]);
      const table = blocks[1] as Extract<Block, { type: "table" }>;
      expect(table.rows).toHaveLength(1);
      expect(table.header).toHaveLength(2);
      expect(table.rows[0]).toHaveLength(2);
      expect([...table.header[1]!, ...table.rows[0]![0]!].every((line) => !line.bullet)).toBe(true);
    }
  });

  it("never lets a value carry a marker character into the document", () => {
    const template = parseTemplate(["@@salutation S", "", "## S", "[V]", "", "@@field V", "label: V"].join("\n")).ast;
    const answers = initialAnswers(template, baseContext);
    answers.fields.V = "abcde ⟦x⟧";
    const body = resolveOffer(template, answers, baseContext).sections[0]!.body;
    expect(body).toBe("a?b?c?d?e ?x?");
    const runs = parseInline(body);
    expect(runs.every((run) => run.mark === undefined)).toBe(true);
  });

  it("a missing value is a marked run with its label", () => {
    const body = resolveOffer(ast, answersWith({}), baseContext).sections[0]!.body;
    const runs = parseMarkup(body).flatMap((block) => (block.type === "paragraph" ? block.runs : []));
    expect(runs.find((run) => run.mark === "missing")).toMatchObject({ text: "Descrizione", bold: true });
  });
});

describe("resolveOffer — the cost lines read the answers", () => {
  it("a line with unit=[TARIFFA] reads the field's own answer: change the field, the line follows", () => {
    for (const cents of [150_000, 200_000]) {
      const offer = resolveOffer(ast, answersWith({ fields: { TARIFFA: cents, TITOLO: "Sviluppo" } }), baseContext);
      expect(offer.costs.rows[0]).toMatchObject({ type: "line", name: "cost:a", kind: "one_off", unitCents: cents, quantity: 1, description: "Sviluppo" });
      expect(offer.costs.rows[1]).toEqual({ type: "total", label: "TOTALE" });
      expect(offer.costs.result.rows[0]).toMatchObject({ totalCents: cents, position: 1 });
      expect(offer.missing.map((issue) => issue.name)).not.toContain("TARIFFA");
    }
  });

  it("a field the line needs and the person has not given is missing, once, in the costs step", () => {
    const offer = resolveOffer(ast, answersWith({}), baseContext);
    expect(offer.costs.rows[0]).toMatchObject({ unitCents: null, description: "Titolo" });
    expect(offer.missing.filter((issue) => issue.name === "TARIFFA")).toEqual([{ name: "TARIFFA", label: "Tariffa", step: "costs" }]);
  });
});

describe("resolveOffer — the template's own limits", () => {
  it("is pure: it imports only engine modules and keeps no clock, locale or I/O", async () => {
    const source = await Bun.file(new URL("./resolve.ts", import.meta.url)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(/from "([^"]+)"/g)) expect(match[1]).toMatch(/^\.\//);
    expect(code).not.toMatch(/Intl\.|toLocale|Date\.now|new Date\(|Math\.random|\beval\(|new\s+Function/);
  });

  it("gives a section's wizard text with each missing value as a token", () => {
    const text = resolveSectionText(ast, answersWith({}), baseContext, byHeading(resolveOffer(ast, answersWith({}), baseContext), "OGGETTO")!.key);
    expect(text?.tokens.map((token) => token.name)).toEqual(["DESC", "ELENCO", "ATT"]);
    expect(text?.body).toContain("⟦Descrizione⟧");
  });
});

/** DD-52: the reference token "⟪REF⟫" in a hand-edited body is filled at generation (specs/20261115-crm-offer-wizard AC-2.2, AC-5.1, AC-5.2). */
describe("resolveOffer — the reference token in a hand edit (DD-52)", () => {
  const group = vectors.referenceToken;
  const templates = {
    template: parseTemplate(group.template.join("\n")).ast,
    templateWithoutReference: parseTemplate(group.templateWithoutReference.join("\n")).ast,
  };

  function resolve(
    template: typeof ast,
    body: string,
    options: { reference?: string | null; mode?: "markers" | "tokens"; section?: string } = {},
  ): ResolvedOffer {
    const answers = initialAnswers(template, baseContext);
    const heading = options.section ?? "OGGETTO";
    const key = template.sections.find((section) => section.heading === heading)!.key;
    answers.handEdits[key] = { heading, body, sourceHeading: heading };
    return resolveOffer(template, answers, baseContext, {
      ...(options.reference !== undefined ? { reference: options.reference } : {}),
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
  }

  for (const vector of group.cases as {
    name: string;
    template?: keyof typeof templates;
    reference?: string;
    mode?: "tokens";
    section?: string;
    body: string;
    expect: string;
  }[]) {
    it(vector.name, () => {
      const offer = resolve(templates[vector.template ?? "template"], vector.body, {
        ...(vector.reference !== undefined ? { reference: vector.reference } : {}),
        ...(vector.mode !== undefined ? { mode: vector.mode } : {}),
        ...(vector.section !== undefined ? { section: vector.section } : {}),
      });
      expect(offer.sections.find((section) => section.heading === (vector.section ?? "OGGETTO"))?.body).toBe(vector.expect);
      if (vector.mode !== "tokens") {
        const everything = JSON.stringify(offer);
        expect(everything).not.toContain("⟪");
        expect(everything).not.toContain("⟫");
      }
    });
  }

  it("a pending token blocks nothing: `missing` is what it was without the token", () => {
    const withToken = resolve(templates.template, "Rif. ⟪REF⟫").missing;
    expect(withToken).toEqual(resolve(templates.template, "Rif.").missing);
    expect(withToken.map((issue) => issue.name)).not.toContain("RIF");
  });

  it("fills every token of a long body, and reads the limits on the raw stored length", () => {
    const offer = resolve(templates.template, "⟪REF⟫".repeat(10), { reference: "0007/2026" });
    expect(offer.sections[0]?.body).toBe("0007/2026".repeat(10));
    expect(offer.invalid).toEqual([]);
  });

  it("the wizard's own text of a section that is not hand-edited still shows the pending marker, not the token", () => {
    const offer = resolveOffer(templates.template, initialAnswers(templates.template, baseContext), baseContext);
    expect(offer.sections[0]?.body).toContain("Riferimento");
    expect(offer.sections[0]?.body).not.toContain("⟪");
  });
});

/** QE D1 / security M-1: the resolved text is bounded while it is built (vectors/resolve.json § bounds). */
describe("resolveOffer — the output is bounded", () => {
  const group = vectors.bounds;
  const bounded = parseTemplate(group.template.join("\n")).ast;

  for (const vector of group.cases as unknown as {
    name: string;
    template?: string[];
    fill: Record<string, [string, number]>;
    expect: { invalid: unknown[]; lengths?: Record<string, number>; atMost?: number };
  }[]) {
    it(vector.name, () => {
      const ast = vector.template ? parseTemplate(vector.template.join("\n")).ast : bounded;
      const answers = initialAnswers(ast, baseContext);
      for (const [name, [text, times]] of Object.entries(vector.fill)) answers.fields[name] = text.repeat(times);
      const offer = resolveOffer(ast, answers, baseContext);
      expect(offer.invalid.map((issue) => [issue.name, issue.label, issue.step, issue.code])).toEqual(vector.expect.invalid as never);
      const bodies = [
        ["", offer.opening],
        ...offer.sections.map((section) => [section.heading, section.body] as const),
        ...offer.annexes.flatMap((annex) => [["#intro", annex.intro] as const, ...annex.sections.map((section) => [section.heading, section.body] as const)]),
      ] as [string, string][];
      for (const [heading, length] of Object.entries(vector.expect.lengths ?? {})) {
        expect(bodies.find(([name]) => name === heading)?.[1].length, heading || "opening").toBe(length);
      }
      if (vector.expect.atMost !== undefined) for (const [heading, body] of bodies) expect(body.length, heading || "opening").toBeLessThanOrEqual(vector.expect.atMost);
    });
  }
});
