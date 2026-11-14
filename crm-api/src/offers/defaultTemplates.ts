/**
 * The offer templates seeded for an entity that has none (specs/20261102-crm-offer-document AC-2.3).
 * Written from the seven offers wellD supplied on 2026-11-02, with every
 * client-specific detail removed. Texts use the markup of spec AC-1.6 and the
 * placeholders the draft resolves ({deal}, {issuer}, {client}, {currency},
 * {epics}, {phases}, {timeline}, {manDays}, {validityDays}).
 *
 * `[n]` marks a figure the salesperson fills in per offer.
 */

import type { OfferSection, OfferTemplateContent } from "./contract";

// ─── Italian building blocks ─────────────────────────────────────────────────

const OPENING_IT =
  "Con riferimento alle discussioni intercorse, abbiamo piacere di sottoporVi la nostra migliore offerta per la fornitura in oggetto.\n\n" +
  "Il presente contratto viene stipulato tra {issuer}, di seguito denominata ‘Fornitore’ e {client}, di seguito denominato ‘Cliente’.";

const DEF_CORPO_IT =
  "**A corpo:** attività svolta dal Fornitore presso la propria sede o luogo da esso gestito e fatturata sulla base del rilascio di un prodotto/servizio.";

const DEF_SERVIZIO_IT =
  "**A servizio:** attività svolta dal Fornitore presso la sede propria o del Cliente, su richiesta del Cliente stesso e fatturata sulla base di uno statino di esecuzione dei lavori.";

const DEF_FULL_IT = `${DEF_CORPO_IT}\n\n${DEF_SERVIZIO_IT}`;

const SLA_FULL_IT = [
  "L’attività di manutenzione applicativa viene offerta sulla base di uno SLA (Service Level Agreement) di intervento per segnalazioni relative all’applicativo.",
  "**Lo SLA include:**",
  "a. La disponibilità di personale qualificato alla presa in carico e all’analisi dei ticket secondo le tempistiche riportate.\n" +
    "b. Il tempo effettivo impiegato nella risoluzione delle segnalazioni, fino ad un massimo di 25 ore lavorative annue.",
  "**Lo SLA esclude:**",
  "a. Segnalazioni che non vengano comunicate tramite il sistema di ticketing fornito.\n" +
    "b. Richieste che si configurassero come importanti cambiamenti rispetto ai requisiti iniziali (*Change Request*) nel sistema manutenuto (es. aggiunta di nuove funzionalità, sezioni, requisiti nuovi). Il riferimento è il perimetro funzionale (ovvero le funzionalità sviluppate a disposizione dell’utente finale) alla prima messa in produzione del sistema. In questi casi il Fornitore informa il Cliente, il quale potrà scegliere tra:\n" +
    "  a. Richiedere una stima e una quotazione separata per le attività in oggetto;\n" +
    "  b. Riconoscere i tempi di intervento preventivati per iscritto alla tariffa di 140 {currency}/ora oltre IVA.\n" +
    "c. Attività di affiancamento e handover in caso di terminazione del servizio.",
  "### Altre condizioni di SLA",
  "Lo SLA prevede la presa in carico dei ticket/segnalazioni inviati tramite sistema fornito dal Fornitore entro:",
  "a. Ticket alta priorità (guasto grave e sistema non disponibile): 1 giornata lavorativa dalla segnalazione.\n" +
    "b. Ticket normale priorità (guasti minori e sistema comunque disponibile): 3 giornate lavorative dalla segnalazione.",
  "Una giornata lavorativa include il tempo tra le ore 9.00 e le ore 18.00 CET. Le giornate lavorative sono quelle previste dal Calendario Ufficiale della Repubblica e Cantone Ticino. Lo SLA non prevede penali o tempi di risoluzione prefissati, essendo questi strettamente dipendenti dal tipo di segnalazione sollevata. Il tempo di presa in carico è tracciato da un sistema automatico fornito dal Fornitore.",
].join("\n\n");

