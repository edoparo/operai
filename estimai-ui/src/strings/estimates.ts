/**
 * The estimates list page, its delete confirmation, the JSON file import and
 * the one-time legacy localStorage import offer.
 */
export const enList = {
  accessEditor: 'Editor',
  accessViewer: 'Viewer',
  heading: 'My estimates',
  importJson: 'Import JSON',
  newEstimate: 'New estimate',
  loadExample: 'Load example',
  open: 'Open',
  deleteTitle: 'Delete',
  deleteAction: (name: string) => `Delete "${name}"`,
  untitled: 'Untitled',
  importedName: 'Imported estimate',
  copyName: (name: string) => `${name} (copy)`,
  metaSeparator: ' · ',
  loading: 'Loading your estimates',
  loaded: (n: number) => (n === 1 ? '1 estimate loaded' : `${n} estimates loaded`),
  loadFailed: 'Could not load your estimates. Check your connection and refresh.',
  retry: 'Retry',
  createFailed: 'Could not create a new estimate. Check your connection and try again.',
  exampleFailed: 'Could not load the example estimate. Check your connection and try again.',
  deleteFailed: 'Delete failed. Try again.',
  deleted: 'Estimate deleted.',
  importFailed: 'Could not import this file. Check that it is an EstimAI JSON export.',
  importInvalidJson: 'Invalid JSON file.',
  importNotAnEstimate: 'File does not look like a valid EstimAI estimate.',
  importReadFailed: 'Failed to read imported data.',
  dismiss: 'Dismiss',
  headingAll: 'All estimates',
  filtersLabel: 'Filter estimates',
  filters: {
    whose: 'Whose estimates',
    status: 'Status',
    mine: 'Mine',
    all: 'All',
    open: 'Open',
    closed: 'Closed',
  },
  loadedContext: (scope: 'mine' | 'all', status: 'open' | 'closed', n: number) =>
    `Showing ${scope === 'all' ? 'all' : 'your'} ${status} estimates, ${n} loaded`,
  loadFailedAll: 'Could not load all estimates. Check your connection and try again.',
  authzUnavailableTitle: 'Authorization service unavailable',
  authzUnavailableBody: 'Every estimate cannot be listed right now. Switch to Mine to keep working.',
  denied: {
    title: 'You cannot list every estimate',
    body: 'Your access to all estimates is not granted or was withdrawn.',
    action: 'Show my estimates',
  },
  you: 'You',
  deal: {
    label: 'Deal',
    linkName: (name: string) => `Deal for "${name}": open in the CRM`,
    plainHidden: ' linked to a CRM deal',
  },
  empty: {
    mineOpen: {
      heading: 'No open estimates',
      body: 'Create one, or look under Closed for finished work.',
      features: 'PERT estimation · AI comparison · Excel and PDF export',
    },
    mineClosed: {
      heading: 'No closed estimates',
      body: 'Estimates you close appear here. A closed estimate is read-only until its owner or an editor reopens it.',
    },
    allOpen: {
      heading: 'No open estimates',
      body: 'There is no estimate in progress in EstimAI.',
    },
    allClosed: {
      heading: 'No closed estimates',
      body: 'No estimate in EstimAI has been closed yet.',
    },
  },
  routeError: {
    title: 'Could not open this estimate',
    authzUnavailable: 'The authorization service is unavailable, so this estimate cannot be opened right now.',
    generic: 'Something went wrong while loading this estimate. Check your connection and try again.',
    retry: 'Retry',
    back: 'Back to estimates',
  },
}

