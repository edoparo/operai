/**
 * What a save says (design F7; § Copy keys `save.*`): the confirmation, and a sentence for each way the write
 * routes can refuse or fail (plan § Person routes; `routes/write.rs`). The sentences are chosen by status and
 * `code`, never by the service's wording. A refusal of the values is `problem.*`; a newer version is `conflict.*`.
 */
const en = {
  saved: (n: number) => `Version ${n} saved`,
  failedTitle: 'The letterhead was not saved',
  failedBody: 'Your changes are still here. Try again.',
  busy: 'The service is busy. Your changes are still here. Try again in a moment.',
  rejected:
    'The service did not accept this request. Your changes are still here. Reload the page and try again; if it keeps happening, tell an administrator.',
  tooLarge: 'The letterhead is too large to save. Your changes are still here.',
  unknownLayout:
    'The page layout this form was made for is no longer available. Your changes are still here. Reload the page and try again.',
  retry: 'Try again',
  lostTitle: 'You can no longer change this letterhead',
}

const it: typeof en = {
  saved: (n: number) => `Versione ${n} salvata`,
  failedTitle: 'La carta intestata non è stata salvata',
  failedBody: 'Le tue modifiche sono ancora qui. Riprova.',
  busy: 'Il servizio è occupato. Le tue modifiche sono ancora qui. Riprova tra un momento.',
  rejected:
    'Il servizio non ha accettato la richiesta. Le tue modifiche sono ancora qui. Ricarica la pagina e riprova; se succede ancora, avvisa un amministratore.',
  tooLarge: 'La carta intestata è troppo grande per essere salvata. Le tue modifiche sono ancora qui.',
  unknownLayout:
    'L’impaginazione per cui è stato creato questo modulo non è più disponibile. Le tue modifiche sono ancora qui. Ricarica la pagina e riprova.',
  retry: 'Riprova',
  lostTitle: 'Non puoi più modificare questa carta intestata',
}

export const save = { en, it }
