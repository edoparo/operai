/**
 * strings.lifecycle — closing and reopening an estimate. A closed estimate is
 * read-only for everybody until it is reopened, and a CRM deal linked to it
 * sees it as ready.
 */
export const en = {
  closeAction: 'Close estimate',
  closeUnsavedTitle: 'Wait until your changes are saved to close the estimate',
  reopenAction: 'Reopen',
  reopenBusy: 'Reopening…',
  confirmTitle: 'Close this estimate?',
  confirmBody:
    'A closed estimate is read-only for everybody until someone reopens it. A CRM deal linked to it will see it as ready.',
  confirmLabel: 'Close estimate',
  confirmBusy: 'Closing…',
  cancel: 'Cancel',
  close: 'Close',
  closedTitle: 'This estimate is closed',
  closedBy: (name: string, date: string) => `Closed by ${name} on ${date}.`,
  closedOn: (date: string) => `Closed on ${date}.`,
  closedReadOnly: 'It is read-only. Reopen it to make changes again.',
  closedReadOnlyViewer: 'It is read-only until the owner or an editor reopens it.',
  closedMeanwhile:
    'Someone closed this estimate while you were editing. It now shows the saved version; changes made after the last save were not kept.',
  changedMeanwhile: 'Someone changed this estimate meanwhile. It now shows the latest version; check it and try again.',
  closedConfirmation: 'Estimate closed',
  reopenedConfirmation: 'Estimate reopened — you can edit it again',
  actionFailed: (status: string) => `The estimate could not be updated (${status}). Try again.`,
  actionNetwork: 'The estimate could not be updated. Check your connection and try again.',
  statusClosed: 'Closed',
  oversightTitle: 'Read-only: admin view',
  oversightBody: (owner: string) =>
    `You can see this estimate because you may read every estimate. It is owned by ${owner}. You can export it, but not change, close or share it.`,
}

export const it: typeof en = {
  closeAction: 'Chiudi la stima',
  closeUnsavedTitle: 'Attendere il salvataggio delle modifiche per chiudere la stima',
  reopenAction: 'Riapri',
  reopenBusy: 'Riapertura…',
  confirmTitle: 'Chiudere questa stima?',
  confirmBody:
    'Una stima chiusa è di sola lettura per tutti finché qualcuno non la riapre. Un deal del CRM collegato la vedrà come pronta.',
  confirmLabel: 'Chiudi la stima',
  confirmBusy: 'Chiusura…',
  cancel: 'Annulla',
  close: 'Chiudi',
  closedTitle: 'Questa stima è chiusa',
  closedBy: (name, date) => `Chiusa da ${name} il ${date}.`,
  closedOn: (date) => `Chiusa il ${date}.`,
  closedReadOnly: 'È di sola lettura. Riaprirla per apportare nuove modifiche.',
  closedReadOnlyViewer: 'È di sola lettura finché il proprietario o un editor non la riapre.',
  closedMeanwhile:
    "Qualcuno ha chiuso questa stima durante la modifica. Ora è mostrata la versione salvata; le modifiche successive all'ultimo salvataggio non sono state mantenute.",
  changedMeanwhile: "Qualcuno ha modificato questa stima nel frattempo. Ora è mostrata l'ultima versione; verificarla e riprovare.",
  closedConfirmation: 'Stima chiusa',
  reopenedConfirmation: 'Stima riaperta: ora è di nuovo modificabile',
  actionFailed: (status) => `Impossibile aggiornare la stima (${status}). Riprovare.`,
  actionNetwork: 'Impossibile aggiornare la stima. Verificare la connessione e riprovare.',
  statusClosed: 'Chiusa',
  oversightTitle: 'Sola lettura: vista amministratore',
  oversightBody: (owner) =>
    `Questa stima è visibile perché è possibile leggere tutte le stime. Appartiene a ${owner}. È possibile esportarla, ma non modificarla, chiuderla o condividerla.`,
}