export const itList: typeof enList = {
  accessEditor: 'Editor',
  accessViewer: 'Lettore',
  heading: 'Le mie stime',
  importJson: 'Importa JSON',
  newEstimate: 'Nuova stima',
  loadExample: 'Carica esempio',
  open: 'Apri',
  deleteTitle: 'Elimina',
  deleteAction: (name) => `Elimina "${name}"`,
  untitled: 'Senza titolo',
  importedName: 'Stima importata',
  copyName: (name) => `${name} (copia)`,
  metaSeparator: ' · ',
  loading: 'Caricamento delle stime',
  loaded: (n) => (n === 1 ? '1 stima caricata' : `${n} stime caricate`),
  loadFailed: 'Impossibile caricare le stime. Verificare la connessione e aggiornare la pagina.',
  retry: 'Riprova',
  createFailed: 'Impossibile creare una nuova stima. Verificare la connessione e riprovare.',
  exampleFailed: "Impossibile caricare la stima d'esempio. Verificare la connessione e riprovare.",
  deleteFailed: 'Eliminazione non riuscita. Riprovare.',
  deleted: 'Stima eliminata.',
  importFailed: 'Impossibile importare il file. Verificare che sia un export JSON di EstimAI.',
  importInvalidJson: 'File JSON non valido.',
  importNotAnEstimate: 'Il file non sembra una stima EstimAI valida.',
  importReadFailed: 'Impossibile leggere i dati importati.',
  dismiss: 'Chiudi',
  headingAll: 'Tutte le stime',
  filtersLabel: 'Filtra le stime',
  filters: {
    whose: 'Stime di',
    status: 'Stato',
    mine: 'Mie',
    all: 'Tutte',
    open: 'Aperte',
    closed: 'Chiuse',
  },
  loadedContext: (scope, status, n) =>
    `${scope === 'all' ? 'Tutte le stime' : 'Le mie stime'} ${status === 'open' ? 'aperte' : 'chiuse'}: ${n} caricate`,
  loadFailedAll: 'Impossibile caricare tutte le stime. Verificare la connessione e riprovare.',
  authzUnavailableTitle: 'Servizio di autorizzazione non disponibile',
  authzUnavailableBody: 'Al momento non è possibile elencare tutte le stime. Passare a Mie per continuare a lavorare.',
  denied: {
    title: 'Non è possibile elencare tutte le stime',
    body: "L'accesso a tutte le stime non è concesso o è stato revocato.",
    action: 'Mostra le mie stime',
  },
  you: 'Tu',
  deal: {
    label: 'Trattativa',
    linkName: (name) => `Trattativa per "${name}": apri nel CRM`,
    plainHidden: ' collegata a una trattativa CRM',
  },
  empty: {
    mineOpen: {
      heading: 'Nessuna stima aperta',
      body: 'Crearne una, oppure cercare tra le Chiuse il lavoro concluso.',
      features: 'Stima PERT · Confronto con AI · Esportazione Excel e PDF',
    },
    mineClosed: {
      heading: 'Nessuna stima chiusa',
      body: 'Le stime chiuse compaiono qui. Una stima chiusa è di sola lettura finché il proprietario o un editor non la riapre.',
    },
    allOpen: {
      heading: 'Nessuna stima aperta',
      body: 'In EstimAI non c’è nessuna stima in corso.',
    },
    allClosed: {
      heading: 'Nessuna stima chiusa',
      body: 'In EstimAI nessuna stima è stata ancora chiusa.',
    },
  },
  routeError: {
    title: 'Impossibile aprire questa stima',
    authzUnavailable: 'Il servizio di autorizzazione non è disponibile, quindi la stima non può essere aperta al momento.',
    generic: 'Qualcosa è andato storto durante il caricamento della stima. Verificare la connessione e riprovare.',
    retry: 'Riprova',
    back: 'Torna alle stime',
  },
}

export const enConfirmDelete = {
  title: 'Delete estimate?',
  body: (name: string) => `‘${name}’ will be permanently deleted. This cannot be undone.`,
  confirm: 'Delete',
  busy: 'Deleting…',
  cancel: 'Cancel',
  close: 'Cancel',
  untitled: 'Untitled',
}

export const itConfirmDelete: typeof enConfirmDelete = {
  title: 'Eliminare la stima?',
  body: (name) => `‘${name}’ verrà eliminata definitivamente. L'operazione non può essere annullata.`,
  confirm: 'Elimina',
  busy: 'Eliminazione…',
  cancel: 'Annulla',
  close: 'Annulla',
  untitled: 'Senza titolo',
}

export const enImportOffer = {
  titleOffer: 'Import your local estimates',
  titleImporting: 'Importing estimates…',
  titleComplete: 'Import complete',
  titleFinished: 'Import finished',
  close: 'Close',
  count: (n: number) => (n === 1 ? '1 estimate' : `${n} estimates`),
  foundBody: (n: number): string =>
    n === 1
      ? 'found in this browser that is not yet in your account. Import it now to access it from any device. Your local copies are always kept.'
      : 'found in this browser that are not yet in your account. Import them now to access them from any device. Your local copies are always kept.',
  previewLabel: 'Estimates found',
  andMore: (n: number) => `and ${n} more`,
  importing: (n: number) => (n === 1 ? 'Importing 1 estimate…' : `Importing ${n} estimates…`),
  summary: (imported: number, total: number) => `${imported} of ${total} imported successfully.`,
  caption: 'Import results',
  colEstimate: 'Estimate',
  colStatus: 'Status',
  imported: 'Imported',
  failed: 'Failed',
  copiesKept: 'Your local copies have not been removed.',
  skip: 'Skip for now',
  importAll: 'Import all',
  untitled: 'Untitled',
}

export const itImportOffer: typeof enImportOffer = {
  titleOffer: 'Importa le stime locali',
  titleImporting: 'Importazione delle stime…',
  titleComplete: 'Importazione completata',
  titleFinished: 'Importazione terminata',
  close: 'Chiudi',
  count: (n) => (n === 1 ? '1 stima' : `${n} stime`),
  foundBody: (n) =>
    n === 1
      ? "trovata in questo browser e non ancora presente nell'account. Importarla ora per accedervi da qualsiasi dispositivo. Le copie locali vengono sempre conservate."
      : "trovate in questo browser e non ancora presenti nell'account. Importarle ora per accedervi da qualsiasi dispositivo. Le copie locali vengono sempre conservate.",
  previewLabel: 'Stime trovate',
  andMore: (n) => `e altre ${n}`,
  importing: (n) => (n === 1 ? 'Importazione di 1 stima…' : `Importazione di ${n} stime…`),
  summary: (imported, total) => `${imported} di ${total} importate correttamente.`,
  caption: "Risultati dell'importazione",
  colEstimate: 'Stima',
  colStatus: 'Stato',
  imported: 'Importata',
  failed: 'Non riuscita',
  copiesKept: 'Le copie locali non sono state rimosse.',
  skip: 'Salta per ora',
  importAll: 'Importa tutte',
  untitled: 'Senza titolo',
}
