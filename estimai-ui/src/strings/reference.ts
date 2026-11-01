/**
 * strings.help — the model reference drawer, and strings.shortcuts — the
 * keyboard shortcuts dialog. Glossary terms are the domain's code words
 * (AGENTS.md § Domain language) and stay as written in both languages.
 */
export const enHelp = {
  title: 'Model reference',
  subtitle: 'Formulas, calculation chain, glossary',
  close: 'Close',
  chain: {
    heading: 'Calculation chain',
    rows: [
      { term: 'PERT', formula: '= (O + 4×ML + P) / 6' },
      { term: 'Expected', formula: '= PERT + risk buffer' },
      { term: 'Individual M/D', formula: '= Σ Expected + QA deploy + QA test + PM' },
      { term: 'Planning', formula: '= FTE × (Individual / Sprint) / 8' },
      { term: 'Baseline', formula: '= Individual + Planning' },
      { term: 'Elapsed days', formula: '= ROUND(Baseline × (1 − Parallel × (FTE−1) / FTE))' },
      { term: 'Total man-days', formula: '= Elapsed × FTE' },
      { term: 'Months', formula: '= Elapsed / Working days per month' },
    ],
    note: 'PERT is intermediate only — the Summary uses Expected, not PERT.',
  },
  ai: {
    heading: 'AI columns',
    rows: [
      { term: 'AI-assisted days', formula: '= Expected × (1 − AI gain)' },
      { term: 'AI cost', formula: '= Coefficient × FTE × Elapsed days' },
    ],
    note: 'Resolved per activity (activity override, then the global default). The same pipeline gives the AI elapsed days and total M/D.',
  },
  confidence: {
    heading: 'Confidence range',
    rows: [
      { term: 'Best case', formula: '= full chain on Optimistic estimates' },
      { term: 'Worst case', formula: '= full chain on Pessimistic estimates' },
    ],
    note: 'When only ML is entered: O = ML × 0.75, P = ML × 1.60',
  },
  glossary: {
    heading: 'Glossary',
    entries: [
      { term: 'estimate', definition: 'Top-level document: project + releases + activities' },
      { term: 'release', definition: 'Delivery milestone with a name and FTE count' },
      { term: 'activity', definition: 'Single unit of work — belongs to an epic and a release' },
      { term: 'epic', definition: 'Feature group containing multiple activities' },
      { term: 'profile', definition: 'Specialist role required (e.g. Backend Dev, Designer)' },
      { term: 'elapsed', definition: 'Calendar days for a release after parallelism adjustment' },
      { term: 'man/days', definition: 'Total person-days — elapsed × FTE' },
      {
        term: 'ai_gain',
        definition: 'Fractional productivity improvement from AI tools (0–1). e.g. 0.30 = 30% effort reduction',
      },
    ],
  },
}

export const itHelp: typeof enHelp = {
  title: 'Guida al modello',
  subtitle: 'Formule, catena di calcolo, glossario',
  close: 'Chiudi',
  chain: {
    heading: 'Catena di calcolo',
    rows: [
      { term: 'PERT', formula: '= (O + 4×ML + P) / 6' },
      { term: 'Atteso', formula: '= PERT + margine di rischio' },
      { term: 'G/U individuali', formula: '= Σ Atteso + QA deploy + QA test + PM' },
      { term: 'Pianificazione', formula: '= FTE × (Individuali / Sprint) / 8' },
      { term: 'Base', formula: '= Individuali + Pianificazione' },
      { term: 'Giorni di durata', formula: '= ARROTONDA(Base × (1 − Parallelismo × (FTE−1) / FTE))' },
      { term: 'Giorni/uomo totali', formula: '= Durata × FTE' },
      { term: 'Mesi', formula: '= Durata / Giorni lavorativi al mese' },
    ],
    note: 'PERT è solo un valore intermedio: il Riepilogo usa Atteso, non PERT.',
  },
  ai: {
    heading: 'Colonne AI',
    rows: [
      { term: 'Giorni con AI', formula: '= Atteso × (1 − guadagno AI)' },
      { term: 'Costo AI', formula: '= Coefficiente × FTE × Giorni di durata' },
    ],
    note: "Calcolato per attività (valore dell'attività, altrimenti quello globale). Lo stesso calcolo produce la durata e i G/U totali con AI.",
  },
  confidence: {
    heading: 'Intervallo di confidenza',
    rows: [
      { term: 'Caso migliore', formula: '= intera catena sulle stime ottimistiche' },
      { term: 'Caso peggiore', formula: '= intera catena sulle stime pessimistiche' },
    ],
    note: 'Se è indicato solo ML: O = ML × 0,75, P = ML × 1,60',
  },
  glossary: {
    heading: 'Glossario',
    entries: [
      { term: 'estimate', definition: 'Documento principale: progetto + rilasci + attività' },
      { term: 'release', definition: 'Traguardo di consegna con un nome e un numero di FTE' },
      { term: 'activity', definition: "Singola unità di lavoro, appartiene a un'epic e a un rilascio" },
      { term: 'epic', definition: 'Gruppo funzionale che contiene più attività' },
      { term: 'profile', definition: 'Ruolo specialistico richiesto (es. Backend Dev, Designer)' },
      { term: 'elapsed', definition: 'Giorni di calendario di un rilascio dopo il parallelismo' },
      { term: 'man/days', definition: 'Giorni/uomo totali: durata × FTE' },
      {
        term: 'ai_gain',
        definition: "Miglioramento di produttività dovuto all'AI (0–1). Es. 0,30 = 30% di impegno in meno",
      },
    ],
  },
}

export const enShortcuts = {
  title: 'Keyboard shortcuts',
  close: 'Close',
  gridHeading: 'Grid navigation',
  generalHeading: 'General',
  keys: {
    tab: 'Tab',
    shift: 'Shift',
    enter: 'Enter',
    esc: 'Esc',
    up: 'Up arrow',
    down: 'Down arrow',
    left: 'Left arrow',
    right: 'Right arrow',
  },
  rows: {
    nextPrevCell: 'Next / previous cell',
    down: 'Move down one row',
    up: 'Move up one row',
    sideways: 'Move right / left (number and select always; text at the edge)',
    togglePanel: 'Toggle this shortcuts panel',
    toggleHealth: 'Toggle health warnings',
    newActivity: 'Create new activity',
    closePanel: 'Close panel',
  },
}

export const itShortcuts: typeof enShortcuts = {
  title: 'Scorciatoie da tastiera',
  close: 'Chiudi',
  gridHeading: 'Navigazione nella griglia',
  generalHeading: 'Generali',
  keys: {
    tab: 'Tab',
    shift: 'Maiusc',
    enter: 'Invio',
    esc: 'Esc',
    up: 'Freccia su',
    down: 'Freccia giù',
    left: 'Freccia sinistra',
    right: 'Freccia destra',
  },
  rows: {
    nextPrevCell: 'Cella successiva / precedente',
    down: 'Scendi di una riga',
    up: 'Sali di una riga',
    sideways: 'Sposta a destra / sinistra (numeri e selezioni sempre; testo al bordo)',
    togglePanel: 'Mostra o nascondi questo pannello',
    toggleHealth: 'Mostra o nascondi gli avvisi',
    newActivity: 'Crea una nuova attività',
    closePanel: 'Chiudi il pannello',
  },
}
