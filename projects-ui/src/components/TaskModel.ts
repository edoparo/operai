import type { StatusMeaning, TaskRowState } from '@operai/ui'
import type { PersonRef, ProjectTask } from '../lib/activitiesApi'
import { strings } from '../strings'

/**
 * The ONE place projects-ui maps a task's state to the suite's status dictionary
 * (INC-23). The badge itself is `TaskRow`'s: it takes the meaning and the label.
 * Blocked and overdue both need someone ("attention"), and the label tells them
 * apart; an open task is waiting for its assignee ("pending"), a done one is
 * "settled".
 */
export const TASK_STATE_MEANING: Record<TaskRowState, StatusMeaning> = {
  open: 'pending',
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
 * Done > Blocked > Overdue > Open (AC-3.4, AC-4.2). A blocked task cannot be
 * acted on yet, so it reads Blocked even past its due date; the due date still
 * shows on its meta line.
 */
export function taskState(task: Pick<ProjectTask, 'task'>, now = new Date()): TaskRowState {
  if (task.task.completedAt !== null) return 'done'
  if (task.task.blocked === true) return 'blocked'
  const due = task.task.dueDate
  return due !== null && due < today(now) ? 'overdue' : 'open'
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
