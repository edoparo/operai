/** The Settings tab: letterhead and standard terms per entity (specs/20261101-crm-sales-flow O2). */
const en = {
  heading: 'Settings',
  description: 'The letterhead and standard terms printed on offers, one profile per wellD entity you manage deals for.',
  loading: 'Loading the settings…',
  emptyTitle: 'No entity to set up',
  emptyBody: 'You do not manage deals for any entity.',
  profile: (entity: string) => `${entity} profile`,
  notSet: 'Not set up yet. Offers for this entity cannot be generated until it is.',
  fields: {
    legalName: 'Legal name',
    address: 'Address',
    addressHint: 'One line per row, up to 5 lines.',
    vat: 'VAT number',
    iban: 'IBAN',
    termsEn: 'Standard terms (English)',
    termsIt: 'Standard terms (Italian)',
    termsHint: 'Printed when an offer is generated without its own terms.',
    placeOfIssue: 'Place of issue',
    placeOfIssueHint: 'Printed beside the date of an offer. Leave empty for the default, Lugano.',
  },
  addressTooMany: 'Use at most 5 address lines.',
  addressLineTooLong: 'Each address line is at most 200 characters.',
  save: 'Save profile',
  saving: 'Saving…',
  saved: (entity: string) => `${entity} profile saved.`,
  updated: (date: string) => `Last saved ${date}`,
  numbering: {
    title: (entity: string) => `${entity} offer numbering`,
    loading: 'Loading the numbering…',
    year: 'Year',
    next: 'Next offer number',
    nextHint: (example: string, lowest: number) =>
      lowest > 1
        ? `The next new offer is numbered ${example}. Offers already use the numbers below ${lowest}, so it cannot go lower.`
        : `The next new offer is numbered ${example}. Set it to continue from the document system.`,
    invalid: 'Enter a whole number from 1 to 9999.',
    used: (lowest: number) => `An offer already uses that number. Use ${lowest} or more.`,
    unsaved: (saved: string, typed: string) =>
      `Not saved yet. Until you save, the next new offer is still ${saved}; after saving it will be ${typed}.`,
    save: 'Save numbering',
    saved: (entity: string, example: string) => `${entity}: the next new offer is ${example}.`,
  },
}

const it: typeof en = {
  heading: 'Impostazioni',
  description: "L'intestazione e le condizioni standard stampate sulle offerte, un profilo per ogni società wellD di cui gestisci le opportunità.",
  loading: 'Caricamento delle impostazioni…',
  emptyTitle: 'Nessuna società da configurare',
  emptyBody: 'Non gestisci opportunità per nessuna società.',
  profile: (entity: string) => `Profilo ${entity}`,
  notSet: 'Non ancora configurato. Finché non lo è, non si possono generare offerte per questa società.',
  fields: {
    legalName: 'Ragione sociale',
    address: 'Indirizzo',
    addressHint: 'Una riga per volta, al massimo 5 righe.',
    vat: 'Partita IVA',
    iban: 'IBAN',
    termsEn: 'Condizioni standard (inglese)',
    termsIt: 'Condizioni standard (italiano)',
    termsHint: "Stampate quando un'offerta viene generata senza condizioni proprie.",
    placeOfIssue: 'Luogo di emissione',
    placeOfIssueHint: "Stampato accanto alla data dell'offerta. Lascia vuoto per il valore predefinito, Lugano.",
  },
  addressTooMany: 'Usa al massimo 5 righe di indirizzo.',
  addressLineTooLong: 'Ogni riga di indirizzo può avere al massimo 200 caratteri.',
  save: 'Salva profilo',
  saving: 'Salvataggio…',
  saved: (entity: string) => `Profilo ${entity} salvato.`,
  updated: (date: string) => `Ultimo salvataggio ${date}`,
  numbering: {
    title: (entity: string) => `Numerazione offerte ${entity}`,
    loading: 'Caricamento della numerazione…',
    year: 'Anno',
    next: 'Prossimo numero di offerta',
    nextHint: (example: string, lowest: number) =>
      lowest > 1
        ? `La prossima nuova offerta avrà il numero ${example}. Le offerte usano già i numeri sotto ${lowest}, quindi non si può scendere oltre.`
        : `La prossima nuova offerta avrà il numero ${example}. Impostalo per continuare dal sistema documentale.`,
    invalid: 'Inserisci un numero intero da 1 a 9999.',
    used: (lowest: number) => `Un'offerta usa già quel numero. Usa ${lowest} o più.`,
    unsaved: (saved: string, typed: string) =>
      `Non ancora salvato. Finché non salvi, la prossima nuova offerta resta ${saved}; dopo il salvataggio sarà ${typed}.`,
    save: 'Salva numerazione',
    saved: (entity: string, example: string) => `${entity}: la prossima nuova offerta sarà ${example}.`,
  },
}

export const settings = { en, it }
