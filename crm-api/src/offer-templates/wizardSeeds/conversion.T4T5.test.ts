import { describe, expect, it } from "bun:test";
import { checkAnswers, chooseOption, initialAnswers, sampleAnswers, type WizardContext } from "../../offers/engine/answers";
import { outline, type OutlineItem } from "../../offers/engine/outline";
import { parseTemplate, type FieldKind, type StepKey, type TemplateAst } from "../../offers/engine/syntax";
import answerVectors from "../../offers/engine/vectors/answers.json";
import { T4_TEXT } from "./welldChIt.T4";
import { T5_TEXT } from "./welldChIt.T5";

/**
 * specs/20261115-crm-offer-wizard T21, AC-9.1, AC-9.6: the mockup's "Formazione" (T4) and "Consulenza e
 * assessment" (T5) texts, converted to the plan's grammar. The expectations below are the mockup's own
 * labels, hints, defaults, options and groups, written out; the texts are compared with them, never with
 * the mockup itself (it is not in the repository).
 */

const context = answerVectors.context as unknown as WizardContext;

interface FieldExpectation {
  label: string;
  kind?: FieldKind;
  default?: string;
  options?: string[];
  example?: string;
  hint?: string;
  compute?: string;
  source?: string;
}

interface BlockExpectation {
  label: string;
  explain: string;
  default: boolean;
}

interface Spec {
  code: string;
  text: string;
  fields: Record<string, FieldExpectation>;
  lists: Record<string, string>;
  tables: Record<string, { label: string; columns: string[] }>;
  blocks: Record<string, BlockExpectation>;
  choices: Record<string, { label: string; options: string[]; default: string }>;
  /** The step each item has in the mockup (section 1–3 scope, 4–5 conditions, 6–8 costs, 9 and annexes annexes). */
  steps: Record<string, StepKey>;
  /** Headings of the contract sections, in order. */
  headings: string[];
  annexes: { designation: string; sections: number }[];
}

const SECTION_STEPS: StepKey[] = ["scope", "scope", "scope", "conditions", "conditions", "costs", "costs", "costs", "annexes"];

