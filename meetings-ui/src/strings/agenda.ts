/** Copy for the agenda card, the Edit agenda dialog, the new-meeting agenda and the recorder widget's agenda. */
const en = {
  card: {
    title: 'Agenda',
    listLabel: 'Agenda points',
    edit: 'Edit agenda',
    add: 'Add agenda',
    emptyEditor: 'No agenda yet. Add the points you want to cover, so everyone follows the same list.',
    emptyReader: 'This meeting has no agenda.',
    progress: (covered: number, total: number) => `${covered} of ${total} covered`,
    covered: 'Covered',
    notCovered: 'Not covered',
    /** The checkbox's accessible name: the point's position and title. */
    tickLabel: (n: number, title: string) => `Point ${n}: ${title}`,
    saved: 'Agenda saved',
    loading: 'Loading the agenda…',
    loadFailed: 'The agenda could not be loaded.',
    reload: 'Reload agenda',
  },
  dialog: {
    title: 'Edit agenda',
    description:
      'Everyone who can open this meeting sees the agenda. A summary can follow it, one section per point.',
    save: 'Save agenda',
    saving: 'Saving…',
    sections: {
      legend: 'Points',
      hint: 'Up to 30 points. Each has a title of up to 80 characters and an optional note of up to 500.',
      item: (n: number) => `Point ${n}`,
      headingLabel: (n: number) => `Title (${n})`,
      bodyLabel: (n: number) => `Note (${n}, optional)`,
      moveUp: (n: number) => `Move point ${n} up`,
      moveDown: (n: number) => `Move point ${n} down`,
      remove: (n: number) => `Remove point ${n}`,
      add: 'Add point',
    },
    errors: {
      titleRequired: 'Enter a title.',
      titleTooLong: 'Use at most 80 characters.',
      noteTooLong: 'Use at most 500 characters.',
    },
  },
  newMeeting: {
    legend: 'Agenda',
    hint: 'Optional. Up to 30 points; you and the participants can change it later.',
  },
  dock: {
    show: 'Show agenda',
    hide: 'Hide agenda',
    progress: (covered: number, total: number) => `Agenda: ${covered} of ${total} covered`,
  },
  summary: {
    followAgenda: 'Follow the agenda',
    followAgendaHint: 'The AI uses the agenda to look for its points and report them in order, inside this template’s sections.',
    basedOn: 'Follows the agenda',
    agendaUsed: 'Agenda used',
  },
}

const it: typeof en = {
  card: {
    title: 'Scaletta',
    listLabel: 'Punti della scaletta',
    edit: 'Modifica scaletta',
    add: 'Aggiungi scaletta',
    emptyEditor: 'Nessuna scaletta. Aggiungi i punti da trattare, così tutti seguono la stessa lista.',
    emptyReader: 'Questa riunione non ha una scaletta.',
    progress: (covered, total) => `${covered} di ${total} trattati`,
    covered: 'Trattato',
    notCovered: 'Non trattato',
    tickLabel: (n, title) => `Punto ${n}: ${title}`,
    saved: 'Scaletta salvata',
    loading: 'Caricamento della scaletta…',
    loadFailed: 'Non è stato possibile caricare la scaletta.',
    reload: 'Ricarica scaletta',
  },
  dialog: {
    title: 'Modifica scaletta',
    description:
      'Chiunque può aprire questa riunione vede la scaletta. Un riassunto può seguirla, con una sezione per punto.',
    save: 'Salva scaletta',
    saving: 'Salvataggio…',
    sections: {
      legend: 'Punti',
      hint: 'Fino a 30 punti. Ognuno ha un titolo di al massimo 80 caratteri e una nota facoltativa di al massimo 500.',
      item: (n) => `Punto ${n}`,
      headingLabel: (n) => `Titolo (${n})`,
      bodyLabel: (n) => `Nota (${n}, facoltativa)`,
      moveUp: (n) => `Sposta su il punto ${n}`,
      moveDown: (n) => `Sposta giù il punto ${n}`,
      remove: (n) => `Rimuovi il punto ${n}`,
      add: 'Aggiungi punto',
    },
    errors: {
      titleRequired: 'Inserisci un titolo.',
      titleTooLong: 'Usa al massimo 80 caratteri.',
      noteTooLong: 'Usa al massimo 500 caratteri.',
    },
  },
  newMeeting: {
    legend: 'Scaletta',
    hint: 'Facoltativa. Fino a 30 punti; tu e i partecipanti potrete modificarla in seguito.',
  },
  dock: {
    show: 'Mostra scaletta',
    hide: 'Nascondi scaletta',
    progress: (covered, total) => `Scaletta: ${covered} di ${total} trattati`,
  },
  summary: {
    followAgenda: 'Segui la scaletta',
    followAgendaHint: 'L’AI usa la scaletta per cercarne i punti e riportarli in ordine, dentro le sezioni di questo template.',
    basedOn: 'Segue la scaletta',
    agendaUsed: 'Scaletta usata',
  },
}

export const agenda = { en, it }
