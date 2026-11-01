/** strings.rates — the refund configuration screen: mileage rates and the accounting distribution email. */
export const en = {
  heading: 'Mileage rates',
  description:
    'Two entirely independent per-km rate series, one per entity. A new entry never edits or removes a past one — history accumulates, and an already-submitted claim keeps the rate that applied to it forever.',
  loading: 'Loading mileage rates…',
  loadError: 'Could not load the mileage rates.',
  forbidden: "You don't have permission to view mileage rates.",
  /**
   * A rate already formatted as a number, with its currency per km — in the
   * order `formatMoney` uses for the language (en "CHF 0.81/km", it "0,81 CHF/km"),
   * so it reads like Rimborsi's figures.
   */
  perKm: (rate: string, currency: string) => `${currency} ${rate}/km`,
  caption: (entity: string) => `${entity} mileage rates`,
  columns: {
    rate: 'Rate',
    validFrom: 'Valid from',
    addedBy: 'Added by',
    addedOn: 'Added on',
    status: 'Status',
  },
  addRateEntry: 'Add rate entry',
  added: (entity: string) => `Rate entry added for ${entity}`,
  addFailed: 'Could not add this rate entry. Try again.',
  empty: {
    title: 'No rate yet',
    body: (entity: string) => `No rate configured yet for ${entity}.`,
  },
  rateError: 'Enter a rate greater than 0.',
  validFromError: 'Enter a valid date.',
  addDialog: {
    title: (entity: string) => `Add rate entry — ${entity}`,
    description: 'This entry cannot be edited or deleted once saved — a correction is always a new entry.',
    busy: 'Adding…',
    rate: 'Rate per km',
    validFrom: 'Valid from',
    validFromHint: 'Past, present, or future dates are all accepted.',
  },
  settings: {
    title: 'Accounting distribution email',
    description: 'The email address that receives each monthly refund batch. Leave it blank to pause sending.',
    loading: 'Loading the accounting distribution email…',
    loadError: 'Could not load the accounting distribution email.',
    saved: 'Accounting distribution email saved',
    cleared: 'Accounting distribution email cleared',
    currentValue: 'Current value',
    notConfigured: 'Not configured',
    emailAddress: 'Email address',
    placeholder: 'accounting@welld.ch',
    historyTitle: 'Change history',
    historyEmpty: 'No changes recorded yet.',
    historyItem: (value: string, by: string, at: string) => `${value} — ${by} — ${at}`,
  },
}

export const it: typeof en = {
  heading: 'Tariffe chilometriche',
  description:
    'Due serie di tariffe al km del tutto indipendenti, una per società. Una nuova voce non modifica né rimuove mai quelle passate: lo storico si accumula e una richiesta già inviata conserva per sempre la tariffa che le è stata applicata.',
  loading: 'Caricamento delle tariffe chilometriche…',
  loadError: 'Impossibile caricare le tariffe chilometriche.',
  forbidden: 'Non si dispone dei permessi per vedere le tariffe chilometriche.',
  perKm: (rate: string, currency: string) => `${rate} ${currency}/km`,
  caption: (entity: string) => `Tariffe chilometriche ${entity}`,
  columns: {
    rate: 'Tariffa',
    validFrom: 'Valida dal',
    addedBy: 'Aggiunta da',
    addedOn: 'Aggiunta il',
    status: 'Stato',
  },
  addRateEntry: 'Aggiungi tariffa',
  added: (entity: string) => `Tariffa aggiunta per ${entity}`,
  addFailed: 'Impossibile aggiungere questa tariffa. Riprovare.',
  empty: {
    title: 'Ancora nessuna tariffa',
    body: (entity: string) => `Nessuna tariffa ancora configurata per ${entity}.`,
  },
  rateError: 'Inserire una tariffa maggiore di 0.',
  validFromError: 'Inserire una data valida.',
  addDialog: {
    title: (entity: string) => `Aggiungi tariffa — ${entity}`,
    description:
      'Una volta salvata, questa voce non può essere modificata né eliminata: una correzione è sempre una nuova voce.',
    busy: 'Aggiunta…',
    rate: 'Tariffa al km',
    validFrom: 'Valida dal',
    validFromHint: 'Sono accettate date passate, presenti o future.',
  },
  settings: {
    title: 'Email di distribuzione contabilità',
    description: 'L’indirizzo email che riceve ogni lotto mensile di rimborsi. Lasciarlo vuoto per sospendere l’invio.',
    loading: 'Caricamento dell’email di distribuzione contabilità…',
    loadError: 'Impossibile caricare l’email di distribuzione contabilità.',
    saved: 'Email di distribuzione contabilità salvata',
    cleared: 'Email di distribuzione contabilità cancellata',
    currentValue: 'Valore attuale',
    notConfigured: 'Non configurata',
    emailAddress: 'Indirizzo email',
    placeholder: 'contabilita@welld.ch',
    historyTitle: 'Cronologia delle modifiche',
    historyEmpty: 'Ancora nessuna modifica registrata.',
    historyItem: (value: string, by: string, at: string) => `${value} — ${by} — ${at}`,
  },
}