const specs: Spec[] = [
  {
    code: "T4",
    text: T4_TEXT,
    fields: {
      CLIENTE: { label: "", source: "client" },
      EMITTENTE: { label: "", source: "issuer" },
      VALUTA: { label: "", source: "currency" },
      VALIDITA_GIORNI: { label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" },
      TITOLO_CORSO: { label: "Titolo del corso" },
      DESCRIZIONE_IN_UNA_FRASE: { label: "Descrizione in una frase", kind: "longtext" },
      GIORNATE: { label: "Giornate", kind: "number" },
      ORE: { label: "Ore complessive", kind: "number" },
      ARTICOLAZIONE: { label: "Articolazione", example: "es. 3 blocchi da 2 giornate" },
      MODALITÀ: { label: "Modalità", options: ["in presenza", "da remoto", "in presenza o da remoto"] },
      MAX_PARTECIPANTI: { label: "Partecipanti (massimo)", kind: "number" },
      N_ISTRUTTORI: { label: "Istruttori", kind: "number" },
      LINGUA: { label: "Lingua", default: "italiano" },
      ORARIO: { label: "Orario", default: "09:00–18:00" },
      PREREQUISITI: { label: "Prerequisiti dei partecipanti" },
      GIORNI_CONFERMA: { label: "Conferma entro (giorni lavorativi)", kind: "number", default: "10" },
      BUDGET_AI: { label: "Budget AI per partecipante", example: "es. 25" },
      UNITÀ_DI_PREZZO: { label: "Unità di prezzo", options: ["a corpo", "per partecipante"], default: "a corpo" },
      PREZZO_PARTECIPANTE_AGGIUNTIVO: { label: "Prezzo per partecipante aggiuntivo", kind: "number" },
      MIN_PARTECIPANTI: { label: "Minimo partecipanti", kind: "number" },
      ACCONTO: { label: "Acconto (%)", kind: "percentage", default: "50" },
      SALDO: { label: "Saldo (%)", kind: "percentage", compute: "100 - ACCONTO" },
      DESTINATARI: { label: "Destinatari" },
      CONTENUTI: { label: "Contenuti" },
      ORE_MODULO: { label: "Ore complessive", kind: "number" },
    },
    lists: { OBIETTIVO: "Obiettivi", MATERIALE: "Materiali" },
    tables: { MODULO: { label: "Modulo", columns: ["MODULO", "CONTENUTI", "ORE_MODULO"] } },
    blocks: {
      allegato_a: { label: "Allegato A", explain: "Programma del corso in allegato.", default: true },
      conferma: { label: "Conferma dei partecipanti", explain: "Il Cliente conferma il numero dei partecipanti entro un termine.", default: false },
      attestato: { label: "Attestato di partecipazione", explain: "Compreso nel prezzo.", default: true },
      cancellazione: { label: "Rinvio e cancellazione", explain: "Rinvio gratuito fino a 15 giorni lavorativi prima; poi 50%, a corso avviato 100%.", default: true },
      ai_corso: { label: "Ambiente AI del corso", explain: "WellD mette a disposizione un ambiente AI gestito, con budget per partecipante.", default: false },
      sconto: { label: "Scontistica accordata", explain: "Aggiunge la riga di sconto, come importo.", default: false },
      nota_corpo: { label: "Prezzo a corpo", explain: "Importo fisso fino al numero massimo di partecipanti.", default: false },
      nota_partecipante: { label: "Prezzo per partecipante", explain: "Fatturato sui partecipanti confermati, con un minimo.", default: false },
    },
    choices: { prezzo: { label: "Modello di prezzo", options: ["nota_corpo", "nota_partecipante"], default: "nota_corpo" } },
    steps: {
      TITOLO_CORSO: "scope", DESCRIZIONE_IN_UNA_FRASE: "scope", GIORNATE: "scope", ORE: "scope", ARTICOLAZIONE: "scope", MODALITÀ: "scope",
      MAX_PARTECIPANTI: "scope", N_ISTRUTTORI: "scope", LINGUA: "scope", ORARIO: "scope", PREREQUISITI: "scope", allegato_a: "scope",
      conferma: "scope", GIORNI_CONFERMA: "scope",
      attestato: "conditions", cancellazione: "conditions", ai_corso: "conditions", BUDGET_AI: "conditions",
      UNITÀ_DI_PREZZO: "costs", sconto: "costs", prezzo: "costs", PREZZO_PARTECIPANTE_AGGIUNTIVO: "costs", MIN_PARTECIPANTI: "costs",
      VALIDITA_GIORNI: "costs", ACCONTO: "costs", SALDO: "costs", "@costs": "costs",
      OBIETTIVO: "annexes", DESTINATARI: "annexes", MODULO: "annexes", MATERIALE: "annexes",
    },
    headings: [
      "DEFINIZIONI", "OGGETTO DELLA FORNITURA", "ATTIVITÀ E TEMPISTICHE", "CONDIZIONI DI FORNITURA", "RISORSE", "COSTI",
      "VALIDITÀ DELL'OFFERTA", "FATTURAZIONE", "CONDIZIONI GENERALI",
    ],
    annexes: [{ designation: "A", sections: 4 }],
  },
  {
    code: "T5",
    text: T5_TEXT,
    fields: {
      CLIENTE: { label: "", source: "client" },
      EMITTENTE: { label: "", source: "issuer" },
      VALUTA: { label: "", source: "currency" },
      VALIDITA_GIORNI: { label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" },
      OGGETTO_CONSULENZA: { label: "Oggetto della consulenza", example: "es. l'assessment tecnico-funzionale di …" },
      DESCRIZIONE_IN_UNA_FRASE: { label: "Descrizione in una frase", kind: "longtext" },
      DELIVERABLE: { label: "Deliverable", example: "es. documento di requisiti e solution design" },
      GG: { label: "Giorni/uomo", kind: "number" },
      DURATA: { label: "Durata prevista", example: "es. 4 mesi" },
      MATERIALI_DATI_ACCESSI: {
        label: "Materiali, dati e accessi necessari",
        kind: "longtext",
        hint: "Se vuoto, resta l'impegno generico a fornire quanto necessario.",
      },
      FORNITURA_SUCCESSIVA: { label: "Fornitura successiva", example: "es. lo sviluppo dell'MVP" },
      TERMINE: { label: "Entro", example: "es. 6 mesi dalla consegna" },
      ACCONTO: { label: "Acconto (%)", kind: "percentage", default: "50" },
      SALDO: { label: "Saldo (%)", kind: "percentage", compute: "100 - ACCONTO" },
    },
    lists: { CONTENUTO: "Contenuti dell'attività", ATTIVITÀ: "Attività" },
    tables: {},
    blocks: {
      sconto: { label: "Scontistica accordata", explain: "Aggiunge la riga di sconto, come importo.", default: false },
      scalato: {
        label: "Importo scalato dalla fornitura successiva",
        explain: "Se il Cliente affida lo sviluppo, l'importo già pagato viene scontato.",
        default: false,
      },
    },
    choices: {},
    steps: {
      OGGETTO_CONSULENZA: "scope", DESCRIZIONE_IN_UNA_FRASE: "scope", CONTENUTO: "scope", DELIVERABLE: "scope",
      ATTIVITÀ: "scope", GG: "scope", DURATA: "scope",
      MATERIALI_DATI_ACCESSI: "conditions",
      sconto: "costs", scalato: "costs", FORNITURA_SUCCESSIVA: "costs", TERMINE: "costs",
      VALIDITA_GIORNI: "costs", ACCONTO: "costs", SALDO: "costs", "@costs": "costs",
    },
    headings: [
      "DEFINIZIONI", "OGGETTO DELLA FORNITURA", "ATTIVITÀ E TEMPISTICHE", "CONDIZIONI DI FORNITURA", "RISORSE, GARANZIA", "COSTI",
      "VALIDITÀ DELL'OFFERTA", "FATTURAZIONE", "CONDIZIONI GENERALI",
    ],
    annexes: [],
  },
];

/** name → step, for every item of the editor's outline, blocks' children and choices included. */
function stepsOf(ast: TemplateAst): Record<string, StepKey> {
  const found: Record<string, StepKey> = {};
  const visit = (step: StepKey, item: OutlineItem): void => {
    if (item.type === "costTable") found["@costs"] = step;
    else found[item.name] = step;
    if (item.type === "block") item.children.forEach((child) => visit(step, child));
  };
  for (const step of outline(ast, null).steps) step.items.forEach((item) => visit(step.key, item));
  return found;
}

for (const spec of specs) {
  describe(`${spec.code} conversion`, () => {
    const { ast, problems } = parseTemplate(spec.text);

    it("parses with zero errors", () => {
      expect(problems.filter((problem) => problem.severity === "error")).toEqual([]);
    });

    it("has no warning other than the optional sub-headings the mockup's order forces", () => {
      const codes = problems.filter((problem) => problem.severity === "warning").map((problem) => problem.code);
      expect(codes).toEqual(spec.code === "T4" ? ["optional_heading_not_last"] : []);
    });

    it("fits the limits (DD-3)", () => {
      expect(spec.text.length).toBeLessThanOrEqual(150_000);
      expect(ast.sections.length).toBeLessThanOrEqual(15);
      for (const annex of ast.annexes) expect(annex.sections.length).toBeLessThanOrEqual(30);
    });

    it("drops the page-1 header and the acceptance block, keeps the two opening paragraphs (DD-1)", () => {
      expect(ast.salutation).toBe("Spett.le");
      expect(ast.acceptanceLabel).toBe("Il Cliente");
      const paragraphs = ast.opening.filter((line) => line.nodes.length > 0);
      expect(paragraphs).toHaveLength(2);
      for (const forbidden of ["A.c.a.", "Lugano, ", "CONTRATTO DI FORNITURA", "Per accettazione", "Luogo e data", "Firma valida", "Allegati:"]) {
        expect(spec.text).not.toContain(forbidden);
      }
      for (const name of ["DATA", "RIF", "INDIRIZZO_CLIENTE", "REFERENTE_CLIENTE"]) {
        expect(ast.fields.some((field) => field.name === name)).toBe(false);
        expect(spec.text).not.toContain(`[${name}]`);
      }
    });

    it("uses the plan's syntax and none of the mockup's heuristics (DD-5)", () => {
      for (const forbidden of [/^@@W\b/m, /^@@PAGEBREAK/m, /^\^\^/m, /^---$/m, /^# /m, /^#{2,3} \d/m, /\[[A-ZÀ-ÖØ-Þ0-9]+_\d+\]/]) {
        expect(spec.text).not.toMatch(forbidden);
      }
      expect(ast.sections.map((section) => section.heading)).toEqual(spec.headings);
    });

    it("prints no literal CHF; the currency is a source field (DD-12)", () => {
      // what is printed: everything before the declarations (a label names no currency either, SA-6)
      const printed = spec.text.slice(0, spec.text.indexOf("\n@@field"));
      expect(printed).not.toMatch(/\bCHF\b/);
      const currency = ast.fields.find((field) => field.name === "VALUTA");
      expect(currency?.source).toBe("currency");
    });

    it("gives every section the step of the mockup's mapping (DD-26)", () => {
      expect(ast.sections.map((section) => section.step)).toEqual(SECTION_STEPS);
      for (const annex of ast.annexes) for (const section of annex.sections) expect(section.step).toBe("annexes");
      expect(stepsOf(ast)).toEqual(spec.steps);
    });

    it("declares exactly the mockup's fields, with its labels, hints, defaults and options", () => {
      expect(ast.fields.map((field) => field.name).sort()).toEqual(Object.keys(spec.fields).sort());
      for (const [name, expected] of Object.entries(spec.fields)) {
        const field = ast.fields.find((candidate) => candidate.name === name)!;
        expect(field.kind).toBe(expected.kind ?? "text");
        expect(field.label ?? "").toBe(expected.label);
        expect(field.default).toBe(expected.default ?? null);
        expect(field.options).toEqual(expected.options ?? null);
        expect(field.example).toBe(expected.example ?? null);
        expect(field.hint).toBe(expected.hint ?? null);
        expect(field.source).toBe((expected.source ?? null) as typeof field.source);
        expect(field.compute?.source ?? null).toBe(expected.compute ?? null);
      }
    });

    it("declares the mockup's lists, tables, optional blocks and choices", () => {
      expect(Object.fromEntries(ast.lists.map((list) => [list.name, list.label]))).toEqual(spec.lists);
      expect(Object.fromEntries(ast.tables.map((table) => [table.name, { label: table.label, columns: table.columns }]))).toEqual(spec.tables);
      expect(Object.fromEntries(ast.blocks.map((block) => [block.name, { label: block.label, explain: block.explain, default: block.default }]))).toEqual(
        spec.blocks,
      );
      expect(Object.fromEntries(ast.choices.map((choice) => [choice.name, { label: choice.label, options: choice.options, default: choice.default }]))).toEqual(
        spec.choices,
      );
    });

    it("has the text annexes of the mockup", () => {
      expect(ast.annexes.map((annex) => ({ designation: annex.designation, sections: annex.sections.length }))).toEqual(spec.annexes);
    });

    it("has a cost table whose labelled total row is a @@total (DD-13)", () => {
      const costs = ast.sections.find((section) => section.costs)!.costs!;
      expect(costs.columns).toEqual({ position: true, unit: true });
      const totals = costs.items.filter((item) => item.type === "total");
      expect(totals).toHaveLength(1);
      expect(costs.items.at(-1)?.type).toBe("total");
    });

    it("takes the wizard through a sample without an issue", () => {
      expect(checkAnswers(ast, sampleAnswers(ast, "it"), { options: true })).toEqual([]);
      expect(checkAnswers(ast, initialAnswers(ast, context), { options: true })).toEqual([]);
    });

    it("starts from the mockup's defaults", () => {
      const start = initialAnswers(ast, context);
      for (const [name, expected] of Object.entries(spec.fields)) {
        if (expected.default !== undefined) expect(String(start.fields[name])).toBe(expected.default);
      }
      const options = new Set(Object.values(spec.choices).flatMap((choice) => choice.options));
      for (const [name, expected] of Object.entries(spec.blocks)) {
        if (!options.has(name)) expect(start.blocks[name]).toBe(expected.default);
      }
      for (const choice of Object.values(spec.choices)) {
        for (const option of choice.options) expect(start.blocks[option]).toBe(option === choice.default);
      }
    });
  });
}

describe("T4 conversion — the price model", () => {
  const { ast } = parseTemplate(T4_TEXT);

  it("fills the unit of price from the chosen option, as the mockup sets it", () => {
    const start = initialAnswers(ast, context);
    expect(start.fields.UNITÀ_DI_PREZZO).toBe("a corpo");
    const perHead = chooseOption(ast, start, "prezzo", "nota_partecipante");
    expect(perHead.fields.UNITÀ_DI_PREZZO).toBe("per partecipante");
    expect(perHead.blocks).toMatchObject({ nota_corpo: false, nota_partecipante: true });
    const back = chooseOption(ast, perHead, "prezzo", "nota_corpo");
    expect(back.fields.UNITÀ_DI_PREZZO).toBe("a corpo");
  });

  it("states each fill on its option, nothing else", () => {
    expect(ast.blocks.find((block) => block.name === "nota_corpo")?.fills).toEqual([{ name: "UNITÀ_DI_PREZZO", value: "a corpo" }]);
    expect(ast.blocks.find((block) => block.name === "nota_partecipante")?.fills).toEqual([{ name: "UNITÀ_DI_PREZZO", value: "per partecipante" }]);
    expect(ast.fields.filter((field) => field.fills.length > 0)).toEqual([]);
  });

  it("prices the course on one line, with a discount line and a labelled total", () => {
    const costs = ast.sections.find((section) => section.costs)!.costs!;
    const lines = costs.items.filter((item) => item.type === "line");
    expect(lines.map((line) => [line.key, line.kind, line.unit.type, line.qty?.type ?? null, line.conds.map((cond) => cond.names[0])])).toEqual([
      ["corso", "one_off", "entered", "entered", []],
      ["sconto", "discount", "entered", null, ["sconto"]],
    ]);
  });

  it("asks for the programme table's columns as the mockup's rows do", () => {
    const modules = outline(ast, null)
      .steps.flatMap((step) => step.items)
      .find((item) => item.type === "table");
    expect(modules?.type === "table" && modules.columns.map((column) => column.label)).toEqual(["Modulo", "Contenuti", "Ore complessive"]);
  });
});

describe("T5 conversion — the attachments", () => {
  const { ast } = parseTemplate(T5_TEXT);

  it("has no free attachments field: the annexes are the deal-PDF picker's (DD-24, AC-9.6)", () => {
    for (const name of [...ast.fields.map((f) => f.name), ...ast.lists.map((l) => l.name), ...ast.tables.map((t) => t.name)]) {
      expect(name).not.toMatch(/ALLEGAT/);
    }
    expect(T5_TEXT).not.toMatch(/\[[A-ZÀ-ÖØ-Þ0-9_]*ALLEGAT[A-ZÀ-ÖØ-Þ0-9_]*\]/);
    expect(T5_TEXT).not.toContain("Allegati");
    const annexes = outline(ast, null).steps.find((step) => step.key === "annexes");
    expect(annexes?.items ?? []).toEqual([]);
  });

  it("prints the hourly rate in the deal's currency", () => {
    expect(T5_TEXT).toContain("140.- [VALUTA]/ora");
  });

  it("prices the consultancy on one counted line with a discount line and a labelled total", () => {
    const costs = ast.sections.find((section) => section.costs)!.costs!;
    const lines = costs.items.filter((item) => item.type === "line");
    expect(lines.map((line) => [line.key, line.kind, line.unit.type, line.qty, line.conds.map((cond) => cond.names[0])])).toEqual([
      ["consulenza", "one_off", "entered", { type: "literal", value: 1 }, []],
      ["sconto", "discount", "entered", null, ["sconto"]],
    ]);
  });
});
