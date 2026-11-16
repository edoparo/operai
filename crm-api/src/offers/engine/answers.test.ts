import { describe, expect, it } from "bun:test";
import {
  checkAnswers,
  chooseOption,
  initialAnswers,
  reconcileAnswers,
  sampleAnswers,
  sampleContext,
  setBlock,
  setField,
  switchTemplate,
  type WizardAnswers,
  type WizardContext,
} from "./answers";
import { parseTemplate } from "./syntax";
import vectors from "./vectors/answers.json";

const ctx = vectors.context as unknown as WizardContext;
const parse = (lines: string[]) => parseTemplate(lines.join("\n")).ast;
const ast = parse(vectors.template);
const initial = () => initialAnswers(ast, ctx);

type Step =
  | { op: "field"; name: string; value: string }
  | { op: "block"; name: string; on: boolean }
  | { op: "choose"; choice: string; option: string };

function run(template: typeof ast, from: WizardAnswers, steps: Step[]): WizardAnswers {
  let answers = from;
  for (const step of steps) {
    if (step.op === "field") answers = setField(template, answers, step.name, step.value);
    else if (step.op === "block") answers = setBlock(template, answers, step.name, step.on);
    else answers = chooseOption(template, answers, step.choice, step.option);
  }
  return answers;
}

