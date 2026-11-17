/** The live preview of the sample document (design § Copy keys "Preview"; F3, F4, S7). */
const en = {
  title: 'Preview',
  region: 'Preview of the sample document',
  sample: 'Sample document with sample company data. Nothing here is read from the CRM or any other tool.',
  language: 'Preview language',
  it: 'Italian',
  en: 'English',
  pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  updating: 'Updating the preview…',
  failedShort: 'Could not update',
  loading: 'Preparing the preview…',
  pageAlt: (n: number, total: number) => `Page ${n} of ${total}`,
  failedTitle: 'The preview could not be updated',
  failedBody: 'The pages shown are from your last successful preview. Your changes are kept and you can still save.',
  failedFirstBody: 'There is no preview yet. Your changes are kept and you can still save.',
  retry: 'Try again',
  close: 'Close the preview',
}

const it: typeof en = {
  title: 'Anteprima',
  region: 'Anteprima del documento di esempio',
  sample: 'Documento di esempio con dati aziendali di esempio. Nulla viene letto dal CRM o da altri strumenti.',
  language: 'Lingua dell’anteprima',
  it: 'Italiano',
  en: 'Inglese',
  pages: (n: number) => (n === 1 ? '1 pagina' : `${n} pagine`),
  updating: 'Aggiornamento dell’anteprima…',
  failedShort: 'Aggiornamento non riuscito',
  loading: 'Preparazione dell’anteprima…',
  pageAlt: (n: number, total: number) => `Pagina ${n} di ${total}`,
  failedTitle: 'Non è stato possibile aggiornare l’anteprima',
  failedBody:
    'Le pagine mostrate sono dell’ultima anteprima riuscita. Le tue modifiche sono conservate e puoi ancora salvare.',
  failedFirstBody: 'Non c’è ancora un’anteprima. Le tue modifiche sono conservate e puoi ancora salvare.',
  retry: 'Riprova',
  close: 'Chiudi l’anteprima',
}

export const preview = { en, it }
