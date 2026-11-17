/** A save refused because a newer version exists (design F7.4, S3; AC-4.8; § Copy keys `conflict.*`). */
const en = {
  title: 'A newer version was saved',
  body: 'Someone saved a newer version while you were editing. Your changes are still in this form but were not saved. Reload to work on their version; nothing they saved is lost.',
  reload: 'Reload and discard my changes',
  reloading: 'Reloading…',
  reloadFailed: 'The newer version could not be loaded. Your changes are still here. Try again.',
}

const it: typeof en = {
  title: 'È stata salvata una versione più recente',
  body: 'Qualcuno ha salvato una versione più recente mentre modificavi. Le tue modifiche sono ancora in questo modulo ma non sono state salvate. Ricarica per lavorare sulla loro versione; ciò che hanno salvato non va perso.',
  reload: 'Ricarica e scarta le mie modifiche',
  reloading: 'Ricaricamento…',
  reloadFailed: 'Impossibile caricare la versione più recente. Le tue modifiche sono ancora qui. Riprova.',
}

export const conflict = { en, it }