const NO_SLA_IT = "Non sono previsti SLA per la fornitura in oggetto.";

const SUPPLY_STD_IT =
  "Le attività si svolgeranno di norma presso la sede del Fornitore e – limitatamente a quanto concerne attività di coordinamento – presso la sede indicata dal Cliente.\n\n" +
  "Le licenze di software specifici sono a carico del Cliente.\n\n" +
  "La fornitura esclude quanto non esplicitamente dichiarato.";

const SUPPLY_ONSITE_IT =
  "Le attività si svolgeranno di norma presso la sede indicata dal Cliente, se in Canton Ticino. I costi di trasferta sono inclusi nel totale di commessa.\n\n" +
  "Le licenze di software specifici o strumenti terzi sono a carico del Cliente.\n\n" +
  "La fornitura esclude quanto non esplicitamente dichiarato.";

const TRAVEL_IT =
  "### Trasferte\n\n" +
  "I costi riportati al par. 6 includono le trasferte in Canton Ticino, Svizzera. Eventuali altre trasferte, approvate per iscritto dal Cliente, saranno esposte a rimborso al Cliente unitamente ai giustificativi di spesa.";

const SUPPLY_FIXED_IT = (infrastructure: string) =>
  "La fornitura è da intendersi a corpo.\n\n" +
  `Le licenze di software specifici, da concordarsi preventivamente, sono a carico del Cliente, così come i costi dell’infrastruttura di produzione${infrastructure}.\n\n` +
  "La fornitura esclude quanto non esplicitamente dichiarato.\n\n" +
  TRAVEL_IT;

const RESOURCES_SHORT_IT =
  "Le risorse tecniche allocate dal Fornitore allo sviluppo della fornitura hanno competenze e qualifiche adeguate allo svolgimento delle attività assegnate.";

const RESOURCES_IT = `${RESOURCES_SHORT_IT} Le risorse possono variare nel corso della fornitura.`;

const WARRANTY_IT = (months: number) =>
  `${RESOURCES_IT}\n\n` +
  `Se l’oggetto prevede la realizzazione di software, questo viene rilasciato con un periodo di __${months} mesi di garanzia dalla data di primo rilascio in produzione__. La garanzia copre la risoluzione di difetti (bug) applicativi e non prevede uno specifico Service Level Agreement.\n\n` +
  "Eventuali interventi successivi alla messa in produzione e fuori dal perimetro di garanzia o da uno specifico contratto di manutenzione saranno fatturati sulla base di una tariffa a regia di 140 {currency}/ora oppure oggetto di nuova offerta.\n\n" +
  "La manutenzione è da definirsi in un contratto separato.";

const NOTE_VAT_IT = "**Note:**\n\n- I costi si intendono IVA esclusa.";

const RENEWAL_IT =
  "Tutte le voci di costo con cadenza ricorsiva (temporale) o capienza massima (ore) hanno un termine di disdetta, da ambo le Parti, di 3 (tre) mesi solari, da comunicare tramite lettera raccomandata. In caso di mancata disdetta, il rinnovo si intende per una durata/capienza come indicato al punto 6 (COSTI).";

const NO_RENEWAL_IT = "Non sono previsti rinnovi o disdette.";

const VALIDITY_IT = "La presente offerta è valida per {validityDays} giorni solari.";

const ESTIMATE_DISCLAIMER_IT =
  "Tale stima è soggetta a variazioni in corso d’opera, fermo restando che al Cliente è garantita evidenza periodica dello stato di avanzamento dei lavori.";

