/** strings.conflict — the optimistic-concurrency banner (specs/013, ADR-0038). */
export const en = {
  title409: (name: string) => `${name} saved changes to this estimate since you opened it.`,
  title409Unknown: 'Someone else saved changes to this estimate since you opened it.',
  title428: 'This tab needs to reload to keep saving your changes here.',
  reassurance: 'Your edits below are safe and still visible — nothing has been overwritten.',
  reloadButton: 'Reload latest',
  saveAsCopyButton: 'Save as a copy instead',
  savingSuspended: 'Not saving — reload to continue',
}

export const it: typeof en = {
  title409: (name) => `${name} ha salvato modifiche a questa stima dopo la sua apertura.`,
  title409Unknown: 'Qualcun altro ha salvato modifiche a questa stima dopo la sua apertura.',
  title428: 'Questa scheda deve essere ricaricata per continuare a salvare le modifiche.',
  reassurance: 'Le modifiche qui sotto sono al sicuro e ancora visibili: non è stato sovrascritto nulla.',
  reloadButton: "Ricarica l'ultima versione",
  saveAsCopyButton: 'Salva invece come copia',
  savingSuspended: 'Salvataggio sospeso — ricaricare per continuare',
}
