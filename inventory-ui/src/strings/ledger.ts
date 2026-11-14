/**
 * strings.ledger — the Ledger block of the asset detail page, its schedule table
 * and the Dispose dialog (T34, specs/20261006-hardware-inventory; design.md § T2
 * ledger region, F9, F10, § Irreversible actions, § Error and conflict
 * catalogue). Templates with `{name}` placeholders go through `fillTemplate`;
 * money is always formatted by the caller with `formatMoney`.
 */
const en = {
  heading: 'Ledger',

  bookValue: 'Book value today',
  /** "In force from 01.01.2026". */
  ruleEffective: (date: string) => `In force from ${date}`,
  /** "Rule applied: life 3 y, full first year, no threshold, residual 1,00 CHF". */
  ruleApplied: (years: number, share: string, threshold: string, residual: string) =>
    `Rule applied: life ${years} y, ${share}, ${threshold}, residual ${residual}`,
  firstYearShare: { full: 'full first year', half: 'half first year' },
  noThreshold: 'no threshold',
  threshold: (amount: string) => `threshold ${amount}`,

  schedule: {
    caption: 'Depreciation schedule',
    regionLabel: 'Depreciation schedule table',
    columns: {
      year: 'Year',
      depreciation: 'Depreciation',
      bookValue: 'Book value at year end',
      state: 'State',
    },
    closed: 'Closed',
    open: 'Open',
    /** The last row of a disposed asset: "Disposed 01.10.2026". */
    disposedRow: (date: string) => `Disposed ${date}`,
    disposedState: 'Disposed',
    noDepreciation: '—',
  },

  disposal: {
    heading: 'Disposal',
    date: 'Disposed on',
    reason: 'Reason',
    salePrice: 'Sale price',
  },

  dispose: {
    action: 'Dispose...',
    /** Why Dispose is not available; `aria-describedby` target. */
    pendingReason: (name: string) =>
      `Cancel the pending assignment to ${name} first. Only an inventory manager can do that.`,
    /** Who the reason names when the assignee has no display name. */
    assigneeFallback: 'the selected person',
    done: 'Asset disposed.',
    conflictTitle: 'This asset changed',

    dialog: {
      title: (description: string) => `Dispose of ${description}?`,
      /** The consequence, without the holder sentence. */
      consequence: (description: string, entity: string, date: string, bookValue: string) =>
        `${description} comes off ${entity}'s books on ${date}. Its book value becomes ${bookValue}, and it can no longer be assigned, repaired or edited. This cannot be undone.`,
      /** The consequence when the asset has a holder. */
      consequenceWithHolder: (description: string, entity: string, date: string, bookValue: string, holder: string) =>
        `${description} comes off ${entity}'s books on ${date}. Its book value becomes ${bookValue}, it is removed from ${holder}, and it can no longer be assigned, repaired or edited. This cannot be undone.`,
      /** The date is not chosen yet (or invalid): the consequence names no date. */
      dateUnset: 'the chosen date',
      acknowledge: 'I understand this cannot be undone.',
      confirm: 'Dispose asset',
      confirming: 'Disposing…',
      fields: {
        date: 'Disposal date',
        reason: 'Reason',
        /** The currency is part of the label: "Sale price, CHF". */
        salePriceIn: (currency: string) => `Sale price, ${currency}`,
      },
      errors: {
        dateRequired: 'Enter the disposal date.',
        reasonRequired: 'Choose a reason.',
        salePriceInvalid: 'Enter a price of 0 or more, with at most two decimals.',
        /** `fiscal_year_closed` when the server sent no year. */
        yearClosedNoYear: 'The disposal date falls in a closed year. Choose a date in an open year.',
      },
    },
  },
}

const it: typeof en = {
  heading: 'Registro cespiti',

  bookValue: 'Valore contabile attuale',
  ruleEffective: (date: string) => `In vigore dal ${date}`,
  ruleApplied: (years: number, share: string, threshold: string, residual: string) =>
    `Regola applicata: vita utile ${years} ${years === 1 ? 'anno' : 'anni'}, ${share}, ${threshold}, valore residuo ${residual}`,
  firstYearShare: { full: 'primo anno intero', half: 'primo anno al 50%' },
  noThreshold: 'nessuna soglia',
  threshold: (amount: string) => `soglia ${amount}`,

  schedule: {
    caption: 'Piano di ammortamento',
    regionLabel: 'Tabella del piano di ammortamento',
    columns: {
      year: 'Esercizio',
      depreciation: 'Ammortamento',
      bookValue: 'Valore contabile a fine esercizio',
      state: 'Stato',
    },
    closed: 'Chiuso',
    open: 'Aperto',
    disposedRow: (date: string) => `Dismesso il ${date}`,
    disposedState: 'Dismesso',
    noDepreciation: '—',
  },

  disposal: {
    heading: 'Dismissione',
    date: 'Dismesso il',
    reason: 'Motivo',
    salePrice: 'Prezzo di vendita',
  },

  dispose: {
    action: 'Dismetti...',
    pendingReason: (name: string) =>
      `Annullare prima l'assegnazione in attesa a ${name}. Solo un responsabile dell'inventario può farlo.`,
    assigneeFallback: 'la persona selezionata',
    done: 'Bene dismesso.',
    conflictTitle: 'Questo bene è cambiato',

    dialog: {
      title: (description: string) => `Dismettere ${description}?`,
      consequence: (description: string, entity: string, date: string, bookValue: string) =>
        `${description} esce dal registro cespiti di ${entity} il ${date}. Il suo valore contabile diventa ${bookValue} e non potrà più essere assegnato, riparato o modificato. L'operazione non può essere annullata.`,
      consequenceWithHolder: (description: string, entity: string, date: string, bookValue: string, holder: string) =>
        `${description} esce dal registro cespiti di ${entity} il ${date}. Il suo valore contabile diventa ${bookValue}, viene tolto a ${holder} e non potrà più essere assegnato, riparato o modificato. L'operazione non può essere annullata.`,
      dateUnset: 'la data scelta',
      acknowledge: "Confermo di aver compreso che l'operazione non può essere annullata.",
      confirm: 'Dismetti bene',
      confirming: 'Dismissione…',
      fields: {
        date: 'Data di dismissione',
        reason: 'Motivo',
        salePriceIn: (currency: string) => `Prezzo di vendita, ${currency}`,
      },
      errors: {
        dateRequired: 'Inserire la data di dismissione.',
        reasonRequired: 'Selezionare un motivo.',
        salePriceInvalid: 'Inserire un prezzo pari o superiore a 0, con al massimo due decimali.',
        yearClosedNoYear:
          'La data di dismissione cade in un esercizio chiuso. Scegliere una data in un esercizio aperto.',
      },
    },
  },
}

export const ledger = { en, it }
