/**
 * strings.assetDetail — the Asset detail page (T2; T32, specs/015-hardware-
 * inventory; design.md § T2, F6, § Error and conflict catalogue) and its edit
 * dialog. Region copy belongs to the region's own namespace (`actions`,
 * `ledger`, `invoice`, `history`). Templates with `{name}` placeholders go
 * through `fillTemplate`.
 */
const en = {
  loading: 'Loading asset',
  none: '—',
  /** Polite line after registering; the register page navigates here with `{ registeredCount: 1 }`. */
  registered: 'Asset registered.',
  saved: 'Details saved.',
  verified: 'Marked as verified.',

  backToAssets: 'Back to assets',
  notFound: {
    heading: 'Asset not found',
    body: 'This asset does not exist, or it is outside your entity scope.',
    back: 'Back to assets',
  },

  disposed: {
    banner: (date: string) => `Disposed on ${date}. This asset can no longer be changed.`,
    reason: (reason: string) => `Reason: ${reason}`,
  },

  /** An in-place reload failed: the asset stays on screen, possibly stale. */
  refreshFailed: 'Could not refresh this page. The details below may be out of date.',

  /** Title of the guardrail shown when a save meets a conflict (the message is the error catalogue's). */
  conflictTitle: 'This asset changed',

  facts: {
    heading: 'Details',
    entity: 'Entity',
    currency: 'Currency',
    category: 'Category',
    serial: 'Serial number',
    purchaseDate: 'Purchase date',
    purchasePrice: 'Purchase price',
    holder: 'Held by',
    location: 'Location / note',
    supplier: 'Supplier',
  },

  toVerify: {
    chip: 'To verify',
    hint: 'This asset was imported with details that need checking.',
    action: 'Mark as verified',
    acting: 'Marking…',
    failed: 'Could not mark the asset as verified. Try again.',
  },

  editAction: 'Edit details',
  editInvoiceAction: 'Edit invoice details',

  edit: {
    title: 'Edit asset',
    titleInvoice: 'Edit invoice details',
    submit: 'Save changes',
    submitting: 'Saving…',
    required: 'This field is required.',
    entityNote: 'Entity and currency cannot be changed.',
    fields: {
      category: 'Category',
      description: 'Description',
      serial: 'Serial number',
      purchaseDate: 'Purchase date',
      /** The currency is part of the label: "Purchase price, CHF". */
      purchasePriceIn: (currency: string) => `Purchase price, ${currency}`,
      supplier: 'Supplier',
      invoiceRef: 'Invoice reference',
      location: 'Location / note',
    },
    priceInvalid: 'Enter a price greater than 0, with at most two decimals.',
    dateInvalid: 'Enter the purchase date.',
    unlinkWarning: (fileName: string) =>
      `Saving a different invoice reference unlinks the invoice file ${fileName} from this asset.`,
    /** `fiscal_year_closed` when the server sent no year. */
    yearClosedEditNoYear: 'Price and purchase date cannot change because their year is closed.',
    conflictLink: 'View the asset that uses it',
    forbidden: 'You are not allowed to change these details.',
  },
}

const it: typeof en = {
  loading: 'Caricamento bene',
  none: '—',
  registered: 'Bene registrato.',
  saved: 'Dettagli salvati.',
  verified: 'Segnato come verificato.',

  backToAssets: 'Torna ai beni',
  notFound: {
    heading: 'Bene non trovato',
    body: 'Questo bene non esiste oppure non rientra nelle entità di propria competenza.',
    back: 'Torna ai beni',
  },

  disposed: {
    banner: (date: string) => `Dismesso il ${date}. Questo bene non può più essere modificato.`,
    reason: (reason: string) => `Motivo: ${reason}`,
  },

  refreshFailed: 'Impossibile aggiornare la pagina. I dettagli riportati potrebbero non essere aggiornati.',

  conflictTitle: 'Questo bene è cambiato',

  facts: {
    heading: 'Dettagli',
    entity: 'Entità',
    currency: 'Valuta',
    category: 'Categoria',
    serial: 'Numero di serie',
    purchaseDate: 'Data di acquisto',
    purchasePrice: 'Prezzo di acquisto',
    holder: 'Assegnatario',
    location: 'Ubicazione / nota',
    supplier: 'Fornitore',
  },

  toVerify: {
    chip: 'Da verificare',
    hint: 'Questo bene è stato importato con dettagli da controllare.',
    action: 'Segna come verificato',
    acting: 'Aggiornamento…',
    failed: 'Impossibile segnare il bene come verificato. Riprovare.',
  },

  editAction: 'Modifica dettagli',
  editInvoiceAction: 'Modifica dati fattura',

  edit: {
    title: 'Modifica bene',
    titleInvoice: 'Modifica dati fattura',
    submit: 'Salva modifiche',
    submitting: 'Salvataggio…',
    required: 'Campo obbligatorio.',
    entityNote: 'Entità e valuta non possono essere modificate.',
    fields: {
      category: 'Categoria',
      description: 'Descrizione',
      serial: 'Numero di serie',
      purchaseDate: 'Data di acquisto',
      purchasePriceIn: (currency: string) => `Prezzo di acquisto, ${currency}`,
      supplier: 'Fornitore',
      invoiceRef: 'Riferimento fattura',
      location: 'Ubicazione / nota',
    },
    priceInvalid: 'Inserire un prezzo maggiore di 0, con al massimo due decimali.',
    dateInvalid: 'Inserire la data di acquisto.',
    unlinkWarning: (fileName: string) =>
      `Salvando un riferimento fattura diverso, il file della fattura ${fileName} viene scollegato da questo bene.`,
    yearClosedEditNoYear:
      'Prezzo e data di acquisto non possono essere modificati perché il relativo esercizio è chiuso.',
    conflictLink: 'Visualizza il bene che lo utilizza',
    forbidden: 'Non si dispone dei permessi per modificare questi dettagli.',
  },
}

export const assetDetail = { en, it }
