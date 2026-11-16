/**
 * T23 (specs/20261115-crm-offer-wizard): the mockup's "Progetto a corpo con SLA" (T1+T3, mockup id T13) in the plan's grammar:
 * AC-9.1, AC-9.5 (two text annexes), AC-9.6, DD-3 (limits), and its clauses shared with T1 and T3 identical to theirs.
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
import { welldChItT3Text } from "./welldChIt.T3";
import { welldChItT1T3Text } from "./welldChIt.T1T3";

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

const T1T3_EXPECT: Expectation = {
  code: "T1+T3",
  fields: {
    "CLIENTE": field({ source: "client" }),
    "EMITTENTE": field({ source: "issuer" }),
    "INDIRIZZO_EMITTENTE": field({ source: "issuerAddress" }),
    "OGGETTO_A_CORPO": field({ label: "Oggetto a corpo", hint: "Completa la frase «Oggetto della fornitura è …». Compare anche nella tabella costi.", example: "es. la progettazione e lo sviluppo dell'app …", kind: "text" }),
    "DESCRIZIONE_IN_UNA_FRASE": field({ label: "Descrizione in una frase", kind: "longtext" }),
    "PIATTAFORMA": field({ label: "Piattaforma", example: "Nome del software in manutenzione", kind: "text" }),
    "PROFILO": field({ label: "Profilo SLA", hint: "Scegliendo il profilo si compilano tempi di presa in carico e copertura oraria.", kind: "text", options: ["Base", "Standard", "Premium"], fills: {"Base": {"TEMPO_S1": "1 giorno lavorativo", "TEMPO_S2": "2 giorni lavorativi", "TEMPO_S3": "5 giorni lavorativi", "TEMPO_S4": "10 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"}, "Standard": {"TEMPO_S1": "6 ore lavorative", "TEMPO_S2": "1 giorno lavorativo", "TEMPO_S3": "2 giorni lavorativi", "TEMPO_S4": "5 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"}, "Premium": {"TEMPO_S1": "2 ore lavorative", "TEMPO_S2": "4 ore lavorative", "TEMPO_S3": "1 giorno lavorativo", "TEMPO_S4": "3 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 08:00–20:00"}} }),
    "ORE": field({ label: "Ore del pacchetto annuale", kind: "number" }),
    "DURATA": field({ label: "Durata prevista", example: "es. 4 mesi", kind: "text" }),
    "DATA_AVVIO_SERVIZIO": field({ label: "Data di avvio del servizio", example: "una data, oppure «la data di messa in produzione»", kind: "text" }),
    "VALUTA": field({ source: "currency" }),
    "MATERIALI_DATI_ACCESSI": field({ label: "Materiali, dati e accessi necessari", hint: "Se vuoto, resta l'impegno generico a fornire quanto necessario.", kind: "longtext" }),
    "INFRASTRUTTURA": field({ label: "Infrastruttura di produzione", kind: "text", options: ["gestita da WellD", "gestita dal Cliente"] }),
    "TEMPO_S1": field({ label: "Presa in carico S1 · Critica", kind: "text" }),
    "TEMPO_S2": field({ label: "Presa in carico S2 · Alta", kind: "text" }),
    "TEMPO_S3": field({ label: "Presa in carico S3 · Media", kind: "text" }),
    "TEMPO_S4": field({ label: "Presa in carico S4 · Bassa", kind: "text" }),
    "COPERTURA_ORARIA": field({ label: "Copertura oraria", kind: "text" }),
    "VALIDITA_GIORNI": field({ label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" }),
    "ACCONTO": field({ label: "Acconto (%)", kind: "percentage", default: "50" }),
    "SALDO": field({ label: "Saldo (%)", kind: "percentage", compute: "100 - ACCONTO" }),
    "CADENZA_FATTURAZIONE": field({ label: "Cadenza di fatturazione", kind: "text", options: ["annuale", "semestrale", "trimestrale", "mensile"] }),
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
    "INDIRIZZO_CLIENTE": field({ source: "clientAddress" }),
    "OPZIONI": field({ label: "Opzioni attive", example: "nessuna", kind: "text" }),
    "REFERENTE_CLIENTE": field({ source: "contacts" }),
    "EMAIL_REFERENTE_CLIENTE": field({ label: "E-mail referente Cliente", kind: "text" }),
    "REFERENTE_WELLD": field({ label: "Referente WellD", kind: "text" }),
    "EMAIL_REFERENTE_WELLD": field({ label: "E-mail referente WellD", kind: "text" }),
    "EMAIL_SUPPORTO": field({ label: "E-mail del supporto", kind: "text" }),
    "PM_WELLD": field({ label: "Responsabile delivery WellD", kind: "text" }),
    "RESP_CLIENTE": field({ label: "Responsabile applicativo del Cliente", kind: "text" }),
    "DIREZIONE_WELLD": field({ label: "Direzione WellD", kind: "text" }),
    "DIREZIONE_CLIENTE": field({ label: "Direzione del Cliente", kind: "text" }),
    "ALTRI_AMBIENTI": field({ label: "Altri ambienti", example: "oltre a produzione e staging", kind: "text" }),
    "PROVIDER_CLOUD": field({ label: "Provider cloud", kind: "text" }),
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
    },
    "COMPONENTE": {
      "label": "Componenti"
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
    "ai": {
      "label": "Sistemi di Intelligenza Artificiale",
      "explain": "La soluzione usa modelli o servizi AI di terzi: i costi d'uso sono a carico del Cliente.",
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
    "DURATA, RINNOVO E DISDETTA",
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
    ],
    "SLA": [
      "Parametri del servizio",
      "Oggetto e perimetro",
      "Definizioni",
      "Profili di servizio",
      "Manutenzione correttiva",
      "Manutenzione adattiva ed evolutiva",
      "Canali operativi di supporto",
      "Matrice di escalation",
      "Obblighi del Cliente",
      "Gestione dei rilasci e degli ambienti",
      "Esclusioni dal servizio",
      "Infrastruttura e disponibilità",
      "Presidio e pacchetto ore",
      "Durata, rinnovo e cessazione",
      "Condizioni generali"
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
        "field:PIATTAFORMA",
        "field:PROFILO",
        "field:ORE",
        "list:ATTIVITÀ",
        "field:DURATA",
        "field:DATA_AVVIO_SERVIZIO"
      ]
    },
    "conditions": {
      "sections": [
        "CONDIZIONI DI FORNITURA",
        "RISORSE, GARANZIA, MANUTENZIONE"
      ],
      "items": [
        "field:MATERIALI_DATI_ACCESSI",
        "field:INFRASTRUTTURA",
        "block:ai",
        "field:TEMPO_S1",
        "field:TEMPO_S2",
        "field:TEMPO_S3",
        "field:TEMPO_S4",
        "field:COPERTURA_ORARIA"
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
        "field:VALIDITA_GIORNI",
        "field:ACCONTO",
        "field:SALDO",
        "field:CADENZA_FATTURAZIONE"
      ]
    },
    "annexes": {
      "sections": [
        "CONDIZIONI GENERALI",
        "A: Che cosa viene consegnato",
        "A: Stime",
        "A: Requisiti tecnici",
        "A: Non incluso",
        "A: Responsabilità",
        "SLA: Parametri del servizio",
        "SLA: Oggetto e perimetro",
        "SLA: Definizioni",
        "SLA: Profili di servizio",
        "SLA: Manutenzione correttiva",
        "SLA: Manutenzione adattiva ed evolutiva",
        "SLA: Canali operativi di supporto",
        "SLA: Matrice di escalation",
        "SLA: Obblighi del Cliente",
        "SLA: Gestione dei rilasci e degli ambienti",
        "SLA: Esclusioni dal servizio",
        "SLA: Infrastruttura e disponibilità",
        "SLA: Presidio e pacchetto ore",
        "SLA: Durata, rinnovo e cessazione",
        "SLA: Condizioni generali"
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
        "field:RESPONSABILITÀ_CLIENTE",
        "field:OPZIONI",
        "field:EMAIL_REFERENTE_CLIENTE",
        "field:REFERENTE_WELLD",
        "field:EMAIL_REFERENTE_WELLD",
        "list:COMPONENTE",
        "field:EMAIL_SUPPORTO",
        "field:PM_WELLD",
        "field:RESP_CLIENTE",
        "field:DIREZIONE_WELLD",
        "field:DIREZIONE_CLIENTE",
        "field:ALTRI_AMBIENTI",
        "field:PROVIDER_CLOUD"
      ]
    }
  },
  start: {
    "blocks": {
      "allegato_a": false,
      "ai": false
    },
    "fields": {
      "ACCONTO": "50"
    }
  },
};


describe("T1+T3: the cost table (DD-13, DD-35, DD-39)", () => {
  const ast = read(welldChItT1T3Text);
  const costs = ast.sections.find((section) => section.costs)!.costs!;

  it("has the project line and its total, then the yearly lines and theirs, nothing after the last total", () => {
    expect(costItems(ast)).toEqual(["oggetto:one_off", "total", "canone:yearly", "pacchetto:yearly", "total"]);
  });

  it("names both spans and prefills the project line from the deal", () => {
    const table = outline(ast, null).steps.find((step) => step.key === "costs")!.items.find((item) => item.type === "costTable")!;
    expect(table.type === "costTable" && table.totals).toEqual(["TOTALE progetto, una tantum", "TOTALE manutenzione e supporto, annuo"]);
    expect(costs.items[0]!.type === "line" && costs.items[0]!.unit).toEqual({ type: "deal" });
  });

  it("has no discount, so no percentage discount beside two totals (DD-39)", () => {
    expect(costs.items.filter((item) => item.type === "line" && (item.kind === "discount" || item.unit.type === "percent"))).toEqual([]);
  });

  it("works out the balance of the project's payment plan without rates", () => {
    expect(ast.fields.find((decl) => decl.name === "SALDO")!.compute?.source).toBe("100 - ACCONTO");
  });
});

describe("T1+T3: two text annexes (DD-2, DD-3)", () => {
  const ast = read(welldChItT1T3Text);

  it("has Allegato A, optional, then the SLA annex, always", () => {
    expect(ast.annexes.map((annex) => [annex.designation, annex.conds.map((cond) => cond.names.join(","))])).toEqual([
      ["A", ["allegato_a"]],
      ["SLA", []],
    ]);
    for (const annex of ast.annexes) expect(annex.sections.length).toBeLessThanOrEqual(MAX_ANNEX_SECTIONS);
  });

  it("has at most 15 contract sections (the mockup's 9)", () => {
    expect(ast.sections).toHaveLength(9);
    expect(ast.sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
  });
});

/** The blocks of a seed's text without its declarations, long enough to be told apart. */
const PREFIX = 40;
const blocksOf = (text: string): string[] =>
  text
    .split("\n@@field ")[0]!
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length >= PREFIX);

