/**
 * strings.rules — the Depreciation rules screen and the New rule dialog (T37,
 * specs/20261006-hardware-inventory; design.md T4, F11, § Irreversible actions "New
 * rule", § Error and conflict catalogue; AC-6.1 to AC-6.5). Templates with
 * `{name}` placeholders in `strings.errors` go through `fillTemplate`; money is
 * formatted by the caller with `formatMoney`.
 */
const en = {
  heading: 'Depreciation rules',
  loading: 'Loading depreciation rules',
  /** The page's h3 per entity: "Rules for WellD CH". */
  sectionHeading: (entity: string) => `Rules for ${entity}`,
  sectionLoading: (entity: string) => `Loading rules for ${entity}`,
  /** The table caption, also the scroll region's label. */
  caption: (entity: string) => `Depreciation rules for ${entity}`,
  /** The launch seed makes this unreachable; kept for safety. */
  empty: (entity: string) => `No rule is configured for ${entity}.`,
  /** `GET /scope` lists no entity for `ledger:manage`. */
  noEntity: 'No entity is in your scope for depreciation rules. Ask an administrator.',
  retry: 'Retry',

  /** The button names its entity so the two are distinguishable out of context. */
  newRule: (entity: string) => `New rule for ${entity}`,
  /** The polite line after a rule is saved. */
  added: (date: string) => `Rule added. It applies to purchases from ${date}.`,

  columns: {
    effectiveFrom: 'Effective from',
    usefulLife: 'Useful life (years)',
    firstYearShare: 'First-year share',
    threshold: 'Low-value threshold',
    residual: 'Residual value',
    addedBy: 'Added by',
    addedOn: 'Added on',
    status: 'Status',
  },
  firstYearShare: { full: 'Full', half: 'Half' },
  noThreshold: 'None',

  status: {
    inForce: 'In force',
    scheduled: 'Scheduled',
    superseded: 'Superseded',
  },

  dialog: {
    title: (entity: string) => `New depreciation rule for ${entity}`,
    /** "Rule in force: life 3 y, full first year, no threshold, residual 1,00 CHF (since 01.01.2020)". */
    inForce: (summary: string, since: string) => `Rule in force: ${summary} (since ${since})`,
    inForceShare: { full: 'full first year', half: 'half first year' },
    inForceNoThreshold: 'no threshold',
    inForceThreshold: (amount: string) => `threshold ${amount}`,
    inForceSummary: (years: number, share: string, threshold: string, residual: string) =>
      `life ${years} y, ${share}, ${threshold}, residual ${residual}`,
    /** The consequence: assets purchased on or after the date are rescheduled. */
    consequence: (entity: string, date: string) =>
      `From ${date}, every ${entity} asset purchased on or after ${date}, including assets already registered, is scheduled by this rule. Assets purchased earlier keep their schedule. A saved rule cannot be edited or deleted; a correction is a new rule.`,
    dateUnset: 'the effective date',
    acknowledge: 'I understand this rule cannot be changed afterwards.',
    confirm: 'Add rule',
    confirming: 'Adding…',
    fields: {
      effectiveFrom: 'Effective from',
      usefulLife: 'Useful life (years)',
      firstYearShare: 'First-year share',
      thresholdIn: (currency: string) => `Low-value threshold, ${currency}`,
      residualIn: (currency: string) => `Residual value, ${currency}`,
    },
    errors: {
      dateRequired: 'Enter the effective date.',
      dateInvalid: 'Enter a valid effective date.',
      lifeInvalid: 'Useful life must be a whole number of at least 1 year.',
      shareRequired: 'Choose the first-year share.',
      thresholdInvalid: 'Enter a threshold of 0 or more, with at most two decimals, or leave it empty.',
      residualInvalid: 'Enter a residual value of 0 or more, with at most two decimals.',
      /** `fiscal_year_closed` when the server sent no year. */
      yearClosedNoYear: 'The effective date falls in a closed year. Choose a date in an open year.',
    },
  },
}

const it: typeof en = {
  heading: 'Regole di ammortamento',
  loading: 'Caricamento regole di ammortamento',
  sectionHeading: (entity: string) => `Regole per ${entity}`,
  sectionLoading: (entity: string) => `Caricamento regole per ${entity}`,
  caption: (entity: string) => `Regole di ammortamento per ${entity}`,
  empty: (entity: string) => `Nessuna regola configurata per ${entity}.`,
  noEntity: 'Nessuna entità di competenza per le regole di ammortamento. Rivolgersi a un amministratore.',
  retry: 'Riprova',

  newRule: (entity: string) => `Nuova regola per ${entity}`,
  added: (date: string) => `Regola aggiunta. Si applica agli acquisti dal ${date}.`,

  columns: {
    effectiveFrom: 'In vigore dal',
    usefulLife: 'Vita utile (anni)',
    firstYearShare: 'Quota primo anno',
    threshold: 'Soglia beni di modico valore',
    residual: 'Valore residuo',
    addedBy: 'Aggiunta da',
    addedOn: 'Aggiunta il',
    status: 'Stato',
  },
  firstYearShare: { full: 'Intera', half: 'Metà' },
  noThreshold: 'Nessuna',

  status: {
    inForce: 'In vigore',
    scheduled: 'Programmata',
    superseded: 'Sostituita',
  },

  dialog: {
    title: (entity: string) => `Nuova regola di ammortamento per ${entity}`,
    inForce: (summary: string, since: string) => `Regola in vigore: ${summary} (dal ${since})`,
    inForceShare: { full: 'primo anno intero', half: 'primo anno al 50%' },
    inForceNoThreshold: 'nessuna soglia',
    inForceThreshold: (amount: string) => `soglia ${amount}`,
    inForceSummary: (years: number, share: string, threshold: string, residual: string) =>
      `vita utile ${years} ${years === 1 ? 'anno' : 'anni'}, ${share}, ${threshold}, valore residuo ${residual}`,
    consequence: (entity: string, date: string) =>
      `Dal ${date}, ogni bene di ${entity} acquistato a partire dal ${date}, compresi i beni già registrati, viene ammortizzato con questa regola. I beni acquistati prima mantengono il proprio piano. Una regola salvata non può essere modificata né eliminata; una correzione richiede una nuova regola.`,
    dateUnset: 'la data di decorrenza',
    acknowledge: 'Confermo di aver compreso che questa regola non potrà essere modificata in seguito.',
    confirm: 'Aggiungi regola',
    confirming: 'Aggiunta…',
    fields: {
      effectiveFrom: 'In vigore dal',
      usefulLife: 'Vita utile (anni)',
      firstYearShare: 'Quota primo anno',
      thresholdIn: (currency: string) => `Soglia beni di modico valore, ${currency}`,
      residualIn: (currency: string) => `Valore residuo, ${currency}`,
    },
    errors: {
      dateRequired: 'Inserire la data di decorrenza.',
      dateInvalid: 'Inserire una data di decorrenza valida.',
      lifeInvalid: 'La vita utile deve essere un numero intero di almeno 1 anno.',
      shareRequired: 'Selezionare la quota del primo anno.',
      thresholdInvalid: 'Inserire una soglia pari o superiore a 0, con al massimo due decimali, oppure lasciare vuoto.',
      residualInvalid: 'Inserire un valore residuo pari o superiore a 0, con al massimo due decimali.',
      yearClosedNoYear: 'La data di decorrenza cade in un esercizio chiuso. Scegliere una data in un esercizio aperto.',
    },
  },
}

export const rules = { en, it }
