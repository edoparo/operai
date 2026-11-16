import { describe, expect, it } from "bun:test";
import { checkAnswers, chooseOption, initialAnswers, sampleAnswers, setBlock, type WizardContext } from "../../offers/engine/answers";
import { computeCosts, type CostRowIn } from "../../offers/engine/costs";
import { outline, type OutlineItem } from "../../offers/engine/outline";
import { parseTemplate, type FieldKind, type StepKey, type TemplateAst } from "../../offers/engine/syntax";
import answerVectors from "../../offers/engine/vectors/answers.json";
import { T6_TEXT } from "./welldChIt.T6";

/**
 * specs/20261115-crm-offer-wizard T22, AC-9.1, AC-9.6: the mockup's "Servizi a canone" (T6) text, converted
 * to the plan's grammar. The expectations are the mockup's own labels, hints, defaults, options and groups,
 * written out; the text is compared with them, never with the mockup itself (it is not in the repository).
 */

const context = answerVectors.context as unknown as WizardContext;
const { ast, problems } = parseTemplate(T6_TEXT);

interface FieldExpectation {
  label: string;
  kind?: FieldKind;
  default?: string;
  options?: string[];
  example?: string;
  source?: string;
}

const FIELDS: Record<string, FieldExpectation> = {
  CLIENTE: { label: "", source: "client" },
  EMITTENTE: { label: "", source: "issuer" },
  RIF: { label: "", source: "reference" },
  VALIDITA_GIORNI: { label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" },
  SERVIZIO: { label: "Servizio", example: "Nome del servizio o prodotto" },
  DESCRIZIONE_IN_UNA_FRASE: { label: "Descrizione in una frase", kind: "longtext" },
  DIMENSIONAMENTO: { label: "Dimensionamento", example: "utenti, ambienti, volumi" },
  PRODOTTO: { label: "Prodotto di terzi" },
  N_LICENZE: { label: "Numero di licenze", kind: "number" },
  PERIODO_LICENZE: { label: "Periodo delle licenze", example: "es. 1.1.2027 – 31.12.2027" },
  TEMPO_ATTIVAZIONE: { label: "Tempo di attivazione", example: "es. 10 giorni lavorativi" },
  UPTIME: { label: "Disponibilità minima garantita (%)", kind: "percentage" },
  PROVIDER_CLOUD: { label: "Provider cloud" },
  PRODOTTI_DI_TERZI: { label: "Licenze di terzi a carico del Cliente", example: "prodotti necessari al Servizio, pagati dal Cliente" },
  PERIODICITÀ: { label: "Periodicità del canone", options: ["mensile", "annuale"] },
  DURATA_MESI: { label: "Durata (mesi)", kind: "number", default: "12" },
  CADENZA_FATTURAZIONE: { label: "Cadenza di fatturazione", options: ["annuale", "semestrale", "trimestrale", "mensile"] },
  CATEGORIE_DI_INTERESSATI: { label: "Categorie di interessati", example: "es. dipendenti e utenti finali del Cliente" },
  TIPI_DI_DATI: { label: "Tipi di dati", example: "es. dati identificativi e di utilizzo" },
};

const BLOCKS: Record<string, { label: string; explain: string; default: boolean }> = {
  licenza_uso: { label: "Licenza d'uso del Servizio", explain: "Prodotto WellD in SaaS: licenza non esclusiva per la durata del contratto.", default: true },
  rivendita: { label: "Rivendita di licenze di terzi", explain: "Licenze di un produttore terzo, intestate al Cliente.", default: false },
  utenze: { label: "Utenze aggiuntive", explain: "Riga di costo per le utenze oltre quelle incluse.", default: false },
  attivazione: { label: "Attivazione del servizio", explain: "Voce una tantum di attivazione del Servizio.", default: false },
  dpa: {
    label: "Allegato DPA",
    explain: "Accordo sul trattamento dei dati personali (WellD responsabile, Cliente titolare).",
    default: false,
  },
  rinnovo_tacito: { label: "Rinnovo tacito", explain: "Si rinnova per un periodo equivalente, salvo disdetta con 3 mesi di preavviso.", default: false },
  no_rinnovo: { label: "Nessun rinnovo automatico", explain: "Il rinnovo si concorda per iscritto.", default: false },
};

/** The step each item has in the mockup (section 1–3 scope, 4–5 conditions, 6–8 costs, 9 and annexes annexes). */
const STEPS: Record<string, StepKey> = {
  SERVIZIO: "scope", DESCRIZIONE_IN_UNA_FRASE: "scope", COMPONENTE: "scope", DIMENSIONAMENTO: "scope", licenza_uso: "scope",
  rivendita: "scope", PRODOTTO: "scope", N_LICENZE: "scope", PERIODO_LICENZE: "scope", TEMPO_ATTIVAZIONE: "scope", UPTIME: "scope",
  PROVIDER_CLOUD: "conditions", PRODOTTI_DI_TERZI: "conditions",
  PERIODICITÀ: "costs", utenze: "costs", attivazione: "costs", "@costs": "costs", VALIDITA_GIORNI: "costs", DURATA_MESI: "costs",
  rinnovo: "costs", CADENZA_FATTURAZIONE: "costs",
  dpa: "annexes", CATEGORIE_DI_INTERESSATI: "annexes", TIPI_DI_DATI: "annexes",
};

/** name → step, for every item of the editor's outline, blocks' children and choices included. */
function stepsOf(template: TemplateAst): Record<string, StepKey> {
  const found: Record<string, StepKey> = {};
  const visit = (step: StepKey, item: OutlineItem): void => {
    if (item.type === "costTable") found["@costs"] = step;
    else found[item.name] = step;
    if (item.type === "block") item.children.forEach((child) => visit(step, child));
  };
  for (const step of outline(template, null).steps) step.items.forEach((item) => visit(step.key, item));
  return found;
}

function costItems(template: TemplateAst) {
  return template.sections.find((section) => section.costs)!.costs!.items;
}

/** The rows the offer would print for these answers: a line is there when every block that wraps it is on. */
function rowsFor(blocks: Record<string, boolean>, figures: Record<string, [number, number]>): CostRowIn[] {
  const rows: CostRowIn[] = [];
  for (const item of costItems(ast)) {
    if (!item.conds.every((cond) => blocks[cond.names[0]!] === true)) continue;
    if (item.type === "total") {
      rows.push({ type: "total", label: "TOTALE primo periodo" });
    } else {
      const [unitCents, quantity] = figures[item.key] ?? [0, 0];
      rows.push({
        type: "line",
        name: `cost:${item.key}`,
        kind: item.kind,
        unitCents,
        percentBp: null,
        quantity: item.qty?.type === "literal" ? item.qty.value : quantity,
      });
    }
  }
  return rows;
}

describe("T6 conversion", () => {
  it("parses with zero errors and no warning", () => {
    expect(problems).toEqual([]);
  });

  it("fits the limits (DD-3)", () => {
    expect(T6_TEXT.length).toBeLessThanOrEqual(150_000);
    expect(ast.sections.length).toBeLessThanOrEqual(15);
    expect(ast.annexes.map((annex) => annex.sections.length)).toEqual([8]);
  });

  it("drops the page-1 header and the acceptance block, keeps the two opening paragraphs (DD-1)", () => {
    expect(ast.salutation).toBe("Spett.le");
    expect(ast.acceptanceLabel).toBe("Il Cliente");
    expect(ast.opening.filter((line) => line.nodes.length > 0)).toHaveLength(2);
    for (const forbidden of ["A.c.a.", "Lugano, ", "CONTRATTO DI FORNITURA", "Per accettazione", "Luogo e data", "Firma valida", "Allegati:"]) {
      expect(T6_TEXT).not.toContain(forbidden);
    }
    for (const name of ["DATA", "INDIRIZZO_CLIENTE", "REFERENTE_CLIENTE"]) {
      expect(ast.fields.some((field) => field.name === name)).toBe(false);
      expect(T6_TEXT).not.toContain(`[${name}]`);
    }
  });

  it("uses the plan's syntax and none of the mockup's heuristics (DD-5)", () => {
    for (const forbidden of [/^@@W\b/m, /^@@PAGEBREAK/m, /^\^\^/m, /^---$/m, /^# /m, /^#{2,3} \d/m, /\[[A-ZÀ-ÖØ-Þ0-9]+_\d+\]/]) {
      expect(T6_TEXT).not.toMatch(forbidden);
    }
    expect(ast.sections.map((section) => section.heading)).toEqual([
      "DEFINIZIONI", "OGGETTO DELLA FORNITURA", "ATTIVAZIONE E LIVELLI DI SERVIZIO", "CONDIZIONI DI FORNITURA", "RISORSE", "COSTI",
      "DURATA, RINNOVO E DISDETTA", "FATTURAZIONE", "CONDIZIONI GENERALI",
    ]);
  });

  it("prints no literal CHF (DD-12)", () => {
    expect(T6_TEXT.slice(0, T6_TEXT.indexOf("\n@@field"))).not.toMatch(/\bCHF\b/);
  });

  it("gives every section the step of the mockup's mapping (DD-26)", () => {
    expect(ast.sections.map((section) => section.step)).toEqual(["scope", "scope", "scope", "conditions", "conditions", "costs", "costs", "costs", "annexes"]);
    for (const section of ast.annexes[0]!.sections) expect(section.step).toBe("annexes");
    expect(stepsOf(ast)).toEqual(STEPS);
  });

  it("declares exactly the mockup's fields, with its labels, hints, defaults and options", () => {
    expect(ast.fields.map((field) => field.name).sort()).toEqual(Object.keys(FIELDS).sort());
    for (const [name, expected] of Object.entries(FIELDS)) {
      const field = ast.fields.find((candidate) => candidate.name === name)!;
      expect(field.kind).toBe(expected.kind ?? "text");
      expect(field.label ?? "").toBe(expected.label);
      expect(field.default).toBe(expected.default ?? null);
      expect(field.options).toEqual(expected.options ?? null);
      expect(field.example).toBe(expected.example ?? null);
      expect(field.hint).toBeNull();
      expect(field.source).toBe((expected.source ?? null) as typeof field.source);
      expect(field.compute).toBeNull();
      expect(field.fills).toEqual([]);
    }
  });

  it("declares the mockup's list, optional blocks and the renewal choice", () => {
    expect(Object.fromEntries(ast.lists.map((list) => [list.name, list.label]))).toEqual({ COMPONENTE: "Componenti" });
    expect(ast.tables).toEqual([]);
    expect(Object.fromEntries(ast.blocks.map((block) => [block.name, { label: block.label, explain: block.explain, default: block.name === "licenza_uso" }]))).toEqual(
      Object.fromEntries(Object.entries(BLOCKS).map(([name, block]) => [name, { label: block.label, explain: block.explain, default: name === "licenza_uso" }])),
    );
    expect(ast.blocks.every((block) => block.fills.length === 0)).toBe(true);
    expect(ast.choices.map((choice) => ({ name: choice.name, label: choice.label, options: choice.options, default: choice.default }))).toEqual([
      { name: "rinnovo", label: "Rinnovo", options: ["rinnovo_tacito", "no_rinnovo"], default: "rinnovo_tacito" },
    ]);
  });

  it("has the DPA text annex the mockup keeps behind its switch", () => {
    expect(ast.annexes.map((annex) => annex.designation)).toEqual(["DPA"]);
    expect(ast.annexes[0]!.conds.map((cond) => cond.names[0])).toEqual(["dpa"]);
  });

  it("starts from the mockup's defaults", () => {
    const start = initialAnswers(ast, context);
    expect(start.fields.DURATA_MESI).toBe("12");
    expect(start.blocks).toMatchObject({ licenza_uso: true, rivendita: false, utenze: false, attivazione: false, dpa: false, rinnovo_tacito: true, no_rinnovo: false });
    expect(chooseOption(ast, start, "rinnovo", "no_rinnovo").blocks).toMatchObject({ rinnovo_tacito: false, no_rinnovo: true });
    expect(checkAnswers(ast, start, { options: true })).toEqual([]);
    expect(checkAnswers(ast, sampleAnswers(ast, "it"), { options: true })).toEqual([]);
  });

  describe("the cost table (DD-13)", () => {
    it("has the canone, extra users and licences yearly, the activation one-off, one total row", () => {
      const lines = costItems(ast).filter((item) => item.type === "line");
      expect(lines.map((line) => [line.key, line.kind, line.unit.type, line.qty?.type, line.conds.map((cond) => cond.names[0])])).toEqual([
        ["canone", "yearly", "entered", "entered", []],
        ["utenze", "yearly", "entered", "entered", ["utenze"]],
        ["licenze", "yearly", "entered", "entered", ["rivendita"]],
        ["attivazione", "one_off", "entered", "literal", ["attivazione"]],
      ]);
      const totals = costItems(ast).filter((item) => item.type === "total");
      expect(totals).toHaveLength(1);
      expect(costItems(ast).at(-1)?.type).toBe("total");
      expect(ast.sections.find((section) => section.costs)!.costs!.columns).toEqual({ position: true, unit: true });
      const table = outline(ast, null)
        .steps.flatMap((step) => step.items)
        .find((item) => item.type === "costTable");
      expect(table?.type === "costTable" && table.totals).toEqual(["TOTALE primo periodo"]);
    });

    it("is never a table without a counted line, whatever the blocks (AC-4.3)", () => {
      const start = initialAnswers(ast, context);
      expect(start.blocks.attivazione).toBe(false);
      const minimal = computeCosts(rowsFor(start.blocks, { canone: [120_000, 12] }));
      expect(minimal.errors).toEqual([]);
      expect(minimal.oneOffCents).toBe(0);
      expect(minimal.yearlyCents).toBe(1_440_000);
      expect(minimal.rows.filter((row) => row.type === "line").map((row) => row.type === "line" && row.position)).toEqual([1]);
    });

    it("totals the first period over every line, as the mockup does", () => {
      let answers = initialAnswers(ast, context);
      for (const name of ["utenze", "rivendita", "attivazione"]) answers = setBlock(ast, answers, name, true);
      const full = computeCosts(
        rowsFor(answers.blocks, { canone: [120_000, 12], utenze: [1_500, 40], licenze: [13_500, 25], attivazione: [80_000, 1] }),
      );
      expect(full.errors).toEqual([]);
      expect(full.yearlyCents).toBe(1_440_000 + 60_000 + 337_500);
      expect(full.oneOffCents).toBe(80_000);
      expect(full.rows.find((row) => row.type === "total")).toMatchObject({ label: "TOTALE primo periodo", state: "ok", totalCents: 1_917_500 });
    });
  });
});