const GENERAL_IT = (withOwnership: boolean) =>
  [
    "In aggiunta a quanto sopra specificato, valgono le seguenti Condizioni Generali di fornitura.",
    "### Limitazione di responsabilità",
    "Il Fornitore dichiara di esercitare il controllo diretto delle risorse fornite. Le responsabilità del Fornitore e delle sue risorse sono limitate all’esecuzione della fornitura in oggetto, che viene portata avanti a regola d’arte e in conformità con le specifiche concordate con il Cliente.",
    "### Legislazione del lavoro",
    "Il personale del Fornitore opera nel pieno rispetto della legislazione del lavoro. Qualora il Cliente necessitasse di documentazione in merito, sarà cura del Fornitore presentarla.",
    "### Riservatezza e proprietà",
    "Il Fornitore si impegna a mantenere la massima riservatezza per quanto concerne l’uso di documenti, disegni e informazioni di cui verrà a conoscenza per effetto del contratto di fornitura.",
    ...(withOwnership
      ? [
          "I diritti di proprietà, inclusi i diritti di proprietà intellettuale, siano essi registrabili o meno, di tutto quello che verrà sviluppato secondo il presente contratto apparterranno al Cliente.",
        ]
      : []),
    "Il Fornitore garantisce che quanto fornito in esecuzione del presente accordo non viola diritti di proprietà intellettuale/industriale di terzi.",
    "### Privacy e trattamento dei dati personali",
    "Il Cliente e il Fornitore si fanno entrambi garanti del rispetto delle norme vigenti sulla Privacy. Il Cliente è autorizzato a comunicare a terzi i dati del Fornitore per operazioni legate alla fornitura in oggetto. All’accettazione del presente contratto, il Cliente accetta egualmente la politica sulla Privacy di {issuer}, la cui documentazione integrale viene fornita su richiesta o allegata.",
    "### Foro competente",
    "Per qualsiasi controversia che dovesse sorgere in relazione al presente contratto di fornitura, il foro competente è quello di Lugano (Svizzera).",
    "### Clausola di inefficacia",
    "Nell’eventualità in cui una qualsiasi clausola del presente contratto dovesse in seguito risultare inefficace per un qualsiasi motivo giuridico, ciò non inficerà la validità delle restanti clausole. In luogo della norma inefficace si considererà come voluta e dichiarata quella regolamentazione giuridicamente valida che maggiormente si avvicinerà al senso e allo scopo della clausola inefficace e del contratto nel suo insieme, tenendo in considerazione la buona fede, l’usanza commerciale nonché gli usi ed i costumi del settore. Eventuali lacune contrattuali saranno trattate analogamente.",
  ].join("\n\n");

/** The nine sections, in the examples' order; section 6 carries the cost table. */
function sectionsIt(parts: {
  definitionsHeading?: string;
  definitions: string;
  object: string;
  thirdHeading?: string;
  third: string;
  supply: string;
  resourcesHeading?: string;
  resources: string;
  notes: string;
  duration: string;
  billing: string;
  general: string;
}): OfferSection[] {
  return [
    { heading: parts.definitionsHeading ?? "Definizioni", body: parts.definitions, costs: false },
    { heading: "Oggetto della fornitura", body: parts.object, costs: false },
    { heading: parts.thirdHeading ?? "SLA (Service Level Agreement)", body: parts.third, costs: false },
    { heading: "Condizioni di fornitura", body: parts.supply, costs: false },
    { heading: parts.resourcesHeading ?? "Risorse", body: parts.resources, costs: false },
    { heading: "Costi", body: parts.notes, costs: true },
    { heading: "Durata, rinnovo e disdetta", body: parts.duration, costs: false },
    { heading: "Fatturazione", body: parts.billing, costs: false },
    { heading: "Condizioni generali", body: parts.general, costs: false },
  ];
}

// ─── The seven Italian templates ─────────────────────────────────────────────

