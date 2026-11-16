/**
 * T20 (specs/20261115-crm-offer-wizard): the mockup's "Manutenzione e SLA" (T3) in the plan's grammar:
 * AC-9.1, AC-9.5 (the SLA text annex), AC-9.6, AC-1.9 (the profile fills), DD-13 (yearly lines, TOTALE primo anno), DD-39.
 */
import { describe, expect, it } from "bun:test";
import { checkAnswers, DEFAULT_VALIDITY_DAYS, initialAnswers, sampleAnswers, sampleContext, setField } from "../../offers/engine/answers";
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
import { welldChItT3Text } from "./welldChIt.T3";

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

const T3_EXPECT: Expectation = {
  code: "T3",
  fields: {
    "CLIENTE": field({ source: "client" }),
    "EMITTENTE": field({ source: "issuer" }),
    "INDIRIZZO_EMITTENTE": field({ source: "issuerAddress" }),
    "PIATTAFORMA": field({ label: "Piattaforma", example: "Nome del software in manutenzione", kind: "text" }),
    "PROFILO": field({ label: "Profilo SLA", hint: "Scegliendo il profilo si compilano tempi di presa in carico e copertura oraria.", kind: "text", options: ["Base", "Standard", "Premium"], fills: {"Base": {"TEMPO_S1": "1 giorno lavorativo", "TEMPO_S2": "2 giorni lavorativi", "TEMPO_S3": "5 giorni lavorativi", "TEMPO_S4": "10 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"}, "Standard": {"TEMPO_S1": "6 ore lavorative", "TEMPO_S2": "1 giorno lavorativo", "TEMPO_S3": "2 giorni lavorativi", "TEMPO_S4": "5 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"}, "Premium": {"TEMPO_S1": "2 ore lavorative", "TEMPO_S2": "4 ore lavorative", "TEMPO_S3": "1 giorno lavorativo", "TEMPO_S4": "3 giorni lavorativi", "COPERTURA_ORARIA": "dal lunedì al venerdì, 08:00–20:00"}} }),
    "ORE": field({ label: "Ore del pacchetto annuale", kind: "number" }),
    "VALUTA": field({ source: "currency" }),
    "TEMPO_S1": field({ label: "Presa in carico S1 · Critica", kind: "text" }),
    "TEMPO_S2": field({ label: "Presa in carico S2 · Alta", kind: "text" }),
    "TEMPO_S3": field({ label: "Presa in carico S3 · Media", kind: "text" }),
    "TEMPO_S4": field({ label: "Presa in carico S4 · Bassa", kind: "text" }),
    "COPERTURA_ORARIA": field({ label: "Copertura oraria", kind: "text" }),
    "INFRASTRUTTURA": field({ label: "Infrastruttura di produzione", kind: "text", options: ["gestita da WellD", "gestita dal Cliente"] }),
    "VALIDITA_GIORNI": field({ label: "Validità dell'offerta (giorni)", kind: "number", source: "validityDays" }),
    "DATA_AVVIO_SERVIZIO": field({ label: "Data di avvio del servizio", example: "una data, oppure «la data di messa in produzione»", kind: "text" }),
    "CADENZA_FATTURAZIONE": field({ label: "Cadenza di fatturazione", kind: "text", options: ["annuale", "semestrale", "trimestrale", "mensile"] }),
    "RIF": field({ source: "reference" }),
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
    "COMPONENTE": {
      "label": "Componenti"
    }
  },
  tables: {},
  blocks: {
    "attivazione": {
      "label": "Attivazione del servizio",
      "explain": "Voce una tantum per la presa in carico di una piattaforma non sviluppata da WellD.",
      "default": false
    }
  },
  choices: {},
  contractSections: [
    "DEFINIZIONI",
    "OGGETTO DELLA FORNITURA",
    "SERVICE LEVEL AGREEMENT",
    "CONDIZIONI DI FORNITURA",
    "RISORSE",
    "COSTI",
    "DURATA, RINNOVO E DISDETTA",
    "FATTURAZIONE",
    "CONDIZIONI GENERALI"
  ],
  annexSections: {
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
        "SERVICE LEVEL AGREEMENT"
      ],
      "items": [
        "block:attivazione",
        "field:PIATTAFORMA",
        "field:PROFILO",
        "field:ORE",
        "field:TEMPO_S1",
        "field:TEMPO_S2",
        "field:TEMPO_S3",
        "field:TEMPO_S4",
        "field:COPERTURA_ORARIA"
      ]
    },
    "conditions": {
      "sections": [
        "CONDIZIONI DI FORNITURA",
        "RISORSE"
      ],
      "items": [
        "field:INFRASTRUTTURA"
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
        "field:DATA_AVVIO_SERVIZIO",
        "field:CADENZA_FATTURAZIONE"
      ]
    },
    "annexes": {
      "sections": [
        "CONDIZIONI GENERALI",
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
      "attivazione": false
    },
    "fields": {}
  },
};


const SLA_PROFILES: Record<string, Record<string, string>> = {
  "Base": {
    "TEMPO_S1": "1 giorno lavorativo",
    "TEMPO_S2": "2 giorni lavorativi",
    "TEMPO_S3": "5 giorni lavorativi",
    "TEMPO_S4": "10 giorni lavorativi",
    "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"
  },
  "Standard": {
    "TEMPO_S1": "6 ore lavorative",
    "TEMPO_S2": "1 giorno lavorativo",
    "TEMPO_S3": "2 giorni lavorativi",
    "TEMPO_S4": "5 giorni lavorativi",
    "COPERTURA_ORARIA": "dal lunedì al venerdì, 09:00–18:00"
  },
  "Premium": {
    "TEMPO_S1": "2 ore lavorative",
    "TEMPO_S2": "4 ore lavorative",
    "TEMPO_S3": "1 giorno lavorativo",
    "TEMPO_S4": "3 giorni lavorativi",
    "COPERTURA_ORARIA": "dal lunedì al venerdì, 08:00–20:00"
  }
};

