/** The deal page's Estimate card: request, state, hand-over and the gate override (specs/018 US-3). */
const en = {
  title: 'Technical estimate',
  none: 'No technical estimate has been requested for this deal.',
  noneHint: 'Moving a deal to offer in preparation or later needs a ready estimate.',
  noneLate: 'This deal is past the qualification stage, so an estimate can no longer be requested.',
  request: 'Request estimate',
  requestDialog: {
    title: 'Request a technical estimate',
    description: 'An estimate is created in EstimAI and shared with the technical contact, who gets a task.',
    technician: 'Technical contact',
    pickRequired: 'Choose a person from the list.',
    submit: 'Request estimate',
    busy: 'Requesting…',
  },
  facts: {
    name: 'Estimate',
    technical: 'Technical contact',
    state: 'State',
    requested: 'Requested',
    ready: 'Ready since',
    requestedBy: (name: string, date: string) => `${date} by ${name}`,
  },
  open: 'Go to the estimate',
  stateHint: {
    requested: 'The technical contact is still working on it. It becomes ready when they close it in EstimAI; until then the deal cannot move to offer in preparation.',
    ready: 'Closed in EstimAI: the deal can move to offer in preparation and an offer can be generated. To change it, reopen it in EstimAI.',
  },
  unlink: 'Unlink',
  override: 'Proceed without estimate',
  overrideTooltip:
    'Admins only. Lets this deal move to offer in preparation, offer sent or won without a ready estimate. You give a reason, which stays on the deal and in its timeline.',
  working: 'Working…',
  unlinkDialog: {
    title: 'Unlink the estimate?',
    body: 'The deal loses its link to this estimate. The estimate itself stays in EstimAI. A new one can be requested afterwards.',
    confirm: 'Unlink',
    busy: 'Unlinking…',
  },
  overrideDialog: {
    title: 'Proceed without a ready estimate',
    description: 'Lets this deal move past qualification without a ready estimate. Who did it and why is kept on the deal.',
    reason: 'Reason',
    reasonHint: 'Required. Shown on the deal and in its timeline.',
    submit: 'Proceed without estimate',
    busy: 'Overriding…',
  },
  overrideShown: (name: string, date: string) => `Estimate gate overridden by ${name} on ${date}.`,
  overrideReason: 'Reason',
  done: {
    requested: 'Estimate requested.',
    unlinked: 'Estimate unlinked.',
    overridden: 'Estimate gate overridden.',
  },
  errors: {
    estimaiAccessRequired: 'You need access to EstimAI to request an estimate. Ask an administrator to grant it.',
    estimaiUnavailable: 'EstimAI is not reachable right now. Try again shortly.',
    estimaiUnconfigured: 'EstimAI is not connected to the CRM yet. Ask an administrator.',
    estimateExists: 'This deal already has an estimate. Reload the page.',
    notOpen: 'An estimate can be requested only while the deal is a lead or qualified.',
    technicianNotEstimai: 'This person cannot use EstimAI. Choose someone else or ask an administrator to grant access.',
    technicianNotCrm: 'This person does not have access to the CRM. Choose someone else.',
  },
  gate: {
    title: (deal: string) => `“${deal}” cannot move yet`,
    openDeal: 'Open the deal',
  },
}

const it: typeof en = {
  title: 'Stima tecnica',
  none: 'Per questa opportunità non è stata richiesta nessuna stima tecnica.',
  noneHint: "Per passare a offerta in preparazione o oltre serve una stima pronta.",
  noneLate: "Questa opportunità ha superato la fase di qualificazione: non si può più richiedere una stima.",
  request: 'Richiedi stima',
  requestDialog: {
    title: 'Richiedi una stima tecnica',
    description: 'La stima viene creata in EstimAI e condivisa con il referente tecnico, che riceve un’attività.',
    technician: 'Referente tecnico',
    pickRequired: "Scegli una persona dall'elenco.",
    submit: 'Richiedi stima',
    busy: 'Richiesta in corso…',
  },
  facts: {
    name: 'Stima',
    technical: 'Referente tecnico',
    state: 'Stato',
    requested: 'Richiesta',
    ready: 'Pronta dal',
    requestedBy: (name: string, date: string) => `${date} da ${name}`,
  },
  open: 'Vai alla stima',
  stateHint: {
    requested: "Il referente tecnico ci sta ancora lavorando. Diventa pronta quando la chiude in EstimAI; fino ad allora l'opportunità non può passare a offerta in preparazione.",
    ready: "Chiusa in EstimAI: l'opportunità può passare a offerta in preparazione e si può generare un'offerta. Per modificarla, riaprila in EstimAI.",
  },
  unlink: 'Scollega',
  override: 'Procedi senza stima',
  overrideTooltip:
    "Solo per gli amministratori. Permette a questa opportunità di passare a offerta in preparazione, offerta inviata o vinta senza una stima pronta. Indichi un motivo, che resta sull'opportunità e nella cronologia.",
  working: 'Operazione in corso…',
  unlinkDialog: {
    title: 'Scollegare la stima?',
    body: "L'opportunità perde il collegamento con questa stima. La stima resta in EstimAI. Dopo se ne può richiedere una nuova.",
    confirm: 'Scollega',
    busy: 'Scollegamento…',
  },
  overrideDialog: {
    title: 'Procedi senza una stima pronta',
    description:
      "Permette a questa opportunità di superare la qualificazione senza una stima pronta. Chi lo ha fatto e perché resta sull'opportunità.",
    reason: 'Motivo',
    reasonHint: "Obbligatorio. Mostrato sull'opportunità e nella cronologia.",
    submit: 'Procedi senza stima',
    busy: 'Operazione in corso…',
  },
  overrideShown: (name: string, date: string) => `Controllo sulla stima forzato da ${name} il ${date}.`,
  overrideReason: 'Motivo',
  done: {
    requested: 'Stima richiesta.',
    unlinked: 'Stima scollegata.',
    overridden: 'Controllo sulla stima forzato.',
  },
  errors: {
    estimaiAccessRequired: "Ti serve l'accesso a EstimAI per richiedere una stima. Chiedi a un amministratore di concederlo.",
    estimaiUnavailable: 'EstimAI al momento non è raggiungibile. Riprova tra poco.',
    estimaiUnconfigured: 'EstimAI non è ancora collegato al CRM. Chiedi a un amministratore.',
    estimateExists: "Questa opportunità ha già una stima. Ricarica la pagina.",
    notOpen: "Si può richiedere una stima solo finché l'opportunità è un contatto o qualificata.",
    technicianNotEstimai: "Questa persona non può usare EstimAI. Scegline un'altra o chiedi a un amministratore di concedere l'accesso.",
    technicianNotCrm: "Questa persona non ha accesso al CRM. Scegline un'altra.",
  },
  gate: {
    title: (deal: string) => `«${deal}» non può ancora avanzare`,
    openDeal: "Apri l'opportunità",
  },
}

export const estimate = { en, it }
