/** strings.parameters — the Parameters view: the model's eight inputs. */
export const en = {
  heading: 'Model parameters',
  fields: {
    parallelism: { label: 'Parallelism factor', hint: '% of work runnable in parallel with FTE > 1' },
    sprintDays: { label: 'Sprint duration (working days)', hint: 'Drives planning/ceremony overhead calculation' },
    workingDaysMonth: { label: 'Working days per month', hint: 'Converts elapsed days into months' },
    qaDeployDays: { label: 'QA deploy per release (days)', hint: 'Fixed deployment cost per release' },
    qaTestDays: { label: 'QA test per release (days)', hint: 'Fixed QA testing cost per release' },
    pmDays: { label: 'PM / demand management per release (days)', hint: 'Project management overhead per release' },
    aiCostCoef: {
      label: 'AI cost coefficient',
      hint: 'Cost per FTE per elapsed day (licences + infra). Default: 10.',
    },
    aiGain: {
      label: 'AI productivity gain',
      hint: 'Fraction of effort saved using AI tools (0.0–1.0). Default: 0.30 = 30%.',
    },
  },
}

export const it: typeof en = {
  heading: 'Parametri del modello',
  fields: {
    parallelism: { label: 'Fattore di parallelismo', hint: '% del lavoro eseguibile in parallelo con FTE > 1' },
    sprintDays: {
      label: 'Durata dello sprint (giorni lavorativi)',
      hint: 'Determina il costo di pianificazione e delle cerimonie',
    },
    workingDaysMonth: { label: 'Giorni lavorativi al mese', hint: 'Converte i giorni di durata in mesi' },
    qaDeployDays: { label: 'QA deploy per rilascio (giorni)', hint: 'Costo fisso di deploy per rilascio' },
    qaTestDays: { label: 'QA test per rilascio (giorni)', hint: 'Costo fisso di test QA per rilascio' },
    pmDays: {
      label: 'PM / gestione della domanda per rilascio (giorni)',
      hint: 'Costo di project management per rilascio',
    },
    aiCostCoef: {
      label: 'Coefficiente di costo AI',
      hint: 'Costo per FTE per giorno di durata (licenze + infrastruttura). Predefinito: 10.',
    },
    aiGain: {
      label: 'Guadagno di produttività AI',
      hint: "Quota dell'impegno risparmiata con gli strumenti AI (0,0–1,0). Predefinito: 0,30 = 30%.",
    },
  },
}