export const DEFAULT_TEMPLATES_IT: readonly OfferTemplateContent[] = [
  {
    // DroneVia 0019/2026r1
    name: "Progetto a corpo",
    language: "it",
    salutation: "Spettabile",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitions: DEF_FULL_IT,
      object:
        "Oggetto della fornitura è:\n\n{epics}\n\nIl dettaglio dell’impegno è riportato nell’Allegato A, parte integrante del presente contratto.",
      third: SLA_FULL_IT,
      supply: SUPPLY_STD_IT,
      resources: RESOURCES_IT,
      notes:
        `${NOTE_VAT_IT}\n` +
        "- I domini saranno in carico al Cliente, così come i costi di infrastruttura di produzione e le licenze, e non sono inclusi nei prezzi sopra indicati.\n" +
        "- Attività a richiesta, escluse dalle voci di costo, sono fatturate sulla base di 140 {currency}/ora.",
      duration:
        `${RENEWAL_IT}\n\n` +
        "In caso di disdetta scritta del servizio da parte di una delle Parti prima dell’esaurimento del pacchetto ore, il Fornitore emetterà nota di credito per un importo pari alla rimanenza dello stesso.",
      billing:
        "La fatturazione avviene in base al seguente piano, che può subire variazioni con accordo scritto tra Fornitore e Cliente.\n\n" +
        "- Parti a corpo: 50% avvio lavori, saldo alla consegna (collaudo).\n" +
        "- Parti ricorrenti: secondo quanto indicato al par. 6 COSTI.",
      general: GENERAL_IT(true),
    }),
    costLines: [
      { description: "{deal}, a corpo, una tantum", kind: "one_off", amount: "deal", quantity: 1 },
      {
        description: "SLA dopo messa in produzione, come da par. 3, per anno solare",
        kind: "yearly",
        amount: { cents: 0 },
        quantity: 1,
      },
    ],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: null,
    annex: true,
  },
  {
    // Lugano Wealth Partners 0017/2026
    name: "Una tantum + SLA prepagato",
    language: "it",
    salutation: "Spettabile",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitions: DEF_FULL_IT,
      object:
        "Oggetto della fornitura è l’attività di presa in carico e gestione ordinaria di {deal}, ed in particolare:\n\n" +
        "1. Presa in carico e migrazione;\n" +
        "2. SLA di manutenzione ordinaria annuale (cfr. par. 3).",
      third: SLA_FULL_IT,
      supply:
        "Le attività si svolgeranno di norma presso la sede del Fornitore e – limitatamente a quanto concerne attività di coordinamento – presso la sede indicata dal Cliente.\n\n" +
        "Le licenze di software specifici sono a carico del Cliente.\n\n" +
        "La fornitura esclude quanto non esplicitamente dichiarato (es. nomi di dominio).",
      resources: RESOURCES_IT,
      notes: NOTE_VAT_IT,
      duration: RENEWAL_IT,
      billing:
        "La fatturazione avviene all’avvio del servizio sopra specificato, in soluzione unica.\n\n" +
        "Pagamenti a 30 giorni dalla data di fatturazione.",
      general: GENERAL_IT(true),
    }),
    costLines: [
      { description: "Presa in carico e migrazione, a corpo, una tantum", kind: "one_off", amount: "deal", quantity: 1 },
      { description: "SLA, come sopra indicato, annuale", kind: "yearly", amount: { cents: 0 }, quantity: 1 },
    ],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: "Il Cliente",
    annex: false,
  },
  {
    // Cornèr Banca 0011/2026
    name: "Formazione",
    language: "it",
    salutation: "Spettabile",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitionsHeading: "Definizioni, ove applicabili",
      definitions: DEF_FULL_IT,
      object:
        "Oggetto della fornitura è {deal}.\n\n" +
        "Nello specifico il programma prevede **[n] sessioni formative da [n] giornate**, per un massimo di **[n] partecipanti** designati dal Cliente.\n\n" +
        "I moduli di contenuti e i temi specifici di ognuno possono variare in accordo con il Cliente. La calendarizzazione della formazione avviene in accordo con il Cliente.",
      third: NO_SLA_IT,
      supply: SUPPLY_ONSITE_IT,
      resources: RESOURCES_SHORT_IT,
      notes: NOTE_VAT_IT,
      duration: NO_RENEWAL_IT,
      billing:
        "La fatturazione avviene in base al seguente piano, che può subire variazioni con accordo scritto tra Fornitore e Cliente.\n\n" +
        "- 50% a inizio lavori, pagamento a vista.\n" +
        "- 50% a fine lavori, 30 gg data fattura.",
      general: GENERAL_IT(false),
    }),
    costLines: [{ description: "{deal}, a corpo", kind: "one_off", amount: "deal", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // AELCO 0005/2026r1
    name: "MVP senza mantenimento",
    language: "it",
    salutation: "Spett.le",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitions: DEF_CORPO_IT,
      object: "Oggetto della fornitura è:\n\n{epics}",
      thirdHeading: "Attività e tempistiche",
      third:
        "Per la realizzazione di quanto in oggetto, il Fornitore condurrà le seguenti attività:\n\n{phases}\n\n" +
        "**Tempistiche stimate:**\n\n{timeline}\n\n" +
        ESTIMATE_DISCLAIMER_IT,
      supply: SUPPLY_FIXED_IT(""),
      resourcesHeading: "Risorse, garanzia, manutenzione",
      resources: WARRANTY_IT(3),
      notes: NOTE_VAT_IT,
      duration: VALIDITY_IT,
      billing:
        "La fatturazione avviene in base al seguente piano:\n\n" +
        "- 50% acconto inizio lavori\n" +
        "- 50% a consegna lavori\n\n" +
        "Le fatture di acconto saranno pagate **a vista fattura**, le restanti a **30 giorni data fattura**.",
      general: GENERAL_IT(true),
    }),
    costLines: [{ description: "{deal}, secondo quanto in oggetto, a corpo", kind: "one_off", amount: "deal", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // Città di Lugano 0012/2026
    name: "CR a corpo con pacchetto manutenzione",
    language: "it",
    salutation: "Spettabile",
    opening:
      `${OPENING_IT}\n\n` +
      "*Il Fornitore riconosce l’applicabilità delle condizioni generali per le prestazioni TIC emanate dalla Conferenza svizzera sull’informatica alla presente offerta.*",
    sections: sectionsIt({
      definitions:
        "**A corpo/Fixed Price:** attività svolta dal Fornitore presso la propria sede o luogo da esso gestito e fatturata sulla base del rilascio di un prodotto/servizio.\n\n" +
        "**A servizio/A regia:** attività svolta dal Fornitore presso la sede propria o del Cliente, su richiesta del Cliente stesso e fatturata a tempo sulla base di uno statino di esecuzione dei lavori.",
      object:
        "Oggetto della fornitura è l’attività di analisi e sviluppo software di {deal}.\n\n" +
        "In particolare si prevedono le seguenti attività:\n\n{epics}",
      third:
        "La presente offerta non prevede SLA. Le attività di manutenzione e supporto post-messa in produzione saranno oggetto di contratto e offerta separati.",
      supply: SUPPLY_STD_IT,
      resourcesHeading: "Risorse, garanzia, manutenzione",
      resources:
        `${RESOURCES_IT}\n\n` +
        "Il software – conformemente alle prestazioni TIC – viene rilasciato con una garanzia di 12 mesi dalla messa in produzione, a copertura di bug/defect.\n\n" +
        "Eventuali interventi fuori dal perimetro di garanzia o da uno specifico contratto di manutenzione saranno fatturati sulla base di una tariffa a regia di 140 {currency}/ora oppure oggetto di nuova offerta.",
      notes:
        `${NOTE_VAT_IT}\n` +
        "- I costi si intendono A Corpo / Fixed Price. Eventuali attività a regia – previo accordo scritto con il Cliente – saranno fatturate sulla base di una tariffa di 140 {currency}/ora.",
      duration: "Il presente accordo non prevede rinnovi o disdette.",
      billing:
        "La fatturazione avviene secondo il seguente piano: 50% all’ordine, 50% a collaudo con il Cliente.\n\n" +
        "Pagamenti a 30 giorni dalla data di fatturazione.",
      general: GENERAL_IT(true),
    }),
    costLines: [
      { description: "{deal}, a corpo", kind: "one_off", amount: "deal", quantity: 1 },
      { description: "Pacchetto di manutenzione a regia, ore", kind: "one_off", amount: { cents: 14_000 }, quantity: 1 },
    ],
    costColumns: { position: false, unit: true },
    showTotal: true,
    acceptanceLabel: "Il Cliente",
    annex: false,
  },
  {
    // Studio V 0009/2026
    name: "Fixed price a fasi",
    language: "it",
    salutation: "Spett.le",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitions:
        `${DEF_CORPO_IT}\n\n` +
        "**Fase:** macro-attività progettuale che raggruppa un insieme coerente di epiche e attività.",
      object:
        "Oggetto della fornitura è la progettazione, lo sviluppo e la messa in produzione di {deal}.\n\n" +
        "Il progetto è articolato nelle seguenti fasi:\n\n{phases}",
      thirdHeading: "Attività e tempistiche",
      third:
        "Per la realizzazione di quanto in oggetto, il Fornitore condurrà per ciascuna fase le attività descritte in oggetto.\n\n" +
        "**Tempistiche stimate:**\n\n{timeline}\n\n" +
        ESTIMATE_DISCLAIMER_IT,
      supply: SUPPLY_FIXED_IT(" (cloud hosting, domini, certificati SSL, altri servizi terzi)"),
      resourcesHeading: "Risorse, garanzia, manutenzione",
      resources: WARRANTY_IT(3),
      notes: NOTE_VAT_IT,
      duration: VALIDITY_IT,
      billing:
        "La fatturazione avviene per fase, con acconto e saldo, secondo il seguente piano:\n\n" +
        "**Per ogni fase:**\n\n" +
        "- Acconto 30% a inizio fase\n" +
        "- 40% suddiviso in tranche mensili, per i mesi previsti dalla fase\n" +
        "- Saldo 30% a completamento fase, previo collaudo\n\n" +
        "Le fatture di acconto saranno pagate a vista fattura, le restanti a 30 giorni data fattura.",
      general: GENERAL_IT(false),
    }),
    costLines: [{ description: "{release}", kind: "one_off", amount: "perRelease", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // Cornèr Banca 0010/2026
    name: "Consulenza a giornate",
    language: "it",
    salutation: "Spettabile",
    opening: OPENING_IT,
    sections: sectionsIt({
      definitionsHeading: "Definizioni, ove applicabili",
      definitions: DEF_FULL_IT,
      object:
        "Oggetto della fornitura è un monte giornate di consulenza e supporto tecnico specialistico per {deal}.\n\n" +
        "Nello specifico si prevedono **{manDays} giorni/uomo** totali, a consuntivo.\n\n" +
        "I dettagli e la calendarizzazione delle giornate avvengono in accordo con il Cliente.",
      third: NO_SLA_IT,
      supply: SUPPLY_ONSITE_IT,
      resources: RESOURCES_SHORT_IT,
      notes: NOTE_VAT_IT,
      duration: NO_RENEWAL_IT,
      billing:
        "La fatturazione avviene in base ad un consuntivo giornate, riportato su uno statino mensile allegato alla fattura.\n\n" +
        "Pagamenti a 30 gg data fattura.",
      general: GENERAL_IT(false),
    }),
    costLines: [
      {
        description: "Consulenza specialistica in giorni/uomo",
        kind: "one_off",
        amount: { cents: 120_000 },
        quantity: "manDays",
      },
    ],
    costColumns: { position: true, unit: true },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
];
