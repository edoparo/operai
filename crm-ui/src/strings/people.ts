/** How a person (an Operai user) is shown and picked (ADR-0039, ADR-0047). */
const en = {
  deleted: 'Deleted user',
  unknown: 'Unknown user',
  system: 'System',
  you: 'You',
  picker: {
    loading: 'Loading people…',
    noMatch: 'No people match.',
    failed: 'The list of people could not be loaded.',
    rateLimited: (seconds: number) => `Too many lookups. Try again in ${seconds} seconds.`,
    results: (count: number) => (count === 1 ? '1 person' : `${count} people`),
    noName: 'No name',
    unavailableHint: 'Only people who manage deals can choose someone else.',
    pickRequired: 'Choose a person from the list.',
  },
}

const it: typeof en = {
  deleted: 'Utente eliminato',
  unknown: 'Utente sconosciuto',
  system: 'Sistema',
  you: 'Tu',
  picker: {
    loading: 'Caricamento persone…',
    noMatch: 'Nessuna persona corrisponde.',
    failed: "Non è stato possibile caricare l'elenco delle persone.",
    rateLimited: (seconds: number) => `Troppe ricerche. Riprova tra ${seconds} secondi.`,
    results: (count: number) => (count === 1 ? '1 persona' : `${count} persone`),
    noName: 'Senza nome',
    unavailableHint: 'Solo chi gestisce le opportunità può scegliere un’altra persona.',
    pickRequired: "Scegli una persona dall'elenco.",
  },
}

export const people = { en, it }
