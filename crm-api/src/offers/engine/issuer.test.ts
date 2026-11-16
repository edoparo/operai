import { describe, expect, it } from "bun:test";
import { initialAnswers, type WizardAnswers, type WizardContext } from "./answers";
import { parseMarkup, type Block, type CellLine, type Run } from "./markup";
import { outline, suppliedFields, type OutlineItem } from "./outline";
import { resolveOffer } from "./resolve";
import { parseTemplate } from "./syntax";
import answerVectors from "./vectors/answers.json";
import vectors from "./vectors/issuer.json";

/**
 * The issuer's name and address as supplied values (specs/20261115-crm-offer-wizard DD-57, DD-58; AC-12.1, AC-12.2,
 * AC-12.7, AC-12.9, AC-12.12). The same vectors run in crm-ui's copy (offerEngine.vectors.test.ts).
 */
const base = answerVectors.context as unknown as WizardContext;
const parse = (lines: readonly string[]) => {
  const { ast, problems } = parseTemplate(lines.join("\n"));
  // a template without a cost table is fine here: only the mistakes of the vectors themselves are refused
  expect(problems.filter((problem) => problem.severity === "error" && problem.code !== "no_costs_section")).toEqual([]);
  return ast;
};
const contextWith = (patch: Partial<WizardContext> | undefined) => ({ ...base, ...patch }) as WizardContext;
const bodyOf = (offer: ReturnType<typeof resolveOffer>, heading: string) => offer.sections.find((section) => section.heading === heading)?.body;

describe("issuer vectors — cases", () => {
  const ast = parse(vectors.template);
  for (const vector of vectors.cases as { name: string; context: Partial<WizardContext>; expect: Record<string, unknown> }[]) {
    it(vector.name, () => {
      const context = contextWith(vector.context);
      const offer = resolveOffer(ast, initialAnswers(ast, context), context);
      const expected = vector.expect as { opening: string; sections: Record<string, string>; absent?: string[]; missing: unknown[]; invalid: unknown[]; systemRead: string[] };
      expect(offer.opening).toBe(expected.opening);
      for (const [heading, body] of Object.entries(expected.sections)) expect(bodyOf(offer, heading)).toBe(body);
      for (const heading of expected.absent ?? []) expect(bodyOf(offer, heading)).toBeUndefined();
      expect(offer.missing).toEqual(expected.missing as never);
      expect(offer.invalid).toEqual(expected.invalid as never);
      expect(offer.systemRead).toEqual(expected.systemRead as never);
    });
  }
});

const textOf = (runs: readonly Run[]) => runs.map((run) => run.text).join("");
const plain = (runs: readonly Run[]) => runs.every((run) => !run.bold && !run.italic && !run.underline && run.mark === undefined);
const cellText = (lines: readonly CellLine[]) => lines.map((line) => textOf(line.runs)).join("\n");

describe("issuer vectors — hostile names and addresses are text, never structure (AC-12.2, AC-12.9)", () => {
  const ast = parse(vectors.hostileTemplate);
  for (const vector of vectors.hostile as { name: string; legalName: string; addressLines: string[]; printedName: string; printedAddress: string; printed: string }[]) {
    it(vector.name, () => {
      const context = contextWith({ issuerLegalName: vector.legalName, issuerAddressLines: vector.addressLines });
      const offer = resolveOffer(ast, initialAnswers(ast, context), context);
      expect(offer.missing).toEqual([]);

      // a paragraph: one block, one line, no emphasis
      const paragraph = parseMarkup(bodyOf(offer, "PARAGRAFO")!);
      expect(paragraph.map((block) => block.type)).toEqual(["paragraph"]);
      const runs = (paragraph[0] as Extract<Block, { type: "paragraph" }>).runs;
      expect(plain(runs)).toBe(true);
      expect(textOf(runs)).toBe(vector.printed);

      // a list item: one list, one item holding the whole text
      const list = parseMarkup(bodyOf(offer, "ELENCO")!);
      expect(list.map((block) => block.type)).toEqual(["list"]);
      const items = (list[0] as Extract<Block, { type: "list" }>).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.children).toEqual([]);
      expect(plain(items[0]!.runs)).toBe(true);
      expect(textOf(items[0]!.runs)).toBe(vector.printed);

      // a table: still 2 columns and 2 rows, each value the text of its own cell
      const table = parseMarkup(bodyOf(offer, "TABELLA")!);
      expect(table.map((block) => block.type)).toEqual(["table"]);
      const { header, rows } = table[0] as Extract<Block, { type: "table" }>;
      expect(header).toHaveLength(2);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toHaveLength(2);
      for (const cell of [...rows[0]!, rows[1]![1]!]) {
        expect(cell.every((line) => !line.bullet && plain(line.runs))).toBe(true);
        expect(cell).toHaveLength(1);
      }
      expect(cellText(rows[0]![0]!)).toBe(vector.printedName);
      expect(cellText(rows[0]![1]!)).toBe(vector.printedAddress);
      expect(cellText(rows[1]![1]!)).toBe(vector.printed);
    });
  }
});

describe("issuer vectors — systemRead (DD-58)", () => {
  interface Read {
    name: string;
    template: string[];
    context?: Partial<WizardContext>;
    patch?: { blocks?: WizardAnswers["blocks"]; fields?: WizardAnswers["fields"] };
    handEdit?: { heading: string; body: string };
    expect: { systemRead: string[]; missing?: unknown[]; costRows?: [string, string][]; sections?: Record<string, string> };
  }
  for (const vector of vectors.reads as Read[]) {
    it(vector.name, () => {
      const ast = parse(vector.template);
      const context = contextWith(vector.context);
      const answers = initialAnswers(ast, context);
      Object.assign(answers.blocks, vector.patch?.blocks);
      Object.assign(answers.fields, vector.patch?.fields);
      if (vector.handEdit) {
        const section = ast.sections.find((candidate) => candidate.heading === vector.handEdit!.heading)!;
        answers.handEdits[section.key] = { heading: vector.handEdit.heading, body: vector.handEdit.body, sourceHeading: vector.handEdit.heading };
      }
      const offer = resolveOffer(ast, answers, context);
      expect(offer.systemRead).toEqual(vector.expect.systemRead as never);
      for (const [heading, body] of Object.entries(vector.expect.sections ?? {})) expect(bodyOf(offer, heading)).toBe(body);
      if (vector.expect.missing) expect(offer.missing).toEqual(vector.expect.missing as never);
      if (vector.expect.costRows) expect(offer.costs.rows.map((row) => [row.type === "total" ? "total" : row.name, row.type === "total" ? row.label : row.description])).toEqual(vector.expect.costRows);
    });
  }
});

describe("issuer vectors — suppliedFields (DD-58, AC-12.1, AC-12.9)", () => {
  for (const vector of vectors.supplied as { name: string; template: string[]; expect: unknown[]; items: string[] }[]) {
    it(vector.name, () => {
      const ast = parse(vector.template);
      expect(suppliedFields(ast)).toEqual(vector.expect as never);
      // never an item the wizard or the editor asks: the outline stays as it was
      const names = (items: readonly OutlineItem[]): string[] => items.flatMap((item) => ("name" in item ? [item.name] : []));
      expect(outline(ast, null).steps.flatMap((step) => names(step.items))).toEqual(vector.items);
    });
  }
});
