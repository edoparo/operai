/** An older version opened in the preview (design F8, S6, § Copy keys `version.*`). */
const en = {
  title: (n: number) => `Viewing version ${n}`,
  body: (who: string, date: string) => `Saved by ${who} on ${date}. This is not the active version.`,
  /** The same, while the history that says who saved it and when has not answered (or failed to). */
  bodyPlain: 'This is not the active version.',
  back: 'Back to the active version',
  restore: 'Restore this version',
  notFound: 'This version could not be loaded.',
}

const it: typeof en = {
  title: (n: number) => `Visualizzazione della versione ${n}`,
  body: (who: string, date: string) => `Salvata da ${who} il ${date}. Non è la versione attiva.`,
  bodyPlain: 'Non è la versione attiva.',
  back: 'Torna alla versione attiva',
  restore: 'Ripristina questa versione',
  notFound: 'Impossibile caricare questa versione.',
}

export const version = { en, it }
