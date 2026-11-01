/** strings.health — the health warnings: their copy, the badge and the dialog. */
export const en = {
  title: 'Health warnings',
  close: 'Close',
  countLabel: (n: number) => (n === 1 ? '1 warning' : `${n} warnings`),
  allClear: 'All clear — no warnings',
  allClearBody: 'Every activity and release looks healthy.',
  activitiesSection: (n: number) => `Activities (${n})`,
  releasesSection: (n: number) => `Releases (${n})`,
  activityCaption: 'Activity warnings',
  releaseCaption: 'Release warnings',
  columns: { num: '#', activity: 'Activity', release: 'Release', warning: 'Warning' },
  unnamed: '(unnamed)',
  badgeLabel: (title: string, description: string) => `Warning: ${title}. ${description}`,
  codes: {
    noProfile: {
      title: 'No profile assigned',
      description:
        'This activity has no specialist profile (e.g. Backend Dev, Designer). Assign one so the effort is attributed to the right role.',
    },
    highRisk: {
      title: 'Risk buffer exceeds the PERT estimate',
      description:
        'The risk buffer is larger than the activity’s own PERT estimate — over half of the expected effort is contingency. Re-check the optimistic / most-likely / pessimistic values, or split the activity to reduce uncertainty.',
    },
    noActivities: {
      title: 'Release has no activities',
      description:
        'No activities are linked to this release, so it contributes nothing to the estimate. Add activities to it, or remove the empty release.',
    },
    wideRange: {
      title: 'Worst case is more than 2× the best case',
      description:
        'The pessimistic total is more than double the optimistic total, signalling high uncertainty in this release. Tighten the estimates or break large activities into smaller ones.',
    },
  },
}

export const it: typeof en = {
  title: 'Avvisi',
  close: 'Chiudi',
  countLabel: (n) => (n === 1 ? '1 avviso' : `${n} avvisi`),
  allClear: 'Tutto in ordine — nessun avviso',
  allClearBody: 'Tutte le attività e i rilasci risultano corretti.',
  activitiesSection: (n) => `Attività (${n})`,
  releasesSection: (n) => `Rilasci (${n})`,
  activityCaption: 'Avvisi sulle attività',
  releaseCaption: 'Avvisi sui rilasci',
  columns: { num: '#', activity: 'Attività', release: 'Rilascio', warning: 'Avviso' },
  unnamed: '(senza nome)',
  badgeLabel: (title, description) => `Avviso: ${title}. ${description}`,
  codes: {
    noProfile: {
      title: 'Nessun profilo assegnato',
      description:
        "L'attività non ha un profilo specialistico (es. Backend Dev, Designer). Assegnarne uno perché l'impegno sia attribuito al ruolo corretto.",
    },
    highRisk: {
      title: 'Il margine di rischio supera la stima PERT',
      description:
        "Il margine di rischio è maggiore della stima PERT dell'attività: oltre metà dell'impegno atteso è contingenza. Ricontrollare i valori ottimistico / più probabile / pessimistico, o suddividere l'attività per ridurre l'incertezza.",
    },
    noActivities: {
      title: 'Il rilascio non ha attività',
      description:
        'Nessuna attività è collegata a questo rilascio, quindi non contribuisce alla stima. Aggiungere attività o rimuovere il rilascio vuoto.',
    },
    wideRange: {
      title: 'Il caso peggiore supera il doppio del migliore',
      description:
        "Il totale pessimistico è più del doppio di quello ottimistico: segnala un'alta incertezza in questo rilascio. Affinare le stime o suddividere le attività più grandi.",
    },
  },
}