/** specs/20261115-crm-offer-wizard AC-1.4, AC-1.9, AC-2.1, AC-2.3, AC-6.5, AC-8.4, AC-8.5; decisions.md O3. */
describe("initialAnswers", () => {
  it("builds the defaults, the client block and the system prefills of the vectors", () => {
    expect(initial()).toEqual(vectors.initial as unknown as WizardAnswers);
  });

  it("picks the client lines of the template's language", () => {
    const english = initialAnswers(ast, { ...ctx, language: "en" });
    expect(english.client.lines).toEqual(["Acme SA", "Via Roma 1", "6900 Lugano", "Switzerland"]);
    expect(english.fields.TIMELINE).toBe("| Phase | Duration |");
  });

  it("starts the effort-detail annex as the template says", () => {
    const on = parse(["@@salutation S", "@@effort-annex on", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end"]);
    expect(initialAnswers(on, ctx).effortAnnex).toBe(true);
    expect(initial().effortAnnex).toBe(false);
  });

  it("prefills a line priced from the deal with no amount as null, and manDays at least 1", () => {
    const answers = initialAnswers(ast, {
      ...ctx,
      dealAmountCents: null,
      estimate: { ...ctx.estimate!, manDays: 0, releases: [] },
    });
    expect(answers.costs.lines.oggetto).toEqual({ unitCents: null, quantity: 1 });
    expect(answers.costs.lines.rel).toEqual({ releases: [{ description: "Portale clienti", unitCents: null }] });
  });

  it("a deal with no estimate prefills the estimate values empty", () => {
    const answers = initialAnswers(ast, { ...ctx, estimate: null });
    expect(answers.fields).not.toHaveProperty("EPICS");
    expect(answers.fields.MD).toBe("0");
    expect(answers.fields.DEAL).toBe("Portale clienti");
  });

  it("a release split gives the last release the remainder, in whole units", () => {
    const answers = initialAnswers(ast, {
      ...ctx,
      dealAmountCents: 1_000_001,
      estimate: { ...ctx.estimate!, releases: [{ name: "A", manDays: 1 }, { name: "B", manDays: 1 }, { name: "C", manDays: 1 }] },
    });
    const cents = answers.costs.lines.rel!.releases!.map((release) => release.unitCents!);
    expect(cents).toEqual([333_300, 333_300, 333_401]);
    expect(cents.reduce((a, b) => a + b, 0)).toBe(1_000_001);
  });
});

describe("the fills rule (decisions.md O3, AC-1.9)", () => {
  interface OpVector {
    name: string;
    template?: string[];
    steps: Step[];
    fields: Record<string, string | number>;
    blocks?: Record<string, boolean>;
    absent?: string[];
    then?: Omit<OpVector, "name" | "then">[];
  }
  for (const vector of vectors.ops as unknown as OpVector[]) {
    it(vector.name, () => {
      const template = vector.template ? parse(vector.template) : ast;
      const start = initialAnswers(template, ctx);
      for (const variant of [vector, ...(vector.then ?? [])]) {
        const result = run(template, start, variant.steps);
        expect(result.fields).toMatchObject(variant.fields);
        if (variant.blocks) expect(result.blocks).toMatchObject(variant.blocks);
        for (const name of variant.absent ?? []) expect(result.fields).not.toHaveProperty(name);
      }
    });
  }

  it("never mutates the answers it is given", () => {
    const before = initial();
    const snapshot = JSON.parse(JSON.stringify(before));
    run(ast, before, [{ op: "field", name: "PROFILO", value: "Platinum" }, { op: "block", name: "uno", on: true }, { op: "choose", choice: "scelta", option: "quattro" }]);
    expect(before).toEqual(snapshot);
  });

  it("ignores a name that is not declared", () => {
    const before = initial();
    expect(setField(ast, before, "GHOST", "x").fields).toEqual(before.fields);
    expect(setBlock(ast, before, "ghost", true).blocks).toEqual(before.blocks);
    expect(chooseOption(ast, before, "ghost", "tre").blocks).toEqual(before.blocks);
    expect(chooseOption(ast, before, "scelta", "ghost").blocks).toEqual(before.blocks);
  });

  it("an empty value clears a field", () => {
    expect(setField(ast, initial(), "PERC", "").fields).not.toHaveProperty("PERC");
  });
});

describe("sampleAnswers (AC-8.5)", () => {
  const sample = sampleAnswers(ast, "it");

  it("fills every field that is neither derived nor bound to the client block", () => {
    expect(sample.fields.DESC).toBe("es. Portale");
    expect(sample.fields.PROFILO).toBe("Gold");
    expect(sample.fields.N).toBe("1");
    expect(sample.fields.ORFANO).toBe("Orfano");
    expect(sample.fields).not.toHaveProperty("SALDO");
    expect(sample.fields).not.toHaveProperty("CLIENTE");
    expect(typeof sample.fields.IMPORTO).toBe("number");
  });

  it("fills a list and a table with two printed items", () => {
    expect(sample.lists.ELENCO).toEqual(["Elenco 1", "Elenco 2"]);
    expect(sample.tables.TAB).toEqual([
      { id: "row1", cells: { TAB: "Tabella 1", PREZZO: 100_000 } },
      { id: "row2", cells: { TAB: "Tabella 2", PREZZO: 100_000 } },
    ]);
  });

  it("prices the lines that the person would enter", () => {
    expect(sample.costs.lines.var).toEqual({ unitCents: 100_000, quantity: 1 });
    expect(sample.costs.lines.oggetto!.unitCents).toBe(1_000_000);
    expect(sample.costs.lines.rel!.releases).toHaveLength(2);
  });

  it("carries a sample client, a place and one contact the sample context knows", () => {
    const context = sampleContext("it");
    expect(sample.client.lines).toEqual([...context.clientLines.it]);
    expect(sample.client.place).not.toBe("");
    expect(sample.client.contactIds).toEqual(context.contacts.map((contact) => contact.id).slice(0, 1));
    expect(sampleAnswers(ast, "en").client.lines).toEqual([...sampleContext("en").clientLines.en]);
  });

  it("needs no clock: the same call gives the same answers", () => {
    expect(sampleAnswers(ast, "it")).toEqual(sample);
    expect(sample.fields.DATA).toBe("2026-01-15");
  });

  it("has a discount and an option line priced as amounts", () => {
    const withLines = parse([
      "@@salutation S", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=?", "@@line s discount | s | unit=?",
      "@@total T", "@@line o option | o | unit=? | qty=?", "@@end",
    ]);
    const answers = sampleAnswers(withLines, "it");
    expect(answers.costs.lines.s).toEqual({ unitCents: 5_000 });
    expect(answers.costs.lines.o).toEqual({ unitCents: 15_000, quantity: 1 });
    expect(answers.costs.lines.a).toEqual({ unitCents: 100_000, quantity: 1 });
  });
});

describe("reconcileAnswers (AC-8.4, AC-6.5)", () => {
  const without = (lines: string[], ...drop: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (drop.includes(lines[i]!)) {
        while (i < lines.length && lines[i] !== "") i++;
        continue;
      }
      out.push(lines[i]!);
    }
    return out;
  };

  it("keeps everything while the template is unchanged", () => {
    const answers = setField(ast, initial(), "DESC", "Hello");
    const { answers: next, dropped } = reconcileAnswers(ast, answers);
    expect(next).toEqual(answers);
    expect(dropped).toEqual([]);
  });

  it("drops what the template no longer declares and reports it, keeping the rest", () => {
    const smaller = parse(without(vectors.template, "@@field AMT", "@@block altro", "@@list ELENCO", "@@table TAB"));
    const answers: WizardAnswers = { ...initial(), tables: { TAB: [{ id: "r1", cells: { TAB: "x", PREZZO: 5 } }] } };
    const { answers: next, dropped } = reconcileAnswers(smaller, answers);
    expect(dropped).toEqual(["AMT", "altro", "ELENCO", "TAB"]);
    expect(next.fields).not.toHaveProperty("AMT");
    expect(next.blocks).not.toHaveProperty("altro");
    expect(next.lists).toEqual({});
    expect(next.tables).toEqual({});
    expect(next.fields.PROFILO).toBe("Gold");
    expect(next.blocks.blocco).toBe(true);
  });

  it("drops a table column that no longer exists, and a cost line", () => {
    const smaller = parse(
      vectors.template.filter((line) => line !== "@@line fisso one_off | Fisso | unit=500 | qty=1").map((line) =>
        line === "columns: TAB, PREZZO" ? "columns: TAB" : line,
      ),
    );
    const answers: WizardAnswers = {
      ...initial(),
      tables: { TAB: [{ id: "r1", cells: { TAB: "x", PREZZO: 5 } }] },
      costs: { ...initial().costs, lines: { ...initial().costs.lines, fisso: { unitCents: 1 }, rel: initial().costs.lines.rel! } },
    };
    const { answers: next, dropped } = reconcileAnswers(smaller, answers);
    expect(next.tables.TAB).toEqual([{ id: "r1", cells: { TAB: "x" } }]);
    expect(next.costs.lines).not.toHaveProperty("fisso");
    expect(dropped).toEqual(["TAB.PREZZO", "cost:fisso"]);
  });

  it("drops a value of a field that became derived or bound to the client block", () => {
    const derived = parse(vectors.template.flatMap((line) => (line === "label: N" ? [line, "compute: 1 + 1"] : [line])));
    const { answers: next, dropped } = reconcileAnswers(derived, initial());
    expect(next.fields).not.toHaveProperty("N");
    expect(dropped).toContain("N");
  });

  it("adds the defaults of a field, a block and a choice declared since", () => {
    const larger = parse([...vectors.template, "", "@@field NUOVO", "label: Nuovo", "default: ciao", "", "@@block nuovo", "label: Nuovo", "default: on", "", "@@list NUOVA", "label: N", "", "@@field DATA2", "label: D", "kind: date", "default: today"]);
    const { answers: next, dropped } = reconcileAnswers(larger, initial());
    expect(next.fields.NUOVO).toBe("ciao");
    expect(next.blocks.nuovo).toBe(true);
    expect(next.lists.NUOVA).toEqual([]);
    expect(next.fields).not.toHaveProperty("DATA2"); // `today` needs a clock the engine does not have
    expect(dropped).toEqual([]);
  });

  it("re-establishes exactly one option of a choice when its chosen option disappears", () => {
    const changed = parse(vectors.template.map((line) => (line === "options: tre | quattro" ? "options: quattro | cinque" : line)).concat(["", "@@block cinque", "label: Cinque"]));
    const { answers: next } = reconcileAnswers(changed, initial());
    expect(next.blocks.quattro).toBe(true);
    expect(next.blocks.cinque).toBe(false);
    expect(next.blocks.tre).toBe(true); // no longer an option of the choice: a plain block keeps its value
  });

  it("moves a hand edit whose section is gone into orphanedEdits", () => {
    const answers: WizardAnswers = {
      ...initial(),
      handEdits: {
        "COSTI#0": { heading: "COSTI", body: "kept", sourceHeading: "COSTI" },
        "GONE#0": { heading: "Gone", body: "lost?", sourceHeading: "GONE" },
      },
      orphanedEdits: [{ heading: "Old", body: "older" }],
    };
    const { answers: next, dropped } = reconcileAnswers(ast, answers);
    expect(Object.keys(next.handEdits)).toEqual(["COSTI#0"]);
    expect(next.orphanedEdits).toEqual([{ heading: "Old", body: "older" }, { heading: "Gone", body: "lost?" }]);
    expect(dropped).toEqual([]);
  });

  it("never mutates its input", () => {
    const answers = initial();
    const snapshot = JSON.parse(JSON.stringify(answers));
    reconcileAnswers(parse(without(vectors.template, "@@field AMT")), answers);
    expect(answers).toEqual(snapshot);
  });
});

describe("switchTemplate (AC-6.5)", () => {
  it("keeps the client lines, contacts, place and date, and resets the rest", () => {
    const edited: WizardAnswers = {
      ...setField(ast, initial(), "PERC", "99"),
      client: { lines: ["Other SA"], contactIds: ["c1"], place: "Zurigo", date: "2026-12-01" },
      validityDays: 60,
      aiAssisted: true,
      attachmentIds: ["a1"],
      handEdits: { "COSTI#0": { heading: "H", body: "B", sourceHeading: "COSTI" } },
      lastStep: "costs",
    };
    const other = parse(["@@salutation S", "", "[X]", "## C", "@@costs", "@@line a one_off | d | unit=? | qty=1", "@@end", "", "@@field X", "label: X", "default: hi"]);
    const next = switchTemplate(other, edited, ctx);
    expect(next.client).toEqual({ lines: ["Other SA"], contactIds: ["c1"], place: "Zurigo", date: "2026-12-01" });
    expect(next.fields).toEqual({ X: "hi" });
    expect(next.validityDays).toBe(30);
    expect(next.aiAssisted).toBe(false);
    expect(next.attachmentIds).toEqual([]);
    expect(next.handEdits).toEqual({});
    expect(next.lastStep).toBe("client");
  });
});

describe("checkAnswers (AC-1.8, reserved characters)", () => {
  function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let node = target as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
    node[parts[parts.length - 1]!] = value;
  }

  interface CheckVector {
    name: string;
    set: { path: string; value: unknown }[];
    issues: { path: string; code: string }[];
  }
  for (const vector of vectors.checks as unknown as CheckVector[]) {
    it(vector.name, () => {
      const answers = JSON.parse(JSON.stringify(initial())) as Record<string, unknown>;
      for (const change of vector.set) setPath(answers, change.path, change.value);
      expect(checkAnswers(ast, answers as unknown as WizardAnswers)).toEqual(vector.issues as never);
    });
  }

  it("can leave the option check out (a draft saved against an older template version, DD-38)", () => {
    const answers = setField(ast, initial(), "PROFILO", "Silver");
    expect(checkAnswers(ast, answers)).toEqual([{ path: "fields.PROFILO", code: "not_an_option" }]);
    expect(checkAnswers(ast, answers, { options: false })).toEqual([]);
    expect(checkAnswers(ast, { ...answers, fields: { ...answers.fields, DESC: "" } }, { options: false })).toEqual([
      { path: "fields.DESC", code: "reserved_character" },
    ]);
  });

  it("does not follow a path deeper than a plausible document", () => {
    let deep: unknown = "";
    for (let i = 0; i < 200; i++) deep = { a: deep };
    const answers = { ...initial(), fields: { DESC: deep } } as unknown as WizardAnswers;
    expect(() => checkAnswers(ast, answers)).not.toThrow();
  });
});
