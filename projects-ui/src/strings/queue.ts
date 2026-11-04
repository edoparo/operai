/** The to-start queue (T12) and taking a deal from it (T13). */
import type { TakeRefusal } from '../lib/errors'

const en = {
  heading: 'To start',
  description: 'Won deals no project has taken yet. Take one to start the work.',
  caption: 'Deals to start',
  filters: 'Filters',
  searchHint: 'Part of a deal title or a company name',
  entity: 'Entity',
  loading: 'Loading the deals to start…',
  emptyTitle: 'Nothing waiting to start',
  emptyBody: 'Every won deal has a project. A deal appears here as soon as it is won in the CRM.',
  noMatchTitle: 'No deal matches these filters',
  noMatchBody: 'Try a different search or clear a filter.',
  truncated: 'There are more deals than can be listed: showing the newest 500. Search or filter to find an older one.',
  crmUnavailable: {
    title: 'The CRM cannot be reached',
    body: 'The deals to start are read from the CRM, which does not answer right now. Try again in a moment.',
  },
  companyUnavailable: 'Company unavailable',
  columns: {
    deal: 'Deal',
    company: 'Company',
    entity: 'Entity',
    won: 'Won',
    estimate: 'Estimate',
  },
  take: {
    actions: {
      column: 'Actions',
      newProject: 'New project',
      newProjectFor: (title: string) => `New project: ${title}`,
      attach: 'Attach to project',
      attachFor: (title: string) => `Attach to project: ${title}`,
    },
    project: {
      title: 'New project from a deal',
      description: (company: string, entity: string) =>
        `A planned project for ${company} (${entity}) with one contract made from this deal. The company and the entity come from the deal.`,
      typeHint: 'The kind of work. It cannot be changed once the project exists.',
      submit: 'Create project',
      busy: 'Creating…',
    },
    attach: {
      title: 'Attach to a project',
      description: (deal: string, company: string) =>
        `Adds a contract made from ${deal} (${company}) to an existing project. It cannot be detached or moved afterwards.`,
      project: 'Project',
      projectHint: 'Search by name. A project that cannot take this deal’s contract is refused with the reason.',
      projectRequired: 'Choose a project from the list.',
      chooseProject: 'Choose a project to see the terms of its contract.',
      searching: 'Searching…',
      noMatch: 'No project matches.',
      results: (count: number) => (count === 1 ? '1 project' : `${count} projects`),
      submit: 'Attach deal',
      busy: 'Attaching…',
    },
    contract: {
      legend: 'Contract',
      estimatedManDaysFromEstimate: 'From the estimate',
    },
    /** Each refusal of taking a deal, in its own words (AC-1.5). */
    errors: {
      deal_not_found: 'This deal no longer exists in the CRM.',
      deal_not_won: 'This deal is no longer won in the CRM, so it cannot be taken.',
      deal_taken: 'A project has just taken this deal.',
      out_of_scope: 'You may not take deals of this entity.',
      not_project_user: 'This person has no access to Projects. Choose someone who does.',
      contracts_not_allowed: 'An internal project takes no contracts.',
      project_not_open: 'A closed or cancelled project takes no new contract. Reopen it first.',
      company_mismatch:
        'A client project takes contracts for its own company only. Choose a project of this deal’s company.',
      estimated_man_days_from_estimate:
        'The estimated man-days come from the deal’s estimate and cannot be entered here.',
      crm_unavailable: 'The CRM cannot be reached right now. Try again in a moment.',
      estimai_unavailable:
        'EstimAI cannot be reached right now, so the estimate’s man-days could not be read. Nothing was created. Try again in a moment.',
      estimai_unconfigured:
        'EstimAI is not set up for Projects, so the estimate’s man-days could not be read. Nothing was created. Ask an administrator.',
    } as Record<TakeRefusal, string>,
  },
}

