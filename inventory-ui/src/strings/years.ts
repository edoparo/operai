/**
 * strings.years — the Fiscal years list screen, `/years` (T38, specs/20261006-hardware-
 * inventory; design.md T5, F12; AC-8.1). The year detail, the roll-forward
 * statement and the Close year dialog keep their copy in `yearDetail.ts`.
 */
const en = {
  heading: 'Fiscal years',
  loading: 'Loading fiscal years',
  /** The page's h3 per entity: "Fiscal years for WellD CH". */
  sectionHeading: (entity: string) => `Fiscal years for ${entity}`,
  sectionLoading: (entity: string) => `Loading fiscal years for ${entity}`,
  /** The table caption, also the scroll region's label. */
  caption: (entity: string) => `Fiscal years for ${entity}, newest first`,
  empty: (entity: string) => `No fiscal years yet. A year appears once ${entity} has assets.`,
  /** `GET /scope` lists no entity for `ledger:manage`. */
  noEntity: 'No entity is in your scope for fiscal years. Ask an administrator.',
  retry: 'Retry',

  columns: {
    year: 'Year',
    status: 'Status',
    closedOn: 'Closed on',
    open: 'Details',
  },
  status: { open: 'Open', closed: 'Closed' },
  notClosed: '—',
  /** The row's link: visible text "Open", named with the year and entity out of context. */
  openLink: 'Open',
  openLinkLabel: (year: number, entity: string) => `Open fiscal year ${year} for ${entity}`,
}

const it: typeof en = {
  heading: 'Esercizi',
  loading: 'Caricamento esercizi',
  sectionHeading: (entity: string) => `Esercizi per ${entity}`,
  sectionLoading: (entity: string) => `Caricamento esercizi per ${entity}`,
  caption: (entity: string) => `Esercizi per ${entity}, dal più recente`,
  empty: (entity: string) => `Nessun esercizio. Un esercizio compare quando ${entity} ha dei beni.`,
  noEntity: 'Nessuna entità di competenza per gli esercizi. Rivolgersi a un amministratore.',
  retry: 'Riprova',

  columns: {
    year: 'Esercizio',
    status: 'Stato',
    closedOn: 'Chiuso il',
    open: 'Dettagli',
  },
  status: { open: 'Aperto', closed: 'Chiuso' },
  notClosed: '—',
  openLink: 'Apri',
  openLinkLabel: (year: number, entity: string) => `Apri l'esercizio ${year} per ${entity}`,
}

export const years = { en, it }
