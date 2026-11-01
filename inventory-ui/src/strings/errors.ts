/**
 * strings.errors — one message per API Problem JSON `code` (the list is
 * `INVENTORY_ERROR_CODES` in lib/types.ts; a test asserts there is no gap) plus
 * the status-only failures of design.md § Error and conflict catalogue.
 *
 * A message with a `{name}` placeholder is a template: fill it with
 * `fillTemplate`. The values are the typed extras the plan documents for that
 * code (`serialNumber`, `year`, `from`) or page context (`entity`, `name`,
 * `date`, `asset`, `n`). Templates are plain strings, not functions, so that
 * the whole catalogue stays data a test can walk.
 */

/** Replaces each `{key}` with its value; a key with no value stays visible rather than printing "undefined". */
export const fillTemplate = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = values[key]
    return value === undefined ? placeholder : String(value)
  })

const en = {
  // --- API codes (INVENTORY_ERROR_CODES) -----------------------------------
  serial_count_mismatch: 'Enter one serial number per unit, or leave the serial numbers empty.',
  serial_conflict: 'Serial number {serialNumber} is already used by an active asset of this entity.',
  fiscal_year_closed: '{year} is closed for {entity}. Choose a date in an open year.',
  invalid_transition: 'This asset is now {from}; someone else changed it. The page has been refreshed.',
  assignment_pending: 'This asset has a pending assignment to {name}. Cancel it first.',
  asset_disposed: 'This asset has been disposed of and can no longer be changed.',
  assignment_not_pending: 'This assignment is no longer open.',
  unknown_user: 'That person can no longer receive devices.',
  disposed_before_purchase: 'The disposal date cannot be before the purchase date ({date}).',
  sale_price_not_allowed:
    'A sale price can only be recorded when the asset is sold. Change the reason or clear the price.',
  previous_year_open: 'Close {year} first.',
  already_closed: '{year} is already closed.',
  nothing_to_close: '{year} has no assets to close.',
  invoice_ref_mismatch: '{asset} has a different invoice reference and was not linked.',
  upload_not_found: 'The upload did not complete. Try again.',
  year_in_future: '{year} is in the future and cannot be closed yet.',
  too_many_pending_uploads: 'Too many uploads are waiting to be completed. Try again in an hour.',

  // --- Variants of a code, by where it is shown -----------------------------
  /** `fiscal_year_closed` on the edit dialog's price / purchase date: a banner, not a field error. */
  fiscal_year_closed_edit: 'Price and purchase date cannot change because {year} is closed.',

  // --- Status-only failures (no `code`) --------------------------------------
  validation: 'Check the highlighted fields and try again.',
  tooLarge: 'This file is larger than 10 MiB.',
  unsupportedType: 'Only PDF, JPEG or PNG files can be uploaded.',
  tooManyLookups: 'Too many lookups. Try again in {n} seconds.',
  tooManyLookupsNoDelay: 'Too many lookups. Try again shortly.',
  network: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
}

const it: typeof en = {
  serial_count_mismatch: 'Inserire un numero di serie per ogni unità, oppure lasciare vuoti i numeri di serie.',
  serial_conflict: 'Il numero di serie {serialNumber} è già utilizzato da un bene attivo di questa entità.',
  fiscal_year_closed: "L'esercizio {year} è chiuso per {entity}. Scegliere una data in un esercizio aperto.",
  invalid_transition:
    'Lo stato di questo bene ora è «{from}»: un altro utente lo ha modificato. La pagina è stata aggiornata.',
  assignment_pending: "Questo bene ha un'assegnazione in attesa a {name}. Annullarla prima di procedere.",
  asset_disposed: 'Questo bene è stato dismesso e non può più essere modificato.',
  assignment_not_pending: 'Questa assegnazione non è più aperta.',
  unknown_user: 'Questa persona non può più ricevere dispositivi.',
  disposed_before_purchase: 'La data di dismissione non può precedere la data di acquisto ({date}).',
  sale_price_not_allowed:
    'Un prezzo di vendita può essere registrato solo se il bene è venduto. Modificare il motivo o rimuovere il prezzo.',
  previous_year_open: "Chiudere prima l'esercizio {year}.",
  already_closed: "L'esercizio {year} è già chiuso.",
  nothing_to_close: "L'esercizio {year} non ha beni da chiudere.",
  invoice_ref_mismatch: '{asset} ha un riferimento fattura diverso e non è stato collegato.',
  upload_not_found: 'Il caricamento non è stato completato. Riprovare.',
  year_in_future: "L'esercizio {year} è nel futuro e non può ancora essere chiuso.",
  too_many_pending_uploads: "Troppi caricamenti in attesa di completamento. Riprovare tra un'ora.",

  fiscal_year_closed_edit:
    "Prezzo e data di acquisto non possono essere modificati perché l'esercizio {year} è chiuso.",

  validation: 'Controllare i campi evidenziati e riprovare.',
  tooLarge: 'Il file supera i 10 MiB.',
  unsupportedType: 'È possibile caricare solo file PDF, JPEG o PNG.',
  tooManyLookups: 'Troppe ricerche. Riprovare tra {n} secondi.',
  tooManyLookupsNoDelay: 'Troppe ricerche. Riprovare a breve.',
  network: 'Impossibile raggiungere il server. Verificare la connessione e riprovare.',
  unknown: 'Si è verificato un errore. Riprovare.',
}

export const errors = { en, it }