const it: typeof en = {
  heading: 'Da avviare',
  description:
    'Le trattative vinte che nessun progetto ha ancora preso in carico. Prendine una per far partire il lavoro.',
  caption: 'Trattative da avviare',
  filters: 'Filtri',
  searchHint: 'Parte del titolo di una trattativa o del nome di un’azienda',
  entity: 'Entità',
  loading: 'Caricamento delle trattative da avviare…',
  emptyTitle: 'Niente in attesa di avvio',
  emptyBody: 'Ogni trattativa vinta ha un progetto. Una trattativa compare qui appena viene vinta nel CRM.',
  noMatchTitle: 'Nessuna trattativa corrisponde ai filtri',
  noMatchBody: 'Prova una ricerca diversa o togli un filtro.',
  truncated:
    'Le trattative sono più di quelle elencabili: sono mostrate le 500 più recenti. Cerca o filtra per trovarne una più vecchia.',
  crmUnavailable: {
    title: 'Impossibile raggiungere il CRM',
    body: 'Le trattative da avviare sono lette dal CRM, che al momento non risponde. Riprova tra un attimo.',
  },
  companyUnavailable: 'Azienda non disponibile',
  columns: {
    deal: 'Trattativa',
    company: 'Azienda',
    entity: 'Entità',
    won: 'Vinta il',
    estimate: 'Stima',
  },
  take: {
    actions: {
      column: 'Azioni',
      newProject: 'Nuovo progetto',
      newProjectFor: (title: string) => `Nuovo progetto: ${title}`,
      attach: 'Collega a un progetto',
      attachFor: (title: string) => `Collega a un progetto: ${title}`,
    },
    project: {
      title: 'Nuovo progetto da una trattativa',
      description: (company: string, entity: string) =>
        `Un progetto pianificato per ${company} (${entity}) con un contratto creato da questa trattativa. L’azienda e l’entità vengono dalla trattativa.`,
      typeHint: 'Il tipo di lavoro. Non si può cambiare dopo la creazione del progetto.',
      submit: 'Crea progetto',
      busy: 'Creazione…',
    },
    attach: {
      title: 'Collega a un progetto',
      description: (deal: string, company: string) =>
        `Aggiunge a un progetto esistente un contratto creato da ${deal} (${company}). Dopo non si può scollegare né spostare.`,
      project: 'Progetto',
      projectHint:
        'Cerca per nome. Un progetto che non può accogliere il contratto di questa trattativa viene rifiutato con il motivo.',
      projectRequired: 'Scegli un progetto dall’elenco.',
      chooseProject: 'Scegli un progetto per vedere le condizioni del suo contratto.',
      searching: 'Ricerca…',
      noMatch: 'Nessun progetto corrisponde.',
      results: (count: number) => (count === 1 ? '1 progetto' : `${count} progetti`),
      submit: 'Collega trattativa',
      busy: 'Collegamento…',
    },
    contract: {
      legend: 'Contratto',
      estimatedManDaysFromEstimate: 'Dalla stima',
    },
    errors: {
      deal_not_found: 'Questa trattativa non esiste più nel CRM.',
      deal_not_won: 'Questa trattativa non è più vinta nel CRM, quindi non può essere presa in carico.',
      deal_taken: 'Un progetto ha appena preso in carico questa trattativa.',
      out_of_scope: 'Non puoi prendere in carico trattative di questa entità.',
      not_project_user: 'Questa persona non ha accesso a Progetti. Scegline una che ce l’ha.',
      contracts_not_allowed: 'Un progetto interno non ha contratti.',
      project_not_open: 'Un progetto chiuso o annullato non accetta nuovi contratti. Riaprilo prima.',
      company_mismatch:
        'Un progetto cliente accetta contratti solo della propria azienda. Scegli un progetto dell’azienda di questa trattativa.',
      estimated_man_days_from_estimate:
        'I giorni-uomo stimati arrivano dalla stima della trattativa e non si inseriscono qui.',
      crm_unavailable: 'Al momento non è possibile raggiungere il CRM. Riprova tra un attimo.',
      estimai_unavailable:
        'Al momento non è possibile raggiungere EstimAI, quindi i giorni-uomo della stima non si sono potuti leggere. Non è stato creato nulla. Riprova tra un attimo.',
      estimai_unconfigured:
        'EstimAI non è configurato per Progetti, quindi i giorni-uomo della stima non si sono potuti leggere. Non è stato creato nulla. Chiedi a un amministratore.',
    },
  },
}

export const queue = { en, it }
