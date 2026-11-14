/**
 * strings.actions — the asset detail page's action region (T33, specs/20261006-
 * hardware-inventory; design.md F3, F5, § Dialogs, § Error and conflict
 * catalogue): the status actions, the pending-assignment and holder-deleted
 * callouts, and the Assign dialog. Templates with `{name}` placeholders go
 * through `fillTemplate`; the API-code messages live in `strings.errors`.
 */
const en = {
  groupLabel: 'Asset actions',

  receive: 'Mark as received',
  assign: 'Assign...',
  repair: 'Mark in repair',
  repairDone: 'Repair finished',
  return: 'Record return',
  lost: 'Mark lost',
  found: 'Mark found',

  /** Polite status line after a successful action. */
  done: {
    received: 'Marked as received.',
    assigned: (name: string) => `Assignment offered. Awaiting confirmation from ${name}.`,
    cancelled: 'Assignment cancelled.',
    returned: 'Return recorded.',
    repair: 'Marked in repair.',
    repairDone: 'Repair finished.',
    lost: 'Marked as lost.',
    found: 'Marked as found.',
  },

  /** Who `assignment_pending` names: the race means the page does not know the assignee yet. */
  someone: 'another person',
  /** `invalid_transition` when the server sent no `from`. */
  changedGeneric: 'This asset was changed by someone else. The page has been refreshed.',
  conflictTitle: 'This asset changed',

  pending: {
    cancel: 'Cancel assignment',
    /** "Awaiting confirmation from Anna Rossi, offered 06.10.2026, 3 days ago". */
    text: (name: string, date: string, age: string) => `Awaiting confirmation from ${name}, offered ${date}, ${age}`,
    textNoAge: (name: string, date: string) => `Awaiting confirmation from ${name}, offered ${date}`,
    ageToday: 'today',
    ageDays: (days: number) => (days === 1 ? '1 day ago' : `${days} days ago`),
  },

  holderDeleted: {
    named: (name: string) => `${name}'s account was deleted. Record the return to put this asset back in stock.`,
    unnamed: "The holder's account was deleted. Record the return to put this asset back in stock.",
  },

  returnDialog: {
    entityLabel: 'return',
    title: (description: string) => `Record the return of ${description}?`,
    body: (holder: string) => `${holder} is no longer recorded as the holder, and the asset goes back in stock.`,
    holderFallback: 'The holder',
    confirm: 'Record return',
    confirming: 'Recording…',
  },

  lostDialog: {
    entityLabel: 'asset',
    title: (description: string) => `Mark ${description} as lost?`,
    body: 'Lost assets stay on the books. The holder is cleared and is not restored by Mark found.',
    confirm: 'Mark lost',
    confirming: 'Marking…',
  },

  cancelDialog: {
    entityLabel: 'assignment',
    title: (description: string) => `Cancel the assignment of ${description}?`,
    body: (name: string) =>
      `${name} will no longer be asked to confirm this device. The asset stays in stock with no holder and can be assigned again.`,
    confirm: 'Cancel assignment',
    confirming: 'Cancelling…',
  },

  assignDialog: {
    title: 'Assign asset',
    description: (asset: string) =>
      `${asset} is offered to the person you pick. It stays in stock until they confirm they received it.`,
    holder: 'Holder',
    holderPlaceholder: 'Search by name or email',
    /** Typed text that matches no pick yet: the field error on Assign. */
    holderRequired: 'Pick a person from the list.',
    loading: 'Loading users…',
    empty: 'No active users match',
    submit: 'Assign',
    submitting: 'Assigning…',
    retry: 'Retry',
    /** The "name, email, entity" of an option. */
    optionDetail: (email: string, entity: string | null) => (entity === null ? email : `${email}, ${entity}`),
    optionNoName: 'Unnamed user',
  },
}

const it: typeof en = {
  groupLabel: 'Azioni sul bene',

  receive: 'Segna come ricevuto',
  assign: 'Assegna...',
  repair: 'Segna in riparazione',
  repairDone: 'Riparazione completata',
  return: 'Registra reso',
  lost: 'Segna come smarrito',
  found: 'Segna come ritrovato',

  done: {
    received: 'Segnato come ricevuto.',
    assigned: (name: string) => `Assegnazione proposta. In attesa di conferma da ${name}.`,
    cancelled: 'Assegnazione annullata.',
    returned: 'Reso registrato.',
    repair: 'Segnato in riparazione.',
    repairDone: 'Riparazione completata.',
    lost: 'Segnato come smarrito.',
    found: 'Segnato come ritrovato.',
  },

  someone: "un'altra persona",
  changedGeneric: 'Questo bene è stato modificato da un altro utente. La pagina è stata aggiornata.',
  conflictTitle: 'Questo bene è cambiato',

  pending: {
    cancel: 'Annulla assegnazione',
    text: (name: string, date: string, age: string) => `In attesa di conferma da ${name}, proposto il ${date}, ${age}`,
    textNoAge: (name: string, date: string) => `In attesa di conferma da ${name}, proposto il ${date}`,
    ageToday: 'oggi',
    ageDays: (days: number) => (days === 1 ? '1 giorno fa' : `${days} giorni fa`),
  },

  holderDeleted: {
    named: (name: string) =>
      `L'account di ${name} è stato eliminato. Registrare il reso per riportare il bene in magazzino.`,
    unnamed: "L'account dell'assegnatario è stato eliminato. Registrare il reso per riportare il bene in magazzino.",
  },

  returnDialog: {
    entityLabel: 'reso',
    title: (description: string) => `Registrare il reso di ${description}?`,
    body: (holder: string) => `${holder} non risulta più assegnatario e il bene torna in magazzino.`,
    holderFallback: "L'assegnatario",
    confirm: 'Registra reso',
    confirming: 'Registrazione…',
  },

  lostDialog: {
    entityLabel: 'bene',
    title: (description: string) => `Segnare ${description} come smarrito?`,
    body: "I beni smarriti restano a bilancio. L'assegnatario viene rimosso e non viene ripristinato da Segna come ritrovato.",
    confirm: 'Segna come smarrito',
    confirming: 'Aggiornamento…',
  },

  cancelDialog: {
    entityLabel: 'assegnazione',
    title: (description: string) => `Annullare l'assegnazione di ${description}?`,
    body: (name: string) =>
      `A ${name} non verrà più chiesto di confermare questo dispositivo. Il bene resta in magazzino senza assegnatario e può essere assegnato di nuovo.`,
    confirm: 'Annulla assegnazione',
    confirming: 'Annullamento…',
  },

  assignDialog: {
    title: 'Assegna bene',
    description: (asset: string) =>
      `${asset} viene proposto alla persona selezionata. Resta in magazzino finché non ne conferma la ricezione.`,
    holder: 'Assegnatario',
    holderPlaceholder: 'Cerca per nome o email',
    holderRequired: "Selezionare una persona dall'elenco.",
    loading: 'Caricamento utenti…',
    empty: 'Nessun utente attivo corrispondente',
    submit: 'Assegna',
    submitting: 'Assegnazione…',
    retry: 'Riprova',
    optionDetail: (email: string, entity: string | null) => (entity === null ? email : `${email}, ${entity}`),
    optionNoName: 'Utente senza nome',
  },
}

export const actions = { en, it }
