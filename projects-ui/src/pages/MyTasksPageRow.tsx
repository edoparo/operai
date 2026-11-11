import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge, TaskRow, formatDate, listRowMetaClassName } from '@operai/ui'
import { setTaskCompleted } from '../lib/activitiesApi'
import type { MyTask } from '../lib/activitiesApi'
import { statusOf, codeOf, taskErrorMessage } from '../lib/errors'
import { strings } from '../strings'
import { TASK_STATE_MEANING, refName, taskState } from '../components/TaskModel'

/** A refusal that means the row's buttons were stale: the list is read again to get fresh `may` flags. */
const staleFlags = (failure: unknown): boolean =>
  codeOf(failure) === 'forbidden' || codeOf(failure) === 'task_blocked' || statusOf(failure) === 404

/**
 * MyTaskItem — one row of My tasks (design S4, F7). Binds `TaskRow` to either kind:
 *
 * - a project task shows its project (a router link, built from the id) and offers
 *   Mark done / Mark not done whenever the server's `may.complete` says so;
 * - a pre-sales task shows a **Pre-sales** badge before its title and its company, offers the
 *   same toggle under the same flag, and an "Open in CRM" link to the company. Nothing else
 *   can be changed from here (AC-7.3), so it never gets Edit or Delete whatever its `may`.
 *
 * Every button follows the row's own `may.complete`; the page never infers it. The CRM link is a
 * plain anchor: `/crm/...` lies outside this router's `/projects` basepath, so the shell routes it.
 */
export default function MyTaskItem({
  task,
  currentUserId,
  error,
  onChanged,
  onFailed,
}: {
  task: MyTask
  currentUserId: string | null
  error: string | undefined
  /** The task changed: reload, confirm, move focus (the page's job). */
  onChanged: (message: string) => void
  /** The toggle was refused: show `message` on this row; `reload` when its flags are stale. */
  onFailed: (id: string, message: string | null, reload: boolean) => void
}) {
  const t = strings.tasks.row
  const my = strings.tasks.my
  const [busy, setBusy] = useState(false)
  const state = taskState(task)
  const done = task.task.completedAt !== null
  const openBlockers = task.task.blockedBy?.filter((blocker) => !blocker.completed) ?? []

  const toggle = () => {
    setBusy(true)
    onFailed(task.id, null, false)
    setTaskCompleted(task.id, !done).then(
      () => {
        setBusy(false)
        onChanged(done ? strings.tasks.saved.reopened : strings.tasks.saved.completed)
      },
      (failure: unknown) => {
        setBusy(false)
        onFailed(task.id, taskErrorMessage(failure, 'row'), staleFlags(failure))
      },
    )
  }

  const facts = [
    task.task.dueDate ? t.due(formatDate(task.task.dueDate)) : t.noDue,
    task.task.assignee ? t.assignedTo(refName(task.task.assignee, currentUserId)) : null,
    done && task.task.completedBy && task.task.completedAt
      ? t.completedBy(refName(task.task.completedBy, currentUserId), formatDate(task.task.completedAt))
      : null,
  ].filter((fact): fact is string => fact !== null)

  const participants = task.participants ?? []
  const where =
    task.kind === 'pre_sales' ? (
      <p className={listRowMetaClassName}>{my.company(task.company?.name ?? my.unknownCompany)}</p>
    ) : task.project ? (
      <p className={listRowMetaClassName}>
        {my.projectLabel}{' '}
        <Link to="/$id" params={{ id: task.project.id }} className="link">
          {task.project.name ?? my.unknownProject}
        </Link>
      </p>
    ) : null

  return (
    <TaskRow
      state={state}
      stateLabel={strings.tasks.state[state]}
      stateMeanings={TASK_STATE_MEANING}
      leading={task.kind === 'pre_sales' ? <Badge tone="neutral">{my.preSales}</Badge> : undefined}
      title={task.subject}
      body={where}
      meta={[
        facts.join(' · '),
        ...(participants.length > 0
          ? [t.with(participants.map((person) => refName(person, currentUserId)).join(', '))]
          : []),
      ]}
      waiting={
        openBlockers.length > 0
          ? `${t.waitingOn(openBlockers.map((b) => b.subject).join(', '))}. ${t.blockedHint}`
          : undefined
      }
      onComplete={task.may.complete ? toggle : undefined}
      completeLabel={done ? t.reopen : t.complete}
      completing={busy}
      completingLabel={t.completing}
      actionsLabel={t.actionsFor(task.subject)}
      actions={
        task.kind === 'pre_sales' && task.company ? (
          <a
            className="link self-center text-sm"
            href={`/crm/companies/${encodeURIComponent(task.company.id)}`}
            aria-label={my.openInCrmFor(task.subject)}
            data-testid={`my-task-${task.id}-crm`}
          >
            {my.openInCrm}
          </a>
        ) : undefined
      }
      error={error}
      testId={`my-task-${task.id}`}
      completeTestId={`my-task-${task.id}-toggle`}
      waitingTestId={`my-task-${task.id}-waiting`}
    />
  )
}
