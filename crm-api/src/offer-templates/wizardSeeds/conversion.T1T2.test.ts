/**
 * T19 (specs/20261115-crm-offer-wizard): the mockup's "Progetto a corpo" (T1) and "Risorse a tempo" (T2) in the plan's grammar:
 * AC-9.1 (the same templates, steps, labels, hints and defaults), AC-9.6 (what the CRM draws is gone), DD-1, DD-5, DD-12, DD-24, DD-26.
 */
import { describe, expect, it } from "bun:test";
import { checkAnswers, DEFAULT_VALIDITY_DAYS, initialAnswers, sampleAnswers, sampleContext } from "../../offers/engine/answers";
import { outline, type OutlineItem } from "../../offers/engine/outline";
import {
  MAX_ANNEX_SECTIONS,
  MAX_ANNEXES,
  MAX_SECTIONS,
  MAX_TEMPLATE_CHARS,
  parseTemplate,
  type FieldDecl,
  type StepKey,
  type TemplateAst,
} from "../../offers/engine/syntax";
import { welldChItT1Text } from "./welldChIt.T1";
import { welldChItT2Text } from "./welldChIt.T2";

// ─── What the mockup's configuration says, one entry per declaration ───────────────────────────────

interface FieldExpect {
  label: string | null;
  hint: string | null;
  example: string | null;
  kind: FieldDecl["kind"];
  default: string | null;
  options: string[] | null;
  source: FieldDecl["source"];
  compute: string | null;
  /** option → the assignments choosing it makes */
  fills: Record<string, Record<string, string>>;
}

const field = (partial: Partial<FieldExpect>): FieldExpect => ({
  label: null,
  hint: null,
  example: null,
  kind: "text",
  default: null,
  options: null,
  source: null,
  compute: null,
  fills: {},
  ...partial,
});

interface Expectation {
  code: string;
  fields: Record<string, FieldExpect>;
  lists: Record<string, { label: string }>;
  tables: Record<string, { label: string; columns: string[]; step: StepKey | null }>;
  blocks: Record<string, { label: string; explain: string; default: boolean }>;
  choices: Record<string, { label: string; options: string[]; default: string }>;
  /** What each step holds and where (DD-26): section headings, then the items in the order the wizard asks them. */
  steps: Record<string, { sections: string[]; items: string[] }>;
  contractSections: string[];
  annexSections: Record<string, string[]>;
  /** What a person starts from (the mockup's `def`, `def` of the groups). */
  start: { blocks: Record<string, boolean>; fields: Record<string, string> };
}

// ─── Reading a seed ──────────────────────────────────────────────────────────────────────────────

function read(text: string): TemplateAst {
  return parseTemplate(text).ast;
}

const fieldView = (decl: FieldDecl): FieldExpect => ({
  label: decl.label,
  hint: decl.hint,
  example: decl.example,
  kind: decl.kind,
  default: decl.default,
  options: decl.options,
  source: decl.source,
  compute: decl.compute?.source ?? null,
  fills: Object.fromEntries(decl.fills.map((group) => [group.option, Object.fromEntries(group.assigns.map((assign) => [assign.name, assign.value]))])),
});

/** `type:name` of every outline item, a block's children after it as `block:x > field:y`. */
function flatten(items: readonly OutlineItem[], prefix = ""): string[] {
  return items.flatMap((item) => {
    const id = item.type === "costTable" ? "costTable" : `${item.type}:${item.name}`;
    return [`${prefix}${id}`, ...(item.type === "block" ? flatten(item.children, `${prefix}${id} > `) : [])];
  });
}

function stepsOf(ast: TemplateAst): Record<string, { sections: string[]; items: string[] }> {
  return Object.fromEntries(
    outline(ast, null).steps.map((step) => [
      step.key,
      { sections: step.sections.map((section) => (section.annex ? `${section.annex}: ${section.heading}` : section.heading)), items: flatten(step.items) },
    ]),
  );
}

/**
 * DD-26 read from the text itself, not from the engine: sections 1–3 scope, 4–5 conditions, 6–8 costs, section 9 and
 * every annex annexes; a field, list or table sits in the step of the first section that prints it as `[NAME]`, a block
 * in the first that opens it. The same rule the mockup applied to the numbers it had in its headings.
 */
