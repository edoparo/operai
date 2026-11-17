/** The page's version lines and modes (design § Copy keys "Nav, page, modes"). */
const en = {
  active: (n: number) => `Active version ${n}`,
  none: 'No letterhead yet',
  showing: (entity: string) => `Showing ${entity}`,
  emptyBanner: (entity: string) =>
    `${entity} has no letterhead yet. The form shows starting values; fill it in and save to create version 1.`,
  emptyReadOnlyTitle: 'No letterhead yet',
  emptyReadOnlyBody: 'Documents for this entity cannot be made until one is saved. Ask an administrator.',
  readOnlyAccess:
    'You can see this letterhead, its history and its preview, but you cannot change it. Ask an administrator for the permission to change letterheads.',
  readOnlyScoped: (own: string) => `You can change only the letterhead of ${own}. This one is read-only for you.`,
  readOnlyLost: 'You can no longer change this letterhead. Your changes are still visible here but were not saved.',
}

const it: typeof en = {
  active: (n: number) => `Versione attiva ${n}`,
  none: 'Nessuna carta intestata',
  showing: (entity: string) => `Visualizzazione di ${entity}`,
  emptyBanner: (entity: string) =>
    `${entity} non ha ancora una carta intestata. Il modulo mostra valori iniziali; compilalo e salva per creare la versione 1.`,
  emptyReadOnlyTitle: 'Nessuna carta intestata',
  emptyReadOnlyBody:
    'I documenti di questa entità non si possono creare finché non ne viene salvata una. Chiedi a un amministratore.',
  readOnlyAccess:
    'Puoi vedere questa carta intestata, la sua cronologia e la sua anteprima, ma non puoi modificarla. Chiedi a un amministratore il permesso di modificare le carte intestate.',
  readOnlyScoped: (own: string) =>
    `Puoi modificare solo la carta intestata di ${own}. Questa per te è in sola lettura.`,
  readOnlyLost:
    'Non puoi più modificare questa carta intestata. Le tue modifiche sono ancora visibili qui ma non sono state salvate.',
}

export const page = { en, it }
