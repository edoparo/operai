/**
 * Restoring an older version (design F8, § Copy keys `restore.*`): the confirmation, and a sentence for each
 * way the restore route can refuse or fail (`routes/write.rs` `restore`). The sentence is chosen by status and
 * `code`, never by the service's wording.
 */
const en = {
  title: (n: number) => `Restore version ${n}?`,
  body: (n: number, next: number, active: number) =>
    `This creates version ${next} with the same settings and logos as version ${n} and makes it the active one. Version ${active} and the rest of the history stay as they are.`,
  /** Added when the form holds changes that were not saved: restoring replaces the form. */
  discards: 'The unsaved changes in the form are lost.',
  confirm: (n: number) => `Restore version ${n}`,
  busy: 'Restoring…',
  cancel: 'Cancel',
  close: 'Close',
  conflict: 'A newer version was saved meanwhile. Reload the history and try again.',
  done: (next: number, n: number) => `Version ${next} created from version ${n}`,
  failed: (n: number) => `Version ${n} was not restored. Nothing changed. Try again.`,
  unknownLayout: 'This version was saved with a page layout that is no longer available, so it cannot be restored.',
}

const it: typeof en = {
  title: (n: number) => `Ripristinare la versione ${n}?`,
  body: (n: number, next: number, active: number) =>
    `Verrà creata la versione ${next} con le stesse impostazioni e gli stessi loghi della versione ${n} e diventerà quella attiva. La versione ${active} e il resto della cronologia restano invariati.`,
  discards: 'Le modifiche non salvate nel modulo andranno perse.',
  confirm: (n: number) => `Ripristina la versione ${n}`,
  busy: 'Ripristino…',
  cancel: 'Annulla',
  close: 'Chiudi',
  conflict: 'Nel frattempo è stata salvata una versione più recente. Ricarica la cronologia e riprova.',
  done: (next: number, n: number) => `Creata la versione ${next} dalla versione ${n}`,
  failed: (n: number) => `La versione ${n} non è stata ripristinata. Non è cambiato nulla. Riprova.`,
  unknownLayout:
    'Questa versione è stata salvata con un’impaginazione che non è più disponibile, quindi non può essere ripristinata.',
}

export const restore = { en, it }
