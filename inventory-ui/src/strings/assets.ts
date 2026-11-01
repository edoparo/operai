/**
 * strings.assets — the Assets list (T1) and its filter bar (T29,
 * specs/015-hardware-inventory; design.md § T1, F7 and Resolutions Q5).
 * Message values with `{name}` placeholders go through `fillTemplate`.
 */
const en = {
  heading: 'Assets',
  registerAction: 'Register asset',

  filters: {
    landmarkLabel: 'Filter assets',
    heading: 'Filters',
    search: 'Search',
    searchPlaceholder: 'Description or serial number',
    status: 'Status',
    category: 'Category',
    entity: 'Entity',
    holder: 'Holder',
    toVerify: 'To verify',
    invoiceRef: 'Invoice reference',
    /** The "no selection" option of every select. */
    any: 'Any',
    holderAny: 'Any holder',
    /** A `holderUserId` in the URL that the directory does not list (e.g. a deleted account). */
    holderUnknown: 'Unknown user',
    holderLoading: 'Loading users…',
    clear: 'Clear filters',
  },

  /** Polite line after each change: "Showing 24 assets - more available". */
  shown: (count: number, hasMore: boolean) =>
    `Showing ${count} ${count === 1 ? 'asset' : 'assets'}${hasMore ? ' - more available' : ''}`,
  /** Caption of the table; the page appends the active filters. */
  caption: 'Assets',
  captionFilters: (summary: string) => `Assets, filtered by ${summary}`,
  captionFilterItem: (label: string, value: string) => `${label} ${value}`,
  captionToVerify: 'to verify',
  regionLabel: 'Assets table',

  columns: {
    description: 'Description',
    entity: 'Entity',
    status: 'Status',
    holder: 'Held by',
    purchased: 'Purchased',
    price: 'Price',
    bookValue: 'Book value',
  },
  invoiceRefPrefix: 'invoice',
  toVerifyChip: 'To verify',
  awaitingConfirmation: 'Awaiting confirmation',
  noHolder: '—',
  holderDeleted: 'Deleted account',
  holderUnknown: 'Unknown',
  holderSystem: 'System',
  noBookValue: '—',

  loading: 'Loading assets',
  loadMore: 'Load more',
  loadingMore: 'Loading more…',
  moreLoaded: (count: number) => `${count} more ${count === 1 ? 'asset' : 'assets'} loaded`,

  empty: {
    manager: 'No assets yet.',
    accountant: 'No assets in your scope yet.',
    scopeNote: 'Assets of an entity you are not scoped to are not shown.',
    filtered: 'No assets match these filters.',
    nothingToVerify: 'Nothing left to verify.',
  },

  /** Status line after a registration (state carried from the register page). */
  registered: (count: number) => `${count} ${count === 1 ? 'asset' : 'assets'} registered.`,
}

const it: typeof en = {
  heading: 'Beni',
  registerAction: 'Registra bene',

  filters: {
    landmarkLabel: 'Filtra beni',
    heading: 'Filtri',
    search: 'Cerca',
    searchPlaceholder: 'Descrizione o numero di serie',
    status: 'Stato',
    category: 'Categoria',
    entity: 'Entità',
    holder: 'Assegnatario',
    toVerify: 'Da verificare',
    invoiceRef: 'Riferimento fattura',
    any: 'Tutti',
    holderAny: 'Tutti gli assegnatari',
    holderUnknown: 'Utente sconosciuto',
    holderLoading: 'Caricamento utenti…',
    clear: 'Azzera filtri',
  },

  shown: (count: number, hasMore: boolean) =>
    `${count === 1 ? 'Visualizzato 1 bene' : `Visualizzati ${count} beni`}${hasMore ? ' - altri disponibili' : ''}`,
  caption: 'Beni',
  captionFilters: (summary: string) => `Beni, filtrati per ${summary}`,
  captionFilterItem: (label: string, value: string) => `${label} ${value}`,
  captionToVerify: 'da verificare',
  regionLabel: 'Tabella dei beni',

  columns: {
    description: 'Descrizione',
    entity: 'Entità',
    status: 'Stato',
    holder: 'Assegnatario',
    purchased: 'Acquistato',
    price: 'Prezzo',
    bookValue: 'Valore contabile',
  },
  invoiceRefPrefix: 'fattura',
  toVerifyChip: 'Da verificare',
  awaitingConfirmation: 'In attesa di conferma',
  noHolder: '—',
  holderDeleted: 'Account eliminato',
  holderUnknown: 'Sconosciuto',
  holderSystem: 'Sistema',
  noBookValue: '—',

  loading: 'Caricamento beni',
  loadMore: 'Carica altri',
  loadingMore: 'Caricamento…',
  moreLoaded: (count: number) => (count === 1 ? 'Caricato 1 altro bene' : `Caricati altri ${count} beni`),

  empty: {
    manager: 'Nessun bene registrato.',
    accountant: 'Nessun bene di propria competenza.',
    scopeNote: 'I beni delle entità non di propria competenza non sono visualizzati.',
    filtered: 'Nessun bene corrisponde ai filtri.',
    nothingToVerify: 'Nessun bene da verificare.',
  },

  registered: (count: number) => (count === 1 ? '1 bene registrato.' : `${count} beni registrati.`),
}

export const assets = { en, it }
