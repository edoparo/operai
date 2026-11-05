/** strings.accessRequests — the waiting list of people who signed in without an invitation (specs/023). */
export const en = {
  heading: 'Access requests',
  description: 'People with a wellD account who signed in without an invitation. Approve to invite them, or reject.',
  loading: 'Loading access requests',
  loadError: 'Could not load access requests.',
  catalogLoadError: 'Could not load roles and departments.',
  caption: 'Access requests',
  filterLabel: 'Filter by status',
  filter: { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' },
  columns: {
    name: 'Name',
    provider: 'Sign-in provider',
    lastAsked: 'Last asked',
    state: 'State',
    decidedBy: 'Decided by',
    decidedOn: 'Decided on',
  },
  provider: { google: 'Google', github: 'GitHub', unknown: 'Unknown' },
  empty: {
    pending: {
      title: 'No one is waiting for access',
      body: 'When a wellD colleague signs in without an invitation, they appear here and admins are notified.',
    },
    approved: { title: 'No approved requests', body: 'Requests you approve are listed here.' },
    rejected: { title: 'No rejected requests', body: 'Requests you reject are listed here.' },
  },
  approve: 'Approve',
  reject: 'Reject',
  approveLabel: (email: string) => `Approve access request from ${email}`,
  rejectLabel: (email: string) => `Reject access request from ${email}`,
  approveDialog: {
    title: 'Approve access request',
    intro: (name: string, email: string) => `${name} (${email}) will receive an invitation by email.`,
    defaultAccess:
      'If you choose no roles or departments, they join as an employee. If you choose roles, those roles replace the employee role.',
    submit: 'Approve and send invitation',
    busy: 'Approving…',
  },
  rejectDialog: {
    title: 'Reject access request?',
    body: (name: string, email: string) =>
      `Reject the request from ${name} (${email})? Nothing is sent to them, and signing in again will not reopen it. You can still invite them directly from Invitations.`,
    confirm: 'Reject request',
    busy: 'Rejecting…',
  },
  approved: (email: string) => `Approved. Invitation sent to ${email}.`,
  approvedEmailFailed: (email: string) => `Approved, but the invitation email could not be sent to ${email}.`,
  goToInvitations: 'Open Invitations',
  rejected: (email: string) => `Request from ${email} rejected.`,
  conflict: {
    activeUser: (email: string) =>
      `${email} already has an Operai account. Change their roles from the user's page instead.`,
    pendingInvitation: (email: string) =>
      `An invitation is already pending for ${email}. Resend it from Invitations instead.`,
    alreadyDecided: 'Someone else already decided this request. The earlier decision stands.',
    notFound: 'This request no longer exists.',
  },
  approveFailed: 'Could not approve this request. Try again.',
  rejectFailed: 'Could not reject this request. Try again.',
}

export const it: typeof en = {
  heading: 'Richieste di accesso',
  description:
    'Persone con un account wellD che hanno effettuato l’accesso senza invito. Approva per invitarle, oppure rifiuta.',
  loading: 'Caricamento delle richieste di accesso',
  loadError: 'Impossibile caricare le richieste di accesso.',
  catalogLoadError: 'Impossibile caricare ruoli e reparti.',
  caption: 'Richieste di accesso',
  filterLabel: 'Filtra per stato',
  filter: { pending: 'In attesa', approved: 'Approvate', rejected: 'Rifiutate' },
  columns: {
    name: 'Nome',
    provider: 'Provider di accesso',
    lastAsked: 'Ultima richiesta',
    state: 'Stato',
    decidedBy: 'Deciso da',
    decidedOn: 'Deciso il',
  },
  provider: { google: 'Google', github: 'GitHub', unknown: 'Sconosciuto' },
  empty: {
    pending: {
      title: 'Nessuno è in attesa di accesso',
      body: 'Quando un collega wellD accede senza invito, compare qui e gli amministratori vengono avvisati.',
    },
    approved: { title: 'Nessuna richiesta approvata', body: 'Le richieste che approvi sono elencate qui.' },
    rejected: { title: 'Nessuna richiesta rifiutata', body: 'Le richieste che rifiuti sono elencate qui.' },
  },
  approve: 'Approva',
  reject: 'Rifiuta',
  approveLabel: (email: string) => `Approva la richiesta di accesso di ${email}`,
  rejectLabel: (email: string) => `Rifiuta la richiesta di accesso di ${email}`,
  approveDialog: {
    title: 'Approva la richiesta di accesso',
    intro: (name: string, email: string) => `${name} (${email}) riceverà un invito via email.`,
    defaultAccess:
      'Se non scegli ruoli né reparti, la persona entra come dipendente. Se scegli dei ruoli, questi sostituiscono il ruolo di dipendente.',
    submit: 'Approva e invia invito',
    busy: 'Approvazione…',
  },
  rejectDialog: {
    title: 'Rifiutare la richiesta di accesso?',
    body: (name: string, email: string) =>
      `Rifiutare la richiesta di ${name} (${email})? Non viene inviato nulla alla persona e un nuovo accesso non la riapre. Puoi comunque invitarla direttamente da Inviti.`,
    confirm: 'Rifiuta richiesta',
    busy: 'Rifiuto…',
  },
  approved: (email: string) => `Approvata. Invito inviato a ${email}.`,
  approvedEmailFailed: (email: string) => `Approvata, ma non è stato possibile inviare l’email di invito a ${email}.`,
  goToInvitations: 'Apri Inviti',
  rejected: (email: string) => `Richiesta di ${email} rifiutata.`,
  conflict: {
    activeUser: (email: string) => `${email} ha già un account Operai. Modifica i suoi ruoli dalla pagina dell’utente.`,
    pendingInvitation: (email: string) => `Per ${email} c’è già un invito in sospeso. Invialo di nuovo da Inviti.`,
    alreadyDecided: 'Un altro amministratore ha già deciso questa richiesta. La decisione precedente resta valida.',
    notFound: 'Questa richiesta non esiste più.',
  },
  approveFailed: 'Impossibile approvare questa richiesta. Riprova.',
  rejectFailed: 'Impossibile rifiutare questa richiesta. Riprova.',
}
