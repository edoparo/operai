import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardAnswers, type WizardContext } from "./answers";
import { findTokens, resolveSectionForEdit } from "./edit";
import { resolveOffer, resolveSectionText } from "./resolve";
import { welldChItT3Text } from "../../offer-templates/wizardSeeds/welldChIt.T3";
import { parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";
import vectors from "./vectors/edit.json";
import textVectors from "./vectors/resolve.json";

const context = answerVectors.context as unknown as WizardContext;
const ast = parseTemplate(textVectors.template.join("\n")).ast;
const optional = parseTemplate(vectors.optionalTemplate.join("\n")).ast;

interface Patch {
  fields?: WizardAnswers["fields"];
  lists?: WizardAnswers["lists"];
  tables?: WizardAnswers["tables"];
  handEdit?: WizardAnswers["handEdits"];
}

const sectionKey = (template: typeof ast, heading: string): string =>
  [...template.sections, ...template.annexes.flatMap((annex) => annex.sections)].find((section) => section.heading === heading)?.key ?? `${heading}#9`;

function answersWith(template: typeof ast, patch: Patch): WizardAnswers {
  const answers = initialAnswers(template, context);
  Object.assign(answers.fields, patch.fields);
  Object.assign(answers.lists, patch.lists);
  Object.assign(answers.tables, patch.tables);
  for (const [heading, edit] of Object.entries(patch.handEdit ?? {})) answers.handEdits[sectionKey(template, heading)] = edit;
  return answers;
}

/** specs/20261115-crm-offer-wizard AC-5.1, AC-5.2; DD-30. */
describe("resolveSectionForEdit", () => {
  for (const vector of vectors.cases as { name: string; section: string; template?: string; patch: Patch; expect: unknown }[]) {
    it(vector.name, () => {
      const template = vector.template === "optional" ? optional : ast;
      const result = resolveSectionForEdit(template, answersWith(template, vector.patch), context, sectionKey(template, vector.section));
      const expected = vector.expect as { heading: string; body: string; tokens: [string, string][] } | null;
      expect(result).toEqual(
        expected === null ? null : { heading: expected.heading, body: expected.body, tokens: expected.tokens.map(([name, label]) => ({ name, label })) },
      );
    });
  }

  it("is the document's own text when nothing is missing: what the dialog starts from is what the preview shows", () => {
    const answers = answersWith(ast, {
      fields: { DESC: "A *star* | pipe", PERC: "5" },
      lists: { ELENCO: ["- x", "y"] },
      tables: { ATT: [{ id: "r", cells: { ATT: "Analisi", ORE: "2" } }] },
    });
    const offer = resolveOffer(ast, answers, context);
    for (const printed of [...offer.sections, ...offer.annexes.flatMap((annex) => annex.sections)]) {
      if (printed.costs) continue;
      expect(resolveSectionForEdit(ast, answers, context, printed.key)).toEqual({ heading: printed.heading, body: printed.body, tokens: [] });
    }
  });

  it("writes the reference in a body as the reference token, which is neither escaped nor listed (DD-52)", () => {
    const template = parseTemplate(["@@salutation S", "", "## S", "Rif. [RIF] [X]", "", "@@field RIF", "label: Riferimento", "source: reference", "", "@@field X", "label: X"].join("\n")).ast;
    const answers = initialAnswers(template, context);
    answers.fields.X = "ok";
    expect(resolveSectionForEdit(template, answers, context, template.sections[0]!.key)).toEqual({ heading: "S", body: "Rif. ⟪REF⟫ ok", tokens: [] });
  });

  it("keeps the reference in a heading a blocking token: a hand-edit heading never takes the reference token", () => {
    const template = parseTemplate(["@@salutation S", "", "## S [RIF]", "Testo", "", "@@field RIF", "label: Riferimento", "source: reference"].join("\n")).ast;
    const result = resolveSectionForEdit(template, initialAnswers(template, context), context, template.sections[0]!.key);
    expect(result).toEqual({ heading: "S ⟦Riferimento⟧", body: "Testo", tokens: [{ name: "RIF", label: "Riferimento" }] });
    expect(findTokens(result!.heading, "heading")).toHaveLength(1);
  });

  it("writes the reference token in place in the T3 seed's table cell and list item, leaving it out of tokens", () => {
    const seed = parseTemplate(welldChItT3Text).ast;
    const answers = initialAnswers(seed, context);
    for (const [heading, line] of [
      ["Parametri del servizio", "| **Condizioni economiche** | Contratto di fornitura Rif. ⟪REF⟫, par. 6 | — |"],
      ["Condizioni generali", "- **Rapporto con il contratto di fornitura:** il presente allegato integra il contratto di fornitura Rif. **⟪REF⟫**."],
    ] as const) {
      const result = resolveSectionForEdit(seed, answers, context, sectionKey(seed, heading))!;
      expect(result.body).toContain(line);
      expect(result.body).not.toContain("⟦RIF⟧");
      expect(result.tokens.map((token) => token.name)).not.toContain("RIF");
    }
  });

  it("lists a field that is missing in two places once, and a label with markup characters as the template wrote it", () => {
    const template = parseTemplate(["@@salutation S", "", "## S", "[A] and [A]", "", "@@field A", "label: A*B_C"].join("\n")).ast;
    const result = resolveSectionForEdit(template, initialAnswers(template, context), context, template.sections[0]!.key)!;
    expect(result.tokens).toEqual([{ name: "A", label: "A*B_C" }]);
    expect(result.body).toBe("⟦A\\*B\\_C⟧ and ⟦A\\*B\\_C⟧");
    expect(findTokens(result.body).map((token) => token.label)).toEqual(["A*B_C", "A*B_C"]);
  });

  it("keeps the wizard's own text reachable under a hand edit, for restoring it", () => {
    const answers = answersWith(ast, { handEdit: { OGGETTO: { heading: "Mio", body: "Mio testo", sourceHeading: "OGGETTO" } } });
    const wizard = resolveSectionText(ast, answers, context, sectionKey(ast, "OGGETTO"));
    expect(wizard?.heading).toBe("OGGETTO");
    expect(wizard?.body).toContain("⟦Descrizione⟧");
  });

  it("does not change its inputs", () => {
    const answers = answersWith(ast, {});
    const before = structuredClone(answers);
    resolveSectionForEdit(ast, answers, context, sectionKey(ast, "OGGETTO"));
    expect(answers).toEqual(before);
  });
});

describe("findTokens", () => {
  for (const vector of vectors.findTokens as { text: string; where?: "body" | "heading"; expect: [number, number, string][] }[]) {
    it(`${vector.where ?? "body"} ${JSON.stringify(vector.text)}`, () => {
      expect(findTokens(vector.text, vector.where).map((token) => [token.start, token.end, token.label])).toEqual(vector.expect);
    });
  }

  it("never throws and reports every bracket, whatever the text", () => {
    const text = "⟧⟦⟦⟧⟧⟦ x ⟦".repeat(2000);
    const found = findTokens(text);
    const brackets = [...text].filter((char) => char === "⟦" || char === "⟧").length;
    expect(found.reduce((total, token) => total + (token.end - token.start === 1 ? 1 : 2), 0)).toBe(brackets);
  });

  it("is pure: it imports only engine modules and uses no locale, clock or I/O", async () => {
    const source = await Bun.file(new URL("./edit.ts", import.meta.url)).text();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(/from "([^"]+)"/g)) expect(match[1]).toMatch(/^\.\//);
    expect(code).not.toMatch(/Intl\.|toLocale|Date\.now|new Date\(|Math\.random/);
  });
});
