/**
 * strings.address — the employee address section of the user detail (specs/012),
 * folded in from the former `lib/addressCopy.ts` (INC-24/25): the language is
 * now resolved once by the library, never by this app.
 *
 * Country names are not copy: `Intl.DisplayNames` produces them at runtime
 * (`lib/countries.ts`).
 */
export const en = {
  sectionTitle: 'Address',
  currentLabel: (formatted: string) => `Current address: ${formatted}`,
  none: 'No address on file',
  field: {
    street: 'Street',
    houseNumber: 'House/building number',
    postalCode: 'Postal code',
    city: 'City',
    region: 'Region / canton / state',
    country: 'Country',
    requiredError: 'This field is required.',
  },
  save: 'Save address',
  saving: 'Saving…',
  saved: 'Address saved.',
  cleared: 'Address cleared.',
  saveError: "Couldn't save this address. Try again.",
  loadError: 'Could not load this address.',
  clear: 'Clear address',
  clearPending: 'Address will be cleared when you save.',
  clearUndo: 'Undo',
  suggest: {
    searching: 'Searching…',
    noResults: 'No matching suggestions — you can still enter the address by hand below.',
    resultCount: (n: number) => `${n} suggestions available`,
    noResultsAnnounce: 'No matching suggestions',
  },
  country: {
    placeholder: 'Search for a country…',
    noMatch: 'No matching country',
    resultCount: (n: number) => `${n} countries match`,
  },
  coords: {
    captured: 'Location coordinates: captured from suggestion.',
    cleared: 'Location coordinates: cleared — address edited after selecting a suggestion.',
    none: 'No coordinates on file.',
  },
  history: {
    title: 'Address history',
    empty: 'No address changes recorded yet.',
    changedBy: 'Changed by',
    changedOn: 'Changed on',
    previous: 'Previous',
    new: 'New',
    deletedUser: 'Deleted user',
  },
  loading: 'Loading address…',
  retry: 'Retry',
  /**
   * Google's required attribution when predictions render without a map
   * (Places API terms): the trademark text is never translated, so both
   * catalogs carry it verbatim.
   */
  googleAttribution: 'Powered by Google',
}

export const it: typeof en = {
  sectionTitle: 'Indirizzo',
  currentLabel: (formatted: string) => `Indirizzo attuale: ${formatted}`,
  none: 'Nessun indirizzo registrato',
  field: {
    street: 'Via',
    houseNumber: 'Numero civico',
    postalCode: 'CAP',
    city: 'Città',
    region: 'Regione / cantone / stato',
    country: 'Paese',
    requiredError: 'Questo campo è obbligatorio.',
  },
  save: 'Salva indirizzo',
  saving: 'Salvataggio…',
  saved: 'Indirizzo salvato.',
  cleared: 'Indirizzo cancellato.',
  saveError: 'Impossibile salvare l’indirizzo. Riprovare.',
  loadError: 'Impossibile caricare l’indirizzo.',
  clear: 'Cancella indirizzo',
  clearPending: 'L’indirizzo sarà cancellato al salvataggio.',
  clearUndo: 'Annulla',
  suggest: {
    searching: 'Ricerca in corso…',
    noResults: 'Nessun suggerimento trovato: è comunque possibile inserire l’indirizzo manualmente qui sotto.',
    resultCount: (n: number) => `${n} suggerimenti disponibili`,
    noResultsAnnounce: 'Nessun suggerimento trovato',
  },
  country: {
    placeholder: 'Cerca un paese…',
    noMatch: 'Nessun paese corrispondente',
    resultCount: (n: number) => `${n} paesi corrispondenti`,
  },
  coords: {
    captured: 'Coordinate geografiche: acquisite dal suggerimento.',
    cleared: 'Coordinate geografiche: rimosse, indirizzo modificato dopo la selezione di un suggerimento.',
    none: 'Nessuna coordinata geografica registrata.',
  },
  history: {
    title: 'Cronologia indirizzo',
    empty: 'Nessuna modifica all’indirizzo registrata finora.',
    changedBy: 'Modificato da',
    changedOn: 'Modificato il',
    previous: 'Precedente',
    new: 'Nuovo',
    deletedUser: 'Utente eliminato',
  },
  loading: 'Caricamento indirizzo…',
  retry: 'Riprova',
  googleAttribution: 'Powered by Google',
}