/**
 * The blocks the mockup's T13 words differently from T1 and T3: its own cross-references (par. 2.1 for par. 2, the
 * Allegato SLA), its own sentences about the project and the maintenance, the costs, the payment plan and the
 * responsibilities table. Every other block T13 shares with T1 or T3 is the same clause, and stays byte for byte the same.
 */
const WORDED_DIFFERENTLY: string[] = [
  "**Collaudo:** verifica, da parte del Cli",
  "**Change Request:** richiesta di nuove f",
  "## ATTIVITÀ E TEMPISTICHE\n{{?ATTIVITÀ::P",
  "## CONDIZIONI DI FORNITURA\n@@step condit",
  "La fornitura esclude quanto non esplicit",
  "- **non conformità**: quanto previsto da",
  "Le richieste che escono dal perimetro de",
  "In assenza di approvazione scritta la ri",
  "L'infrastruttura di produzione della Pia",
  "Quanto sviluppato con la presente fornit",
  "a. la disponibilità di personale qualifi",
  "a. le segnalazioni non comunicate tramit",
  "Gli interventi richiesti per iscritto da",
  "## COSTI\n@@step costs\n@@costs position u",
  "- I costi si intendono IVA esclusa.\n- Le",
  "Il servizio di manutenzione e supporto h",
  "## FATTURAZIONE\nLa fatturazione avviene ",
  "- **[ACCONTO]**% acconto a inizio lavori",
  "@@OPT_START allegato_a\n@@annex A Perimet",
  "@@OPT_START ?RESPONSABILITÀ_FORNITORE,RE"
];

