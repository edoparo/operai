/**
 * strings.register — the Register asset page (T3; T30, specs/015-hardware-
 * inventory; design.md § T3, F1, § Error and conflict catalogue). Messages with
 * `{name}` placeholders go through `fillTemplate`; the API-code messages live in
 * `strings.errors`.
 */
const en = {
  heading: 'Register asset',

  fields: {
    entity: 'Entity',
    entityPlaceholder: 'Select an entity',
    category: 'Category',
    categoryPlaceholder: 'Select a category',
    description: 'Description',
    purchaseDate: 'Purchase date',
    totalPrice: 'Total price',
    /** The currency is part of the label: "Total price, CHF". */
    totalPriceIn: (currency: string) => `Total price, ${currency}`,
    quantity: 'Quantity',
    quantityHint: '1 to 200. Each unit becomes its own asset.',
    serial: 'Serial number',
    serials: 'Serial numbers',
    serialsHint: (quantity: number) => `One per line: leave empty, or enter exactly ${quantity}.`,
    notReceived: 'Not yet received',
    notReceivedHint: 'Registers the assets as ordered; mark them received when they arrive.',
    supplier: 'Supplier',
    invoiceRef: 'Invoice reference',
    locationNote: 'Location / note',
  },

  /** Live line under Quantity when N > 1: "13 assets, 226,64 CHF each, last one 226,67 CHF". */
  breakdown: (quantity: number, each: string, last: string | null) =>
    last === null ? `${quantity} assets, ${each} each` : `${quantity} assets, ${each} each, last one ${last}`,

  validation: {
    summaryHeading: 'Check these fields before registering',
    jump: (label: string, message: string) => `${label}: ${message}`,
    required: 'This field is required.',
    entityRequired: 'Select an entity.',
    categoryRequired: 'Select a category.',
    dateInvalid: 'Enter the purchase date.',
    priceInvalid: 'Enter a price greater than 0, with at most two decimals.',
    quantityInvalid: 'Enter a whole number from 1 to 200.',
    serialCount: (quantity: number) =>
      `Enter one serial number for each of the ${quantity} assets, or leave the serial numbers empty.`,
    serialDuplicate: 'Each serial number can be used once only.',
    /** `fiscal_year_closed` when the server sent no year. */
    yearClosedNoYear: 'The purchase date falls in a closed year. Choose a date in an open year.',
    conflictLink: 'View the asset that uses it',
    /** `serial_conflict` when the server sent no serial number. */
    serialConflictNoSerial: 'A serial number is already used by an active asset of this entity.',
  },

  entityReadOnly: 'Your account can register assets for this entity only.',
  noEntity: 'No entity is in your scope for registering assets. Ask an administrator.',
  loadingScope: 'Loading your entities…',

  submit: 'Register asset',
  submitMany: (quantity: number) => `Register ${quantity} assets`,
  submitting: 'Registering…',
  cancel: 'Cancel',

  failure: {
    /** A network failure (or a gateway timeout) may have created the assets: never invite a blind retry. */
    unconfirmed: 'We could not confirm the registration. Check the asset list before trying again.',
    entityForbidden: 'You cannot register assets for this entity.',
  },
}

const it: typeof en = {
  heading: 'Registra bene',

  fields: {
    entity: 'Entità',
    entityPlaceholder: "Selezionare un'entità",
    category: 'Categoria',
    categoryPlaceholder: 'Selezionare una categoria',
    description: 'Descrizione',
    purchaseDate: 'Data di acquisto',
    totalPrice: 'Prezzo totale',
    totalPriceIn: (currency: string) => `Prezzo totale, ${currency}`,
    quantity: 'Quantità',
    quantityHint: 'Da 1 a 200. Ogni unità diventa un bene a sé.',
    serial: 'Numero di serie',
    serials: 'Numeri di serie',
    serialsHint: (quantity: number) => `Uno per riga: lasciare vuoto oppure inserirne esattamente ${quantity}.`,
    notReceived: 'Non ancora ricevuto',
    notReceivedHint: "Registra i beni come ordinati; segnarli come ricevuti all'arrivo.",
    supplier: 'Fornitore',
    invoiceRef: 'Riferimento fattura',
    locationNote: 'Ubicazione / nota',
  },

  breakdown: (quantity: number, each: string, last: string | null) =>
    last === null ? `${quantity} beni, ${each} ciascuno` : `${quantity} beni, ${each} ciascuno, l'ultimo ${last}`,

  validation: {
    summaryHeading: 'Controllare questi campi prima della registrazione',
    jump: (label: string, message: string) => `${label}: ${message}`,
    required: 'Campo obbligatorio.',
    entityRequired: "Selezionare un'entità.",
    categoryRequired: 'Selezionare una categoria.',
    dateInvalid: 'Inserire la data di acquisto.',
    priceInvalid: 'Inserire un prezzo maggiore di 0, con al massimo due decimali.',
    quantityInvalid: 'Inserire un numero intero da 1 a 200.',
    serialCount: (quantity: number) =>
      `Inserire un numero di serie per ciascuno dei ${quantity} beni, oppure lasciare vuoti i numeri di serie.`,
    serialDuplicate: 'Ogni numero di serie può essere usato una sola volta.',
    yearClosedNoYear: 'La data di acquisto cade in un esercizio chiuso. Scegliere una data in un esercizio aperto.',
    conflictLink: 'Visualizza il bene che lo utilizza',
    serialConflictNoSerial: 'Un numero di serie è già utilizzato da un bene attivo di questa entità.',
  },

  entityReadOnly: 'Questo account può registrare beni solo per questa entità.',
  noEntity: 'Nessuna entità di competenza per la registrazione di beni. Rivolgersi a un amministratore.',
  loadingScope: 'Caricamento delle entità…',

  submit: 'Registra bene',
  submitMany: (quantity: number) => `Registra ${quantity} beni`,
  submitting: 'Registrazione…',
  cancel: 'Annulla',

  failure: {
    unconfirmed: "Impossibile confermare la registrazione. Controllare l'elenco dei beni prima di riprovare.",
    entityForbidden: 'Non è possibile registrare beni per questa entità.',
  },
}

export const register = { en, it }