function mockupSteps(text: string): Map<string, { step: string; at: number }> {
  const first = new Map<string, { step: string; at: number }>();
  let section = 0;
  let inAnnex = false;
  let at = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@field ")) break; // the declarations close the text
    if (line.startsWith("@@annex ")) inAnnex = true;
    else if (/^## /.test(line)) section += 1;
    const step = inAnnex ? "annexes" : section <= 3 ? "scope" : section <= 5 ? "conditions" : section <= 8 ? "costs" : "annexes";
    const names = [
      ...[...line.matchAll(/\[([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9_]*)\]/g)].map((match) => match[1]!),
      ...[...line.matchAll(/\{\{([a-z][a-z0-9_]*)::|^@@OPT_START ([a-z][a-z0-9_]*)$/g)].map((match) => (match[1] ?? match[2])!),
    ];
    for (const name of names) if (!first.has(name)) first.set(name, { step, at: at++ });
  }
  return first;
}

const COUNTED = "Il presente contratto viene stipulato tra [EMITTENTE]";

/** The seed conversions every template shares: the plan's grammar, the header the CRM draws, the declarations. */
function describeConversion(text: string, expected: Expectation): void {
  const { ast, problems } = parseTemplate(text);

  describe(`${expected.code}: reads as the plan's grammar`, () => {
    it("has no problem at all, not even a warning (AC-8.3)", () => {
      expect(problems).toEqual([]);
    });

    it("stays within the limits of DD-3 and DD-19", () => {
      expect(text.length).toBeLessThanOrEqual(MAX_TEMPLATE_CHARS);
      expect(ast.sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
      expect(ast.annexes.length).toBeLessThanOrEqual(MAX_ANNEXES);
      for (const annex of ast.annexes) expect(annex.sections.length).toBeLessThanOrEqual(MAX_ANNEX_SECTIONS);
    });

    it("has the sections of the mockup, unnumbered (DD-5)", () => {
      expect(ast.sections.map((section) => section.heading)).toEqual(expected.contractSections);
      expect(Object.fromEntries(ast.annexes.map((annex) => [annex.designation, annex.sections.map((section) => section.heading)]))).toEqual(
        expected.annexSections,
      );
      for (const heading of text.split("\n").filter((line) => /^#{2,3} /.test(line))) expect(heading).not.toMatch(/^#{2,3} \d/);
      expect(text).not.toMatch(/\{\{[a-z_0-9]+::#{2,3} \d/);
    });

    it("has none of the mockup's layout markers (DD-5)", () => {
      for (const line of text.split("\n")) {
        expect(line).not.toMatch(/^@@(W|PAGEBREAK)\b/);
        expect(line).not.toMatch(/^\^\^/);
        expect(line.trim()).not.toBe("---");
        expect(line).not.toMatch(/^# /);
      }
    });
  });

  describe(`${expected.code}: the header and the signature are the CRM's (DD-1, AC-9.6)`, () => {
    it("keeps the salutation, the acceptance label and the two opening paragraphs", () => {
      expect(ast.salutation).toBe("Spett.le");
      expect(ast.acceptanceLabel).toBe("Il Cliente");
      const opening = ast.opening.filter((line) => line.nodes.length > 0);
      expect(opening).toHaveLength(2);
      const plain = (index: number) => opening[index]!.nodes.map((node) => (node.type === "text" ? node.text : node.type === "field" ? `[${node.name}]` : "")).join("");
      expect(plain(0)).toStartWith("Con riferimento alle discussioni intercorse");
      expect(plain(1)).toStartWith(COUNTED);
    });

    it("has none of the lines the CRM draws itself", () => {
      for (const drawn of ["A.c.a.", "CONTRATTO DI FORNITURA", "Lugano, ", "Per accettazione", "Luogo e data", "Firma valida", "Allegati:", "[DATA]"]) {
        expect(text).not.toContain(drawn);
      }
      expect(text.startsWith("@@salutation Spett.le\n@@acceptance Il Cliente\n")).toBe(true);
    });
  });

  describe(`${expected.code}: money is the deal's currency (DD-12)`, () => {
    it("prints no literal CHF; the currency is a system value", () => {
      const printed = text.split("\n@@field ")[0]!; // a field's label is the mockup's, whatever it says (AC-9.1)
      expect(printed).not.toContain("CHF");
      expect(ast.fields.find((decl) => decl.name === "VALUTA")?.source).toBe("currency");
      expect(printed).toContain("[VALUTA]");
    });
  });

  describe(`${expected.code}: asks what the mockup asks, where it asks it (AC-9.1, DD-26)`, () => {
    it("declares exactly the mockup's fields, with its labels, hints, examples and defaults", () => {
      expect(Object.fromEntries(ast.fields.map((decl) => [decl.name, fieldView(decl)]))).toEqual(expected.fields);
    });

    it("declares its lists, tables, blocks and choices with the mockup's labels", () => {
      expect(Object.fromEntries(ast.lists.map((list) => [list.name, { label: list.label }]))).toEqual(expected.lists);
      expect(Object.fromEntries(ast.tables.map((table) => [table.name, { label: table.label, columns: table.columns, step: table.step }]))).toEqual(expected.tables);
      expect(Object.fromEntries(ast.blocks.map((block) => [block.name, { label: block.label, explain: block.explain, default: block.default }]))).toEqual(expected.blocks);
      expect(Object.fromEntries(ast.choices.map((choice) => [choice.name, { label: choice.label, options: choice.options, default: choice.default }]))).toEqual(
        expected.choices,
      );
    });

    it("puts the sections and the items in the steps of the mockup's mapping", () => {
      expect(stepsOf(ast)).toEqual(expected.steps);
    });

    it("puts every item in the step of the first section that uses it (DD-26, computed from the text)", () => {
      const first = mockupSteps(text);
      const declared = new Map<string, string>();
      for (const table of ast.tables) if (table.step) declared.set(table.name, table.step);
      const choiceStep = (name: string): string | undefined => {
        const options = ast.choices.find((choice) => choice.name === name)?.options ?? [];
        return options.map((option) => first.get(option)).filter((use) => use !== undefined).sort((a, b) => a!.at - b!.at)[0]?.step;
      };
      let checked = 0;
      for (const [step, content] of Object.entries(stepsOf(ast))) {
        for (const entry of content.items) {
          const id = entry.split(" > ").pop()!;
          if (id === "costTable") {
            expect(step).toBe("costs");
            continue;
          }
          const [type, name] = id.split(":") as [string, string];
          const want = declared.get(name) ?? (type === "choice" ? choiceStep(name) : first.get(name)?.step);
          expect({ name, step }).toEqual({ name, step: want as string });
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  });

  describe(`${expected.code}: a person starts from the mockup's defaults`, () => {
    it("has the blocks, choices and values the mockup starts with", () => {
      const answers = initialAnswers(ast, sampleContext("it"));
      expect(answers.blocks).toEqual(expected.start.blocks);
      expect(answers.fields).toEqual(expected.start.fields);
      expect(answers.validityDays).toBe(DEFAULT_VALIDITY_DAYS);
      expect(DEFAULT_VALIDITY_DAYS).toBe(30);
    });

    it("previews with sample answers that pass the answer checks (AC-8.5)", () => {
      expect(checkAnswers(ast, sampleAnswers(ast, "it"))).toEqual([]);
    });
  });
}

/** The cost lines and totals of the costs section, as `key:kind` and `total`. */
function costItems(ast: TemplateAst): string[] {
  const costs = ast.sections.find((section) => section.costs !== null)?.costs;
  if (!costs) throw new Error("no cost table");
  return costs.items.map((item) => (item.type === "total" ? "total" : `${item.key}:${item.kind}`));
}

const T1_EXPECT: Expectation = {
  code: "T1",
  fields: {
    "CLIENTE": field({ source: "client" }),
    "EMITTENTE": field({ source: "issuer" }),
    "OGGETTO_A_CORPO": field({ label: "Oggetto a corpo", hint: "Completa la frase «Oggetto della fornitura è …». Compare anche nella tabella costi.", example: "es. la progettazione e lo sviluppo dell'app …", kind: "text" }),
    "DESCRIZIONE_IN_UNA_FRASE": field({ label: "Descrizione in una frase", kind: "longtext" }),
    "FUNZIONALITÀ_RINVIATE": field({ label: "Funzionalità rinviate", hint: "Ciò che resta fuori e potrà essere sviluppato in una fase successiva.", kind: "longtext" }),
    "DURATA": field({ label: "Durata prevista", example: "es. 4 mesi", kind: "text" }),
    "VALUTA": field({ source: "currency" }),
    "MATERIALI_DATI_ACCESSI": field({ label: "Materiali, dati e accessi necessari", hint: "Se vuoto, resta l'impegno generico a fornire quanto necessario.", kind: "longtext" }),
    "SECONDA_VOCE": field({ label: "Seconda voce", example: "es. Fase 2 – integrazioni", kind: "text" }),
    "VOCE_A_SCELTA_DEL_CLIENTE": field({ label: "Voce a scelta", example: "es. Modulo reportistica", kind: "text" }),
    "VALIDITA_GIORNI": field({ label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" }),
    "ACCONTO": field({ label: "Acconto (%)", kind: "percentage", default: "50" }),
    "RATE": field({ label: "Quota in rate (%)", kind: "percentage" }),
    "N_RATE": field({ label: "Numero di rate", kind: "number" }),
    "SALDO": field({ label: "Saldo (%)", kind: "percentage", compute: "100 - ACCONTO - RATE" }),
    "RIF": field({ source: "reference" }),
    "DESCRIZIONE": field({ label: "Descrizione", kind: "text" }),
    "CRITERIO": field({ label: "Criterio di accettazione", kind: "text" }),
    "PROFILO_RISORSA": field({ label: "Profilo", kind: "text" }),
    "GG": field({ label: "Giorni/uomo", kind: "number" }),
    "TOTALE_GG": field({ label: "Totale giorni/uomo", kind: "number", compute: "sum(GG)" }),
    "PIATTAFORME_SUPPORTATE": field({ label: "Piattaforme, browser e dispositivi", kind: "text" }),
    "INTEGRAZIONI": field({ label: "Integrazioni con sistemi di terzi", kind: "text" }),
    "AMBIENTI": field({ label: "Ambienti", kind: "text" }),
    "RESPONSABILITÀ_FORNITORE": field({ label: "A carico del Fornitore", kind: "longtext" }),
    "RESPONSABILITÀ_CLIENTE": field({ label: "A carico del Cliente", kind: "longtext" }),
  },
  lists: {
    "FUNZIONALITÀ_O_DELIVERABLE": {
      "label": "Funzionalità o deliverable"
    },
    "ATTIVITÀ": {
      "label": "Attività"
    },
    "ESCLUSIONE": {
      "label": "Esclusioni"
    }
  },
  tables: {
    "FUNZIONALITÀ": {
      "label": "Funzionalità o deliverable",
      "columns": [
        "FUNZIONALITÀ",
        "DESCRIZIONE",
        "CRITERIO"
      ],
      "step": null
    },
    "VOCE_DI_STIMA": {
      "label": "Attività",
      "columns": [
        "VOCE_DI_STIMA",
        "PROFILO_RISORSA",
        "GG"
      ],
      "step": "annexes"
    }
  },
  blocks: {
    "allegato_a": {
      "label": "Allegato A",
      "explain": "Perimetro funzionale e stime in allegato.",
      "default": false
    },
    "collaudo_fasi": {
      "label": "Collaudo per fase",
      "explain": "Progetto in più fasi: il collaudo avviene al termine di ciascuna.",
      "default": false
    },
    "preprod": {
      "label": "Ambiente di pre-produzione",
      "explain": "WellD mette a disposizione un ambiente di pre-produzione durante lo sviluppo.",
      "default": false
    },
    "ai": {
      "label": "Sistemi di Intelligenza Artificiale",
      "explain": "La soluzione usa modelli o servizi AI di terzi: i costi d'uso sono a carico del Cliente.",
      "default": false
    },
    "voce2": {
      "label": "Seconda voce di costo",
      "explain": "Una seconda voce o fase a corpo nella tabella costi.",
      "default": false
    },
    "sconto": {
      "label": "Scontistica accordata",
      "explain": "Aggiunge la riga di sconto, come importo.",
      "default": false
    },
    "voce_scelta": {
      "label": "Voce a scelta del Cliente",
      "explain": "Voce che il Cliente può barrare; non entra nel totale.",
      "default": false
    },
    "rate": {
      "label": "Rate mensili",
      "explain": "Una parte dell'importo in rate mensili, tra acconto e saldo.",
      "default": false
    }
  },
  choices: {},
  contractSections: [
    "DEFINIZIONI",
    "OGGETTO DELLA FORNITURA",
    "ATTIVITÀ E TEMPISTICHE",
    "CONDIZIONI DI FORNITURA",
    "RISORSE, GARANZIA, MANUTENZIONE",
    "COSTI",
    "VALIDITÀ DELL'OFFERTA",
    "FATTURAZIONE",
    "CONDIZIONI GENERALI"
  ],
  annexSections: {
    "A": [
      "Che cosa viene consegnato",
      "Stime",
      "Requisiti tecnici",
      "Non incluso",
      "Responsabilità"
    ]
  },
  steps: {
    "scope": {
      "sections": [
        "DEFINIZIONI",
        "OGGETTO DELLA FORNITURA",
        "ATTIVITÀ E TEMPISTICHE"
      ],
      "items": [
        "block:allegato_a",
        "field:OGGETTO_A_CORPO",
        "field:DESCRIZIONE_IN_UNA_FRASE",
        "list:FUNZIONALITÀ_O_DELIVERABLE",
        "field:FUNZIONALITÀ_RINVIATE",
        "list:ATTIVITÀ",
        "field:DURATA"
      ]
    },
    "conditions": {
      "sections": [
        "CONDIZIONI DI FORNITURA",
        "RISORSE, GARANZIA, MANUTENZIONE"
      ],
      "items": [
        "block:collaudo_fasi",
        "field:MATERIALI_DATI_ACCESSI",
        "block:preprod",
        "block:ai"
      ]
    },
    "costs": {
      "sections": [
        "COSTI",
        "VALIDITÀ DELL'OFFERTA",
        "FATTURAZIONE"
      ],
      "items": [
        "costTable",
        "block:voce2",
        "block:voce2 > field:SECONDA_VOCE",
        "block:sconto",
        "block:voce_scelta",
        "block:voce_scelta > field:VOCE_A_SCELTA_DEL_CLIENTE",
        "field:VALIDITA_GIORNI",
        "field:ACCONTO",
        "block:rate",
        "block:rate > field:RATE",
        "block:rate > field:N_RATE",
        "field:SALDO"
      ]
    },
    "annexes": {
      "sections": [
        "CONDIZIONI GENERALI",
        "A: Che cosa viene consegnato",
        "A: Stime",
        "A: Requisiti tecnici",
        "A: Non incluso",
        "A: Responsabilità"
      ],
      "items": [
        "table:VOCE_DI_STIMA",
        "table:FUNZIONALITÀ",
        "field:TOTALE_GG",
        "field:PIATTAFORME_SUPPORTATE",
        "field:INTEGRAZIONI",
        "field:AMBIENTI",
        "list:ESCLUSIONE",
        "field:RESPONSABILITÀ_FORNITORE",
        "field:RESPONSABILITÀ_CLIENTE"
      ]
    }
  },
  start: {
    "blocks": {
      "allegato_a": false,
      "collaudo_fasi": false,
      "preprod": false,
      "ai": false,
      "voce2": false,
      "sconto": false,
      "voce_scelta": false,
      "rate": false
    },
    "fields": {
      "ACCONTO": "50"
    }
  },
};

const T2_EXPECT: Expectation = {
  code: "T2",
  fields: {
    "CLIENTE": field({ source: "client" }),
    "EMITTENTE": field({ source: "issuer" }),
    "AMBITO": field({ label: "Ambito", hint: "A supporto di quale progetto o team lavorano le risorse.", example: "es. del team mobile banking", kind: "text" }),
    "DATA_INIZIO": field({ label: "Inizio", kind: "date" }),
    "DATA_FINE": field({ label: "Fine", kind: "date" }),
    "FTE": field({ label: "FTE", kind: "number" }),
    "IMPIEGO": field({ label: "Impiego", example: "100%", kind: "text" }),
    "GG": field({ label: "Giorni/uomo", kind: "number" }),
    "TOTALE_GG": field({ label: "Totale giorni/uomo", kind: "number", compute: "sum(GG)" }),
    "IMPIEGO_MINIMO": field({ label: "Impiego minimo (%)", hint: "Percentuale minima per FTE su base mensile.", kind: "percentage" }),
    "VALUTA": field({ source: "currency" }),
    "TARIFFA": field({ label: "Tariffa / giorno", kind: "amount" }),
    "VALIDITA_GIORNI": field({ label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" }),
  },
  lists: {},
  tables: {
    "PROFILO": {
      "label": "Profilo",
      "columns": [
        "PROFILO",
        "FTE",
        "IMPIEGO",
        "GG",
        "TARIFFA"
      ],
      "step": null
    }
  },
  blocks: {
    "pacchetto": {
      "label": "Pacchetto giornate prepagato",
      "explain": "Fatturato in anticipo. Le giornate non usate entro la scadenza si esauriscono.",
      "default": false
    },
    "dati_critici": {
      "label": "Clausola dati critici",
      "explain": "Il Cliente non espone al Fornitore dati critici (carte, conti). Tipica dei clienti bancari.",
      "default": false
    },
    "risorse_extra": {
      "label": "Risorse aggiuntive",
      "explain": "Risorse in più, su richiesta scritta, alle stesse tariffe.",
      "default": false
    },
    "sconto": {
      "label": "Scontistica accordata",
      "explain": "Aggiunge la riga di sconto, come importo.",
      "default": false
    },
    "consuntivo": {
      "label": "A consuntivo, con tetto",
      "explain": "Fatturazione mensile dei giorni erogati, nel limite del totale.",
      "default": false
    }
  },
  choices: {
    "modalita": {
      "label": "Modalità di fornitura",
      "options": [
        "consuntivo",
        "pacchetto"
      ],
      "default": "consuntivo"
    }
  },
  contractSections: [
    "DEFINIZIONI",
    "OGGETTO DELLA FORNITURA",
    "ATTIVITÀ E TEMPISTICHE",
    "CONDIZIONI DI FORNITURA",
    "RISORSE",
    "COSTI",
    "DURATA, RINNOVO E DISDETTA",
    "FATTURAZIONE",
    "CONDIZIONI GENERALI"
  ],
  annexSections: {},
  steps: {
    "scope": {
      "sections": [
        "DEFINIZIONI",
        "OGGETTO DELLA FORNITURA",
        "ATTIVITÀ E TEMPISTICHE"
      ],
      "items": [
        "choice:modalita",
        "field:AMBITO",
        "field:DATA_INIZIO",
        "field:DATA_FINE",
        "table:PROFILO",
        "field:TOTALE_GG",
        "field:IMPIEGO_MINIMO"
      ]
    },
    "conditions": {
      "sections": [
        "CONDIZIONI DI FORNITURA",
        "RISORSE"
      ],
      "items": [
        "block:dati_critici",
        "block:risorse_extra"
      ]
    },
    "costs": {
      "sections": [
        "COSTI",
        "DURATA, RINNOVO E DISDETTA",
        "FATTURAZIONE"
      ],
      "items": [
        "costTable",
        "block:sconto",
        "field:VALIDITA_GIORNI"
      ]
    }
  },
  start: {
    "blocks": {
      "dati_critici": false,
      "risorse_extra": false,
      "sconto": false,
      "consuntivo": true,
      "pacchetto": false
    },
    "fields": {}
  },
};


describe("T1: the cost table (DD-13, AC-4.7)", () => {
  const ast = read(welldChItT1Text);
  const costs = ast.sections.find((section) => section.costs)!.costs!;
  const costTable = () => outline(ast, null).steps.find((step) => step.key === "costs")!.items.find((item) => item.type === "costTable")!;

  it("has the lines of the mockup, the voce a scelta an option line after the last total", () => {
    expect(costItems(ast)).toEqual(["oggetto:one_off", "voce2:one_off", "sconto:discount", "total", "scelta:option"]);
  });

  it("prefills the first line from the deal and takes the others as typed; the discount is typed, not a percentage", () => {
    const lines = costs.items.filter((item) => item.type === "line");
    expect(lines.map((line) => [line.key, line.unit.type, line.qty === null ? null : line.qty.type === "literal" ? line.qty.value : line.qty.type])).toEqual([
      ["oggetto", "deal", 1],
      ["voce2", "entered", 1],
      ["sconto", "entered", null],
      ["scelta", "entered", 1],
    ]);
  });

  it("closes its only span with TOTALE and keeps the 018 columns", () => {
    const table = costTable();
    expect(table.type === "costTable" && table.totals).toEqual(["TOTALE"]);
    expect(costs.columns).toEqual({ position: true, unit: true });
  });

  it("puts the second line, the discount and the option line behind the mockup's blocks", () => {
    const table = costTable();
    expect(table.type === "costTable" && table.lines.map((line) => [line.key, line.block])).toEqual([
      ["oggetto", null],
      ["voce2", "voce2"],
      ["sconto", "sconto"],
      ["scelta", "voce_scelta"],
    ]);
  });
});

describe("T1: the annex, the lists and the derived figures (DD-2, DD-5)", () => {
  const ast = read(welldChItT1Text);

  it("has Allegato A as a text annex inside its block, with a subtitle", () => {
    expect(ast.annexes.map((annex) => annex.designation)).toEqual(["A"]);
    expect(ast.annexes[0]!.conds.map((cond) => [cond.op, ...cond.names])).toEqual([["on", "allegato_a"]]);
    expect(ast.annexes[0]!.subtitle).not.toBeNull();
  });

  it("collapses the mockup's numbered placeholders into one list or table row each", () => {
    expect(welldChItT1Text).not.toMatch(/\[[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9_]*_\d\]/);
    expect(ast.lists.map((list) => list.name)).toEqual(["FUNZIONALITÀ_O_DELIVERABLE", "ATTIVITÀ", "ESCLUSIONE"]);
    expect(ast.tables.map((table) => table.name)).toEqual(["FUNZIONALITÀ", "VOCE_DI_STIMA"]);
  });

  it("totals the estimate from its rows and works out the balance of the payment plan", () => {
    const computed = (name: string) => ast.fields.find((decl) => decl.name === name)!.compute?.source;
    expect(computed("TOTALE_GG")).toBe("sum(GG)");
    expect(computed("SALDO")).toBe("100 - ACCONTO - RATE");
  });
});

describe("T2: the cost table (DD-24, AC-4.2)", () => {
  const ast = read(welldChItT2Text);
  const costs = ast.sections.find((section) => section.costs)!.costs!;

  it("repeats one line per profile of the table, priced by the rate and the days of its row", () => {
    expect(costItems(ast)).toEqual(["consulenza:one_off", "sconto:discount", "total"]);
    const line = costs.items[0]!;
    expect(line.type === "line" && [line.each, line.unit, line.qty]).toEqual(["PROFILO", { type: "field", name: "TARIFFA" }, { type: "field", name: "GG" }]);
  });

  it("keeps the mockup's CHF / giorno and Giorni headers through @@costlabels, the currency being the deal's", () => {
    expect(costs.labels).not.toBeNull();
    expect(costs.labels!.unit).toEqual([
      { type: "field", name: "VALUTA" },
      { type: "text", text: " / giorno" },
    ]);
    expect(costs.labels!.quantity).toEqual([{ type: "text", text: "Giorni" }]);
  });

  it("asks the rate and the days of every profile before a line can be priced", () => {
    const table = outline(ast, null).steps.flatMap((step) => step.items).find((item) => item.type === "table")!;
    expect(table.type === "table" && table.columns.map((column) => [column.name, column.required])).toEqual([
      ["PROFILO", true],
      ["FTE", false],
      ["IMPIEGO", false],
      ["GG", true],
      ["TARIFFA", true],
    ]);
  });

  it("offers the supply modes as one choice, per consumption by default", () => {
    expect(ast.choices.map((choice) => [choice.name, choice.options, choice.default])).toEqual([["modalita", ["consuntivo", "pacchetto"], "consuntivo"]]);
    expect(initialAnswers(ast, sampleContext("it")).blocks).toMatchObject({ consuntivo: true, pacchetto: false });
  });
});

describeConversion(welldChItT1Text, T1_EXPECT);
describeConversion(welldChItT2Text, T2_EXPECT);
