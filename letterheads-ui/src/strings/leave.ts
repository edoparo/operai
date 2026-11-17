/** Leaving with unsaved changes (design F9, AC-8.8; § Copy keys `leave.*`). */
const en = {
  title: 'Leave without saving?',
  body: (entity: string) => `You have unsaved changes to the letterhead of ${entity}. If you continue, they are lost.`,
  /** The shell's own confirmation, when the person navigates to another tool (same words as `body`). */
  message: (entity: string) =>
    `You have unsaved changes to the letterhead of ${entity}. If you continue, they are lost.`,
  keep: 'Keep editing',
  switchEntity: 'Switch and discard',
  openVersion: 'Open and discard',
  leave: 'Leave and discard',
  close: 'Close',
}

const it: typeof en = {
  title: 'Uscire senza salvare?',
  body: (entity: string) => `Hai modifiche non salvate alla carta intestata di ${entity}. Se continui, andranno perse.`,
  message: (entity: string) =>
    `Hai modifiche non salvate alla carta intestata di ${entity}. Se continui, andranno perse.`,
  keep: 'Continua a modificare',
  switchEntity: 'Cambia e scarta',
  openVersion: 'Apri e scarta',
  leave: 'Esci e scarta',
  close: 'Chiudi',
}

export const leave = { en, it }