describe("T3: the cost table (DD-13, DD-39)", () => {
  const ast = read(welldChItT3Text);
  const costs = ast.sections.find((section) => section.costs)!.costs!;

  it("has the canone and the pacchetto ore as yearly lines, the activation one-off, and one TOTALE primo anno", () => {
    expect(costItems(ast)).toEqual(["canone:yearly", "pacchetto:yearly", "attivazione:one_off", "total"]);
    const table = outline(ast, null).steps.find((step) => step.key === "costs")!.items.find((item) => item.type === "costTable")!;
    expect(table.type === "costTable" && table.totals).toEqual(["TOTALE primo anno"]);
    expect(table.type === "costTable" && table.lines.map((line) => [line.key, line.block])).toEqual([
      ["canone", null],
      ["pacchetto", null],
      ["attivazione", "attivazione"],
    ]);
  });

  it("prices the pacchetto at 150 an hour for the hours of the offer", () => {
    const line = costs.items.find((item) => item.type === "line" && item.key === "pacchetto")!;
    expect(line.type === "line" && [line.unit, line.qty]).toEqual([{ type: "amount", cents: 15_000 }, { type: "field", name: "ORE" }]);
  });

  it("has no percentage discount and no discount at all (DD-39)", () => {
    expect(costs.items.filter((item) => item.type === "line" && (item.kind === "discount" || item.unit.type === "percent"))).toEqual([]);
  });
});

describe("T3: the SLA profile fills what the mockup fills (AC-1.9, AC-9.5)", () => {
  const ast = read(welldChItT3Text);
  const start = initialAnswers(ast, sampleContext("it"));

  it("offers Base, Standard and Premium and starts with none chosen", () => {
    expect(ast.fields.find((decl) => decl.name === "PROFILO")!.options).toEqual(["Base", "Standard", "Premium"]);
    expect(start.fields.PROFILO).toBeUndefined();
  });

  for (const [profile, values] of Object.entries(SLA_PROFILES)) {
    it(`choosing ${profile} fills the response times and the hours of cover`, () => {
      expect(setField(ast, start, "PROFILO", profile).fields).toEqual({ PROFILO: profile, ...values });
    });
  }

  it("keeps what the person typed for the fields no profile fills, and changes the filled ones with a new profile", () => {
    const typed = setField(ast, setField(ast, start, "PIATTAFORMA", "Portale fornitori"), "PROFILO", "Base");
    expect(setField(ast, typed, "PROFILO", "Premium").fields).toEqual({ PIATTAFORMA: "Portale fornitori", PROFILO: "Premium", ...SLA_PROFILES.Premium });
  });

  it("lists the fills with the labels of the fields they set, for the wizard to show", () => {
    const item = outline(ast, null).steps.flatMap((step) => step.items).find((candidate) => candidate.type === "field" && candidate.name === "PROFILO")!;
    const labels = ["Presa in carico S1 · Critica", "Presa in carico S2 · Alta", "Presa in carico S3 · Media", "Presa in carico S4 · Bassa", "Copertura oraria"];
    expect(item.type === "field" && item.fills.map((fill) => [fill.option, fill.assigns.map((assign) => assign.label)])).toEqual([
      ["Base", labels],
      ["Standard", labels],
      ["Premium", labels],
    ]);
  });
});

describe("T3: the SLA annex is a text annex (DD-2, DD-3)", () => {
  const ast = read(welldChItT3Text);

  it("is one annex, SLA, of the mockup's 15 sections, with its subtitle and no condition", () => {
    expect(ast.annexes.map((annex) => annex.designation)).toEqual(["SLA"]);
    expect(ast.annexes[0]!.sections).toHaveLength(15);
    expect(ast.annexes[0]!.sections.length).toBeLessThanOrEqual(MAX_ANNEX_SECTIONS);
    expect(ast.annexes[0]!.subtitle).not.toBeNull();
    expect(ast.annexes[0]!.conds).toEqual([]);
  });

  it("asks for its optional parts in the annexes step: the options, the contacts, the components, the environments", () => {
    const annexes = outline(ast, null).steps.find((step) => step.key === "annexes")!;
    expect(annexes.items.map((item) => ("name" in item ? item.name : item.type))).toEqual([
      "OPZIONI",
      "EMAIL_REFERENTE_CLIENTE",
      "REFERENTE_WELLD",
      "EMAIL_REFERENTE_WELLD",
      "COMPONENTE",
      "EMAIL_SUPPORTO",
      "PM_WELLD",
      "RESP_CLIENTE",
      "DIREZIONE_WELLD",
      "DIREZIONE_CLIENTE",
      "ALTRI_AMBIENTI",
      "PROVIDER_CLOUD",
    ]);
  });

  it("takes the client's referent from the contacts chosen for the offer, not from a field of its own", () => {
    expect(ast.fields.find((decl) => decl.name === "REFERENTE_CLIENTE")).toMatchObject({ source: "contacts", label: null });
  });
});

describeConversion(welldChItT3Text, T3_EXPECT);
