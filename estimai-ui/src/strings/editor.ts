/**
 * strings.editor — the estimate editor's frame: the sticky header (back link,
 * name, save state), the view tabs, the toolbar, the save feedback and the
 * names the editor gives to a new activity or release.
 */
export const en = {
  /** The page's h1 (visually hidden: the sticky header has no room for it). */
  heading: (name: string) => (name ? `EstimAI — ${name}` : 'EstimAI — untitled estimate'),
  backToEstimates: 'Back to estimates',
  nameLabel: 'Estimate name',
  namePlaceholder: 'Project name…',
  saving: 'Saving…',
  saveFailed: 'Save failed',
  saved: 'Saved',
  savedToast: 'Changes stored',
  saveErrors: {
    tooLarge: 'This estimate is too large to save. Remove some activities to reduce its size.',
    status: (status: string) => `Save failed (${status}). Your work is safe in this tab.`,
    network: 'Save failed. Check your connection. Your work is safe in this tab.',
  },
  tabsLabel: 'Estimate sections',
  tabActivities: 'Activities',
  tabSummary: 'Summary',
  tabParameters: 'Parameters',
  tabWarnings: (n: number) => (n === 1 ? '1 health warning' : `${n} health warnings`),
  manageCollaborators: 'Manage collaborators',
  viewCollaboration: 'View collaboration details',
  exportClient: 'Export for client',
  exportClientTitle: 'Clean export for the client — no internal details',
  exportPdf: 'Export PDF',
  exportPdfTitle: 'Export a PDF with the summary, the timeline and the activities',
  exportExcel: 'Export Excel',
  modelReference: 'Model reference',
  shortcuts: 'Shortcuts',
  shortcutsKey: 'Shift ?',
  shortcutsTitle: 'Keyboard shortcuts (Shift+?)',
  deleteReleaseTitle: 'Delete release?',
  deleteReleaseBody: (label: string, count: number) =>
    count > 0 ? `Delete "${label}" and its ${count} ${count === 1 ? 'activity' : 'activities'}?` : `Delete "${label}"?`,
  thisRelease: 'this release',
  dismiss: 'Dismiss',
  saveAsCopyFailed: 'Could not save a copy. Try again, or reload the latest version.',
  /** Names the editor writes into the estimate document for a new row. */
  defaults: {
    activityName: 'New activity',
    releaseName: (n: number) => `Release ${n}`,
  },
}

export const it: typeof en = {
  heading: (name) => (name ? `EstimAI — ${name}` : 'EstimAI — stima senza titolo'),
  backToEstimates: 'Torna alle stime',
  nameLabel: 'Nome della stima',
  namePlaceholder: 'Nome del progetto…',
  saving: 'Salvataggio…',
  saveFailed: 'Salvataggio non riuscito',
  saved: 'Salvato',
  savedToast: 'Modifiche salvate',
  saveErrors: {
    tooLarge: 'La stima è troppo grande per essere salvata. Rimuovere alcune attività per ridurne la dimensione.',
    status: (status) => `Salvataggio non riuscito (${status}). Il lavoro in questa scheda è al sicuro.`,
    network: 'Salvataggio non riuscito. Verificare la connessione. Il lavoro in questa scheda è al sicuro.',
  },
  tabsLabel: 'Sezioni della stima',
  tabActivities: 'Attività',
  tabSummary: 'Riepilogo',
  tabParameters: 'Parametri',
  tabWarnings: (n) => (n === 1 ? '1 avviso' : `${n} avvisi`),
  manageCollaborators: 'Gestisci collaboratori',
  viewCollaboration: 'Dettagli della condivisione',
  exportClient: 'Esporta per il cliente',
  exportClientTitle: 'Esportazione pulita per il cliente, senza dettagli interni',
  exportPdf: 'Esporta PDF',
  exportPdfTitle: 'Esporta un PDF con riepilogo, cronologia e attività',
  exportExcel: 'Esporta Excel',
  modelReference: 'Guida al modello',
  shortcuts: 'Scorciatoie',
  shortcutsKey: 'Maiusc ?',
  shortcutsTitle: 'Scorciatoie da tastiera (Maiusc+?)',
  deleteReleaseTitle: 'Eliminare il rilascio?',
  deleteReleaseBody: (label, count) =>
    count > 0
      ? `Eliminare "${label}" e ${count === 1 ? 'la sua attività' : `le sue ${count} attività`}?`
      : `Eliminare "${label}"?`,
  thisRelease: 'questo rilascio',
  dismiss: 'Chiudi',
  saveAsCopyFailed: "Impossibile salvare una copia. Riprovare o ricaricare l'ultima versione.",
  defaults: {
    activityName: 'Nuova attività',
    releaseName: (n) => `Rilascio ${n}`,
  },
}
