/** The save bar (design § Copy keys "Save, conflict, leave": `bar.*`). */
const en = {
  clean: 'No unsaved changes',
  dirty: 'Unsaved changes',
  save: (n: number) => `Save as version ${n}`,
  saving: 'Saving…',
  nothingToSave: 'No changes to save.',
  reloadFirst: 'Reload first.',
  preview: 'Preview',
}

const it: typeof en = {
  clean: 'Nessuna modifica non salvata',
  dirty: 'Modifiche non salvate',
  save: (n: number) => `Salva come versione ${n}`,
  saving: 'Salvataggio…',
  nothingToSave: 'Nessuna modifica da salvare.',
  reloadFirst: 'Ricarica prima.',
  preview: 'Anteprima',
}

export const bar = { en, it }
