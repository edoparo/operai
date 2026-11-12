/** Copy for the personal notes card: each person's own, private notes on a meeting, saved as they type. */
const en = {
  title: 'My notes',
  label: 'My notes on this meeting',
  hint: 'Only you can see these notes. They are not shared and the AI does not use them.',
  placeholder: 'Write as the meeting goes. Your notes save automatically.',
  count: (n: number, max: number) => `${n} of ${max} characters`,
  status: {
    saving: 'Saving…',
    saved: 'Saved',
    unsaved: 'Not saved yet',
    failed: 'Your latest changes are not saved.',
  },
  retry: 'Save now',
  conflict: {
    title: 'Saved from another tab',
    body: 'You changed these notes somewhere else meanwhile. Reload them to go on; what you typed here since the last save will be replaced.',
  },
  reload: 'Reload notes',
  toolbar: {
    toolbar: 'Formatting',
    bold: 'Bold',
    italic: 'Italic',
    heading: 'Heading',
    bulletList: 'Bulleted list',
    orderedList: 'Numbered list',
    taskList: 'Checklist',
  },
  loading: 'Loading your notes…',
  loadFailed: 'Your notes could not be loaded.',
}

const it: typeof en = {
  title: 'I miei appunti',
  label: 'I miei appunti su questa riunione',
  hint: 'Solo tu puoi vedere questi appunti. Non vengono condivisi e l’AI non li usa.',
  placeholder: 'Scrivi durante la riunione. Gli appunti si salvano da soli.',
  count: (n, max) => `${n} di ${max} caratteri`,
  status: {
    saving: 'Salvataggio…',
    saved: 'Salvato',
    unsaved: 'Non ancora salvato',
    failed: 'Le ultime modifiche non sono salvate.',
  },
  retry: 'Salva ora',
  conflict: {
    title: 'Salvati da un’altra scheda',
    body: 'Nel frattempo hai modificato questi appunti altrove. Ricaricali per continuare; quello che hai scritto qui dopo l’ultimo salvataggio verrà sostituito.',
  },
  reload: 'Ricarica appunti',
  toolbar: {
    toolbar: 'Formattazione',
    bold: 'Grassetto',
    italic: 'Corsivo',
    heading: 'Titolo',
    bulletList: 'Elenco puntato',
    orderedList: 'Elenco numerato',
    taskList: 'Checklist',
  },
  loading: 'Caricamento dei tuoi appunti…',
  loadFailed: 'Non è stato possibile caricare i tuoi appunti.',
}

export const notes = { en, it }
