/**
 * strings.offices — the Offices screen (`/offices`): the table, the add and edit
 * dialogs and the archive / restore confirmations. Problem codes
 * (`office_name_taken`, `office_in_use`) live in `strings.errors`.
 */
const en = {
  heading: 'Offices',
  loading: 'Loading offices',
  retry: 'Retry',
  add: 'Add office',
  regionLabel: 'Offices table',
  caption: 'Offices',
  empty: {
    heading: 'No offices yet',
    body: 'Add an office to assign assets to it.',
  },
  columns: {
    name: 'Name',
    entity: 'Entity',
    assets: 'Assets held',
    status: 'Status',
    actions: 'Actions',
  },
  status: { active: 'Active', archived: 'Archived' },
  actions: {
    edit: 'Edit',
    archive: 'Archive',
    restore: 'Restore',
    /** aria-labels name the office, so the buttons are distinguishable out of context. */
    editLabel: (name: string) => `Edit ${name}`,
    archiveLabel: (name: string) => `Archive ${name}`,
    restoreLabel: (name: string) => `Restore ${name}`,
  },
  form: {
    addTitle: 'Add office',
    editTitle: (name: string) => `Edit ${name}`,
    description: 'The entity is information only: an asset of any entity can go to any office.',
    name: 'Name',
    entity: 'Entity',
    nameRequired: 'Enter the office name.',
    entityRequired: 'Choose an entity.',
    entityPlaceholder: 'Choose an entity',
    save: 'Save',
    saving: 'Saving…',
    create: 'Add office',
    creating: 'Adding…',
  },
  archiveDialog: {
    entityLabel: 'office',
    title: (name: string) => `Archive ${name}?`,
    body: 'It can no longer be chosen for new assignments. You can restore it later.',
    confirm: 'Archive',
    confirming: 'Archiving…',
  },
  restoreDialog: {
    entityLabel: 'office',
    title: (name: string) => `Restore ${name}?`,
    body: 'It can be chosen for assignments again.',
    confirm: 'Restore',
    confirming: 'Restoring…',
  },
  done: {
    added: (name: string) => `${name} added.`,
    updated: (name: string) => `${name} updated.`,
    archived: (name: string) => `${name} archived.`,
    restored: (name: string) => `${name} restored.`,
  },
  noEntity: 'No entity is in your scope for managing offices. Ask an administrator.',
}

const it: typeof en = {
  heading: 'Uffici',
  loading: 'Caricamento uffici',
  retry: 'Riprova',
  add: 'Aggiungi ufficio',
  regionLabel: 'Tabella degli uffici',
  caption: 'Uffici',
  empty: {
    heading: 'Nessun ufficio',
    body: 'Aggiungere un ufficio per potergli assegnare dei beni.',
  },
  columns: {
    name: 'Nome',
    entity: 'Entità',
    assets: 'Beni assegnati',
    status: 'Stato',
    actions: 'Azioni',
  },
  status: { active: 'Attivo', archived: 'Archiviato' },
  actions: {
    edit: 'Modifica',
    archive: 'Archivia',
    restore: 'Ripristina',
    editLabel: (name: string) => `Modifica ${name}`,
    archiveLabel: (name: string) => `Archivia ${name}`,
    restoreLabel: (name: string) => `Ripristina ${name}`,
  },
  form: {
    addTitle: 'Aggiungi ufficio',
    editTitle: (name: string) => `Modifica ${name}`,
    description: "L'entità è solo informativa: un bene di qualsiasi entità può andare in qualsiasi ufficio.",
    name: 'Nome',
    entity: 'Entità',
    nameRequired: "Inserire il nome dell'ufficio.",
    entityRequired: "Scegliere un'entità.",
    entityPlaceholder: "Scegliere un'entità",
    save: 'Salva',
    saving: 'Salvataggio…',
    create: 'Aggiungi ufficio',
    creating: 'Aggiunta…',
  },
  archiveDialog: {
    entityLabel: 'ufficio',
    title: (name: string) => `Archiviare ${name}?`,
    body: 'Non potrà più essere scelto per nuove assegnazioni. Si potrà ripristinare in seguito.',
    confirm: 'Archivia',
    confirming: 'Archiviazione…',
  },
  restoreDialog: {
    entityLabel: 'ufficio',
    title: (name: string) => `Ripristinare ${name}?`,
    body: 'Potrà essere di nuovo scelto per le assegnazioni.',
    confirm: 'Ripristina',
    confirming: 'Ripristino…',
  },
  done: {
    added: (name: string) => `${name} aggiunto.`,
    updated: (name: string) => `${name} aggiornato.`,
    archived: (name: string) => `${name} archiviato.`,
    restored: (name: string) => `${name} ripristinato.`,
  },
  noEntity: 'Nessuna entità di competenza per gestire gli uffici. Rivolgersi a un amministratore.',
}

export const offices = { en, it }
