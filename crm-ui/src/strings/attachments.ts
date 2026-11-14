/** The deal page's Attachments card (specs/20261101-crm-sales-flow AC-4.3, AC-4.4). */
const en = {
  title: 'Attachments',
  loading: 'Loading the attachments…',
  empty: 'No files attached to this deal yet.',
  upload: 'Upload a file',
  uploading: 'Uploading…',
  hint: 'PDF, Word, Excel, PNG or JPEG, up to 20 MB.',
  caption: 'Files attached to the deal',
  columns: { file: 'File', size: 'Size', uploadedBy: 'Uploaded by', date: 'Date', actions: 'Actions' },
  download: 'Download',
  downloadOf: (name: string) => `Download ${name}`,
  deleteOf: (name: string) => `Delete ${name}`,
  noDownload: 'Only the uploader can download this file.',
  size: {
    kilobytes: (value: string) => `${value} KB`,
    megabytes: (value: string) => `${value} MB`,
  },
  deleteDialog: {
    title: 'Delete this file?',
    body: (name: string) => `${name} is removed from the deal and can no longer be downloaded.`,
    confirm: 'Delete file',
    busy: 'Deleting…',
  },
  uploaded: (name: string) => `${name} uploaded.`,
  deletedDone: 'File deleted.',
  errors: {
    typeNotAllowed: 'This file type is not allowed. Use PDF, Word, Excel, PNG or JPEG.',
    tooLarge: 'A file is at most 20 MB.',
    uploadFailed: 'The file could not be uploaded. Try again.',
    storageUnconfigured: 'File storage is not set up yet. Attachments will work once an administrator configures it.',
  },
  storageMissingTitle: 'File storage is not set up yet',
  storageMissingBody: 'Attachments and offers need file storage. Ask an administrator to configure it.',
}

const it: typeof en = {
  title: 'Allegati',
  loading: 'Caricamento degli allegati…',
  empty: "Nessun file allegato a questa opportunità.",
  upload: 'Carica un file',
  uploading: 'Caricamento…',
  hint: 'PDF, Word, Excel, PNG o JPEG, fino a 20 MB.',
  caption: "File allegati all'opportunità",
  columns: { file: 'File', size: 'Dimensione', uploadedBy: 'Caricato da', date: 'Data', actions: 'Azioni' },
  download: 'Scarica',
  downloadOf: (name: string) => `Scarica ${name}`,
  deleteOf: (name: string) => `Elimina ${name}`,
  noDownload: 'Solo chi lo ha caricato può scaricare questo file.',
  size: {
    kilobytes: (value: string) => `${value} KB`,
    megabytes: (value: string) => `${value} MB`,
  },
  deleteDialog: {
    title: 'Eliminare questo file?',
    body: (name: string) => `${name} viene tolto dall'opportunità e non si può più scaricare.`,
    confirm: 'Elimina file',
    busy: 'Eliminazione…',
  },
  uploaded: (name: string) => `${name} caricato.`,
  deletedDone: 'File eliminato.',
  errors: {
    typeNotAllowed: 'Questo tipo di file non è consentito. Usa PDF, Word, Excel, PNG o JPEG.',
    tooLarge: 'Un file può pesare al massimo 20 MB.',
    uploadFailed: 'Non è stato possibile caricare il file. Riprova.',
    storageUnconfigured: "L'archiviazione dei file non è ancora configurata. Gli allegati funzioneranno quando un amministratore la imposta.",
  },
  storageMissingTitle: "L'archiviazione dei file non è ancora configurata",
  storageMissingBody: "Allegati e offerte richiedono l'archiviazione dei file. Chiedi a un amministratore di configurarla.",
}

export const attachments = { en, it }
