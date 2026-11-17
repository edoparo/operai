/** Shared labels: states, banners. Same wording as projects-ui's `common` (design § Copy keys). */
const en = {
  retry: 'Retry',
  dismiss: 'Dismiss',
  reload: 'Reload',
  networkError: 'The server could not be reached. Check your connection and try again.',
  unknownError: 'Something went wrong. Try again.',
  loadErrorTitle: 'Could not load',
  authUnavailable: {
    heading: 'Authorization service unavailable',
    body: 'We cannot verify your access right now. Nothing was changed.',
  },
  permissionDenied: {
    heading: 'You do not have access to this',
    body: 'Ask an administrator for the permission, then reload the page.',
  },
  staleWrite: {
    title: 'This record has changed',
    body: 'Someone else changed this record. Reload to see their changes, then try again.',
  },
}

const it: typeof en = {
  retry: 'Riprova',
  dismiss: 'Chiudi avviso',
  reload: 'Ricarica',
  networkError: 'Impossibile raggiungere il server. Controlla la connessione e riprova.',
  unknownError: 'Qualcosa è andato storto. Riprova.',
  loadErrorTitle: 'Caricamento non riuscito',
  authUnavailable: {
    heading: 'Servizio di autorizzazione non disponibile',
    body: 'Al momento non possiamo verificare i tuoi accessi. Non è stato modificato nulla.',
  },
  permissionDenied: {
    heading: 'Non hai accesso a questa sezione',
    body: 'Chiedi il permesso a un amministratore, poi ricarica la pagina.',
  },
  staleWrite: {
    title: 'Questo record è cambiato',
    body: 'Qualcun altro ha modificato questo record. Ricarica per vedere le modifiche, poi riprova.',
  },
}

export const common = { en, it }
