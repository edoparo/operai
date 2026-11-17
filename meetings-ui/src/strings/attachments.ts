/** Copy for the attachments card: files and links that give a meeting context (and the AI something to read). */
const en = {
  title: 'Attachments',
  listLabel: 'Attachments',
  loading: 'Loading the attachments…',
  loadFailed: 'The attachments could not be loaded.',
  reload: 'Reload attachments',
  addFile: 'Add file',
  addLink: 'Add link',
  retention:
    'Files are kept for 29 days, like the recording. Links are never opened by Operai: only their label is given to the AI.',
  emptyEditor:
    'Nothing attached yet. Attach the agenda, the slides (PDF) or your notes, so the AI has context for the transcript, summaries and answers.',
  emptyReader: 'Nothing is attached to this meeting.',
  availableUntil: (date: string) => `Available until ${date}`,
  addedOn: (date: string) => `Added ${date}`,
  expiredFile: 'Expired and deleted',
  download: 'Download',
  downloadLabel: (name: string) => `Download ${name}`,
  remove: 'Remove',
  removeLabel: (name: string) => `Remove ${name}`,
  openLinkLabel: (label: string) => `${label} (opens in a new tab)`,
  size: {
    byte: 'byte',
    kilobyte: 'kB',
    megabyte: 'MB',
    gigabyte: 'GB',
  },
  ai: {
    used: 'Used as AI context',
    not_supported: 'Not read by the AI',
    too_large: 'Too large for the AI context',
    expired: 'Expired',
    label_only: 'Only the label is given to the AI',
  },
  aiHint: {
    not_supported: 'Export it to PDF to give it to the AI.',
  },
  upload: {
    uploading: (name: string, n: number, total: number) => `Uploading ${name} (${n} of ${total})…`,
  },
  refused: {
    unsupportedType: (name: string) => `${name}: this file type cannot be attached.`,
    tooLarge: (name: string, limit: string) => `${name}: the file is larger than ${limit}.`,
    empty: (name: string) => `${name}: the file is empty.`,
    bucketFailed: (name: string) => `${name}: the upload failed. Try again.`,
    failed: (name: string, reason: string) => `${name}: ${reason}`,
  },
  linkDialog: {
    title: 'Add link',
    description: 'Anyone who can open this meeting sees the link. Operai never opens it: the AI only reads its label.',
    urlLabel: 'Address',
    urlHint: 'Starts with https:// or http://',
    labelLabel: 'Label (optional)',
    labelHint: 'What the link is, for example “Q3 slides”. Without one, the address is shown.',
    submit: 'Add link',
    submitting: 'Adding…',
    urlRequired: 'Enter an address.',
    urlInvalid: 'Enter a web address starting with https:// or http://.',
    labelTooLong: 'Use at most 200 characters.',
  },
  removeDialog: {
    title: 'Remove attachment',
    body: (name: string) => `“${name}” will be removed from this meeting. A file is deleted for good.`,
    confirm: 'Remove',
    removing: 'Removing…',
  },
}

const it: typeof en = {
  title: 'Allegati',
  listLabel: 'Allegati',
  loading: 'Caricamento degli allegati…',
  loadFailed: 'Non è stato possibile caricare gli allegati.',
  reload: 'Ricarica allegati',
  addFile: 'Aggiungi file',
  addLink: 'Aggiungi link',
  retention:
    'I file restano disponibili per 29 giorni, come la registrazione. I link non vengono mai aperti da Operai: all’AI viene dato solo il loro nome.',
  emptyEditor:
    'Nessun allegato. Allega la scaletta, le slide (PDF) o i tuoi appunti, così l’AI ha un contesto per trascrizione, riassunti e risposte.',
  emptyReader: 'Nessun allegato per questa riunione.',
  availableUntil: (date) => `Disponibile fino al ${date}`,
  addedOn: (date) => `Aggiunto il ${date}`,
  expiredFile: 'Scaduto ed eliminato',
  download: 'Scarica',
  downloadLabel: (name) => `Scarica ${name}`,
  remove: 'Rimuovi',
  removeLabel: (name) => `Rimuovi ${name}`,
  openLinkLabel: (label) => `${label} (si apre in una nuova scheda)`,
  size: {
    byte: 'byte',
    kilobyte: 'kB',
    megabyte: 'MB',
    gigabyte: 'GB',
  },
  ai: {
    used: 'Usato come contesto per l’AI',
    not_supported: 'Non letto dall’AI',
    too_large: 'Troppo grande per il contesto dell’AI',
    expired: 'Scaduto',
    label_only: 'All’AI viene dato solo il nome',
  },
  aiHint: {
    not_supported: 'Esportalo in PDF per darlo all’AI.',
  },
  upload: {
    uploading: (name, n, total) => `Caricamento di ${name} (${n} di ${total})…`,
  },
  refused: {
    unsupportedType: (name) => `${name}: questo tipo di file non si può allegare.`,
    tooLarge: (name, limit) => `${name}: il file supera ${limit}.`,
    empty: (name) => `${name}: il file è vuoto.`,
    bucketFailed: (name) => `${name}: il caricamento non è riuscito. Riprova.`,
    failed: (name, reason) => `${name}: ${reason}`,
  },
  linkDialog: {
    title: 'Aggiungi link',
    description:
      'Chiunque può aprire questa riunione vede il link. Operai non lo apre mai: l’AI legge solo il suo nome.',
    urlLabel: 'Indirizzo',
    urlHint: 'Inizia con https:// o http://',
    labelLabel: 'Nome (facoltativo)',
    labelHint: 'Cos’è il link, per esempio “Slide Q3”. Senza nome si mostra l’indirizzo.',
    submit: 'Aggiungi link',
    submitting: 'Aggiunta…',
    urlRequired: 'Inserisci un indirizzo.',
    urlInvalid: 'Inserisci un indirizzo web che inizia con https:// o http://.',
    labelTooLong: 'Usa al massimo 200 caratteri.',
  },
  removeDialog: {
    title: 'Rimuovi allegato',
    body: (name) => `“${name}” sarà rimosso da questa riunione. Un file viene eliminato definitivamente.`,
    confirm: 'Rimuovi',
    removing: 'Rimozione…',
  },
}

export const attachments = { en, it }
