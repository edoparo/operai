/** Labels of every badge: statuses, stages, entities, activity types. */
import type { ActivityType, CompanyStatus, DealStage, Entity, EstimateState } from '../lib/types'
import type { TaskState } from '../lib/statusMeanings'

const en = {
  companyStatus: { prospect: 'Prospect', customer: 'Customer', former: 'Former client' } as Record<CompanyStatus, string>,
  dealStage: {
    lead: 'Lead',
    qualified: 'Qualified',
    proposal: 'Offer in preparation',
    negotiation: 'Offer sent',
    won: 'Won',
    lost: 'Lost',
  } as Record<DealStage, string>,
  entity: { welld_ch: 'wellD CH', welld_it: 'wellD IT' } as Record<Entity, string>,
  activityType: { note: 'Note', call: 'Call', meeting: 'Meeting', email: 'Email', task: 'Task' } as Record<
    ActivityType,
    string
  >,
  taskState: { open: 'Open', overdue: 'Overdue', done: 'Done' } as Record<TaskState, string>,
  estimateState: { requested: 'Requested', ready: 'Ready' } as Record<EstimateState, string>,
  archived: 'Archived',
}

const it: typeof en = {
  companyStatus: { prospect: 'Potenziale', customer: 'Cliente', former: 'Ex cliente' },
  dealStage: {
    lead: 'Contatto',
    qualified: 'Qualificata',
    proposal: 'Offerta in preparazione',
    negotiation: 'Offerta inviata',
    won: 'Vinta',
    lost: 'Persa',
  },
  entity: { welld_ch: 'wellD CH', welld_it: 'wellD IT' },
  activityType: { note: 'Nota', call: 'Telefonata', meeting: 'Riunione', email: 'Email', task: 'Attività' },
  taskState: { open: 'Aperta', overdue: 'Scaduta', done: 'Completata' },
  estimateState: { requested: 'Richiesta', ready: 'Pronta' },
  archived: 'Archiviato',
}

export const badges = { en, it }
