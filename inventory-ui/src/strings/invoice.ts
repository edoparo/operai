/**
 * strings.invoice — the Invoice panel of the asset detail page (T35,
 * specs/015-hardware-inventory; design.md § T2 invoice region, F8, § Error and
 * conflict catalogue, § Accessibility "Invoice panel"). Error messages for
 * 413 / 415 / `upload_not_found` / `invoice_ref_mismatch` are the catalogue's
 * (`strings.errors`); only the panel's own copy lives here.
 */
const en = {
  heading: 'Invoice',

  reference: 'Invoice reference',
  referenceNone: 'Not set',
  file: 'Invoice file',
  fileNone: 'No invoice file yet.',

  open: 'Open invoice',
  /** The accessible name names the file: "Open invoice inv.pdf". */
  openNamed: (fileName: string) => `Open invoice ${fileName}`,
  opening: 'Opening…',
  openFailed: 'Could not open the invoice. Try again.',

  upload: 'Upload invoice',
  uploadAnother: 'Upload a new file',
  uploadAnotherHint: 'A new file replaces the one linked to this asset.',
  /** Why Upload is not available; the `aria-describedby` target. */
  needsReference: 'Set an invoice reference first. Use Edit details, then upload the file.',
  uploading: (fileName: string) => `Uploading ${fileName}…`,
  saved: (fileName: string) => `Invoice file ${fileName} saved.`,
  /** A rejected file stays on screen next to its reason until dismissed. */
  rejected: (fileName: string, reason: string) => `${fileName}: ${reason}`,
  dismiss: 'Dismiss',

  /** The file is stored but the link to THIS asset failed. */
  linkOwnFailed: 'The file was uploaded but could not be linked to this asset.',
  retryLink: 'Try linking again',
  retry: 'Retry',

  readOnly: 'This asset has been disposed of. Its invoice can no longer be changed.',

  siblings: {
    loading: 'Looking for assets with the same invoice reference…',
    failed: 'Could not look up other assets with this invoice reference.',
    legend: (reference: string) => `Link to assets with invoice reference ${reference}`,
    /** A checkbox label: the description, with the serial number when there is one. */
    option: (description: string, serialNumber: string | null) =>
      serialNumber === null ? description : `${description} (${serialNumber})`,
    selected: (count: number) => `${count} selected`,
    link: 'Link selected',
    linking: 'Linking…',
    notNow: 'Not now',
    done: (count: number) => `Invoice linked to ${count} more ${count === 1 ? 'asset' : 'assets'}.`,
    /** Fallback name for an asset the lookup did not return. */
    unnamedAsset: 'An asset',
    /** `asset_disposed` carries the asset id; the catalogue message is prefixed with its name. */
    disposed: (asset: string, message: string) => `${asset}: ${message}`,
    notFound: 'One of the selected assets is no longer available. The list has been refreshed.',
  },
}

const it: typeof en = {
  heading: 'Fattura',

  reference: 'Riferimento fattura',
  referenceNone: 'Non impostato',
  file: 'File fattura',
  fileNone: 'Nessun file fattura.',

  open: 'Apri fattura',
  openNamed: (fileName: string) => `Apri fattura ${fileName}`,
  opening: 'Apertura…',
  openFailed: 'Impossibile aprire la fattura. Riprovare.',

  upload: 'Carica fattura',
  uploadAnother: 'Carica un nuovo file',
  uploadAnotherHint: 'Il nuovo file sostituisce quello collegato a questo bene.',
  needsReference: 'Impostare prima un riferimento fattura con Modifica dettagli, poi caricare il file.',
  uploading: (fileName: string) => `Caricamento di ${fileName}…`,
  saved: (fileName: string) => `File fattura ${fileName} salvato.`,
  rejected: (fileName: string, reason: string) => `${fileName}: ${reason}`,
  dismiss: 'Chiudi',

  linkOwnFailed: 'Il file è stato caricato ma non è stato possibile collegarlo a questo bene.',
  retryLink: 'Riprova il collegamento',
  retry: 'Riprova',

  readOnly: 'Questo bene è stato dismesso. La sua fattura non può più essere modificata.',

  siblings: {
    loading: 'Ricerca dei beni con lo stesso riferimento fattura…',
    failed: 'Impossibile cercare altri beni con questo riferimento fattura.',
    legend: (reference: string) => `Collega ai beni con riferimento fattura ${reference}`,
    option: (description: string, serialNumber: string | null) =>
      serialNumber === null ? description : `${description} (${serialNumber})`,
    selected: (count: number) => (count === 1 ? '1 selezionato' : `${count} selezionati`),
    link: 'Collega selezionati',
    linking: 'Collegamento…',
    notNow: 'Non ora',
    done: (count: number) =>
      count === 1 ? 'Fattura collegata a 1 altro bene.' : `Fattura collegata ad altri ${count} beni.`,
    unnamedAsset: 'Un bene',
    disposed: (asset: string, message: string) => `${asset}: ${message}`,
    notFound: "Uno dei beni selezionati non è più disponibile. L'elenco è stato aggiornato.",
  },
}

export const invoice = { en, it }
