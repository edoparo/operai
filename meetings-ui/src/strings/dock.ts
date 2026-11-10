/** The recorder widget (`./RecorderDock`, spec A13): always visible while a recording runs and you are elsewhere in Operai. */
const en = {
  status: {
    recording: 'Recording',
    paused: 'Paused',
    saving: 'Saving…',
    saved: 'Recording saved',
    failed: 'The recording could not be saved',
    unknown: 'Recording in progress',
  },
  elapsed: 'Elapsed time',
  levels: {
    input: 'In',
    inputLabel: 'Microphone level',
    output: 'Out',
    outputLabel: 'Shared tab level',
  },
  pause: 'Pause recording',
  resume: 'Resume recording',
  stop: 'Stop',
  open: 'Open meeting',
  close: 'Close',
  offline: 'Not saving right now: the audio is kept in this tab until the connection is back.',
  microphoneLost: 'The microphone stopped. Open the meeting to resume.',
  tabAudioLost: 'The shared tab is no longer recorded; the microphone goes on.',
}

const it: typeof en = {
  status: {
    recording: 'In registrazione',
    paused: 'In pausa',
    saving: 'Salvataggio…',
    saved: 'Registrazione salvata',
    failed: 'Non è stato possibile salvare la registrazione',
    unknown: 'Registrazione in corso',
  },
  elapsed: 'Tempo trascorso',
  levels: {
    input: 'Entra',
    inputLabel: 'Livello del microfono',
    output: 'Esce',
    outputLabel: 'Livello della scheda condivisa',
  },
  pause: 'Metti in pausa la registrazione',
  resume: 'Riprendi la registrazione',
  stop: 'Ferma',
  open: 'Apri la riunione',
  close: 'Chiudi',
  offline: 'Il salvataggio è fermo: l’audio resta in questa scheda finché torna la connessione.',
  microphoneLost: 'Il microfono si è fermato. Apri la riunione per riprendere.',
  tabAudioLost: 'La scheda condivisa non viene più registrata; il microfono continua.',
}

export const dock = { en, it }