describe("T1+T3: the clauses it shares with T1 and T3 are the same text (AC-9.6)", () => {
  const known = new Map<string, string[]>();
  for (const block of [...blocksOf(welldChItT1Text), ...blocksOf(welldChItT3Text)]) {
    known.set(block.slice(0, PREFIX), [...(known.get(block.slice(0, PREFIX)) ?? []), block]);
  }

  it("has every block that starts like one of T1 or T3 equal to it, but the ones the mockup words differently", () => {
    const different: string[] = [];
    let same = 0;
    for (const block of blocksOf(welldChItT1T3Text)) {
      const candidates = known.get(block.slice(0, PREFIX));
      if (!candidates) continue;
      if (candidates.includes(block)) same += 1;
      else different.push(block.slice(0, PREFIX));
    }
    expect(different).toEqual(WORDED_DIFFERENTLY);
    expect(same).toBeGreaterThanOrEqual(100);
  });

  it("has the whole SLA annex of T3, from its first line to its last", () => {
    const annex = (text: string) => text.slice(text.indexOf("@@annex SLA "), text.indexOf("\n@@field "));
    expect(annex(welldChItT1T3Text)).toBe(annex(welldChItT3Text));
    expect(annex(welldChItT1T3Text).length).toBeGreaterThan(20_000);
  });

  it("has the general conditions of T1 and T3 whole", () => {
    const general = (text: string) => {
      const start = text.indexOf("\n## CONDIZIONI GENERALI\n");
      const end = text.indexOf("\n@@", start + 30);
      return text.slice(start, end === -1 ? undefined : end).replace("\n@@step annexes", "");
    };
    expect(general(welldChItT1T3Text)).toBe(general(welldChItT1Text));
    expect(general(welldChItT1T3Text)).toBe(general(welldChItT3Text));
  });
});

describeConversion(welldChItT1T3Text, T1T3_EXPECT);
