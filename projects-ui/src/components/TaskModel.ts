import { STATUS, formatDate } from '@operai/ui'
import type { StatusMeaning, TaskRowState } from '@operai/ui'
import type { MyTask, PersonRef, ProjectTask } from '../lib/activitiesApi'
import { strings } from '../strings'

/**
 * The ONE place projects-ui maps a task's state to the suite's status dictionary
 * (INC-23). The badge itself is `TaskRow`'s: it takes the meaning and the label.
 * Blocked and overdue both need someone ("attention"), and the label tells them
 * apart; an open task is waiting for its assignee ("pending"), a done one is
 * "settled".
 */
/**
 * "In progress" (specs/20261110-activities US-10) is the library's `progress` meaning. A remote runs on the LIVE
 * shell's library (ADR 20261114): until that shell has `progress`, the badge falls back to `active`, which every
 * shell has, instead of breaking.
 */
const IN_PROGRESS_MEANING: StatusMeaning = 'progress' in STATUS ? 'progress' : 'active'

export const TASK_STATE_MEANING: Record<TaskRowState, StatusMeaning> = {
  open: 'pending',
  in_progress: IN_PROGRESS_MEANING,
  blocked: 'attention',
  overdue: 'attention',
  done: 'settled',
}

/** Today as `YYYY-MM-DD` in the person's calendar, which is how a due date is compared. */
export function today(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Done > Blocked > Overdue > In progress > Open (AC-3.4, AC-4.2). A blocked task cannot be
 * acted on yet, so it reads Blocked even past its due date; the due date still
 * shows on its meta line.
 */
export function taskState(task: Pick<ProjectTask, 'task'>, now = new Date()): TaskRowState {
  if (taskStatus(task) === 'done') return 'done'
  if (task.task.blocked === true) return 'blocked'
  const due = task.task.dueDate
  if (due !== null && due < today(now)) return 'overdue'
  return taskStatus(task) === 'in_progress' ? 'in_progress' : 'open'
}

/** The task's status; an older server sends none, then it is derived from `completedAt`. */
export function taskStatus(task: Pick<ProjectTask, 'task'>): 'open' | 'in_progress' | 'done' {
  return task.task.status ?? (task.task.completedAt !== null ? 'done' : 'open')
}

/** How a person reference reads (ADR 20260807-live-identity-resolution-by-id-fail-soft): the live name, or what is known about the account. */
export function refName(person: PersonRef | null, currentUserId: string | null = null): string {
  if (person === null) return strings.common.none
  if (person.status === 'system') return strings.tasks.person.system
  if (person.status === 'deleted') return strings.people.deleted
  if (person.status === 'unknown') return strings.tasks.person.unknown
  const name = person.name ?? strings.people.picker.noName
  return person.id === currentUserId ? `${name} (${strings.people.you})` : name
}

export type TaskBoardMode = 'project' | 'my'

/** Where a task of My tasks belongs: its project, or its company and deal for a pre-sales task. */
export function taskContext(task: MyTask): string | null {
  const my = strings.tasks.my
  if (task.kind === 'pre_sales') {
    const company = task.company ? (task.company.name ?? my.unknownCompany) : null
    const deal = task.deal ? (task.deal.title ?? my.unknownDeal) : null
    const parts = [company, deal].filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  return task.project ? (task.project.name ?? my.unknownProject) : null
}

/** The one state badge a card shows, only when the task needs attention (Blocked, Overdue). */
export const attentionOf = (task: MyTask) => {
  const state = taskState(task)
  return state === 'blocked' || state === 'overdue' ? state : null
}

export const dueOf = (task: MyTask) =>
  task.task.dueDate ? strings.tasks.row.due(formatDate(task.task.dueDate)) : strings.tasks.row.noDue

export const assigneeOf = (task: MyTask, currentUserId: string | null) =>
  task.task.assignee ? strings.tasks.row.assignedTo(refName(task.task.assignee, currentUserId)) : null

/**
 * The card's accessible name: everything the card shows, in its order, since the card is one button and its
 * content is not read on its own.
 */
export function taskCardLabel(task: MyTask, mode: TaskBoardMode, currentUserId: string | null): string {
  const attention = attentionOf(task)
  return [
    task.subject,
    mode === 'my' && task.kind === 'pre_sales' ? strings.tasks.my.preSales : null,
    mode === 'my' ? taskContext(task) : null,
    attention ? strings.tasks.state[attention] : null,
    dueOf(task),
    assigneeOf(task, currentUserId),
  ]
    .filter((part): part is string => part !== null)
    .join(', ')
}
