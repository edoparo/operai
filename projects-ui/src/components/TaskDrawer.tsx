import { Fragment, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge, Banner, Button, ConfirmDialog, Drawer, StatusBadge, buttonClassName, formatDate } from '@operai/ui'
import { RichTextFilesView } from '@operai/ui/rich-text'
import { deleteTask } from '../lib/activitiesApi'
import type { MyTask, ProjectTask } from '../lib/activitiesApi'
import { taskErrorMessage } from '../lib/errors'
import { newMeetingHref, useCanStartMeetings } from '../lib/meetings'
import { mayRecordOnTask, recordHoursPropsOf } from '../lib/recordHours'
import { openTaskFile, taskFileUrlResolver } from '../lib/taskFiles'
import { moveTask, staleTaskFlags } from '../lib/taskMoves'
import { strings } from '../strings'
import { Saved } from './LoadState'
import RecordHoursAction from './RecordHoursAction'
import { TASK_STATE_MEANING, refName, taskState, taskStatus } from './TaskModel'
import type { TaskBoardMode } from './TaskModel'

/**
 * TaskDrawer — everything about one task, opened from its card on the board, in a fixed order:
 *
 * 1. Its badges (Pre-sales, the state), then its PRIMARY actions as two full-width buttons: Start / Stop
 *    (`secondary`) and Mark done (`primary`) / Mark not done, under the task's own `may.complete` (the server decided
 *    it for this caller, AC-3.2, AC-3.3, AC-3.8). A blocked task's buttons stay reachable, `aria-disabled` and
 *    described by the "Waiting on …" warning right under them, and do nothing (AC-4.2). They are the same writes as
 *    dragging the card (`moveTask`). The confirmation of a write and a refusal show right there.
 * 2. Its facts as a labelled list: project (My tasks), or company and deal (a pre-sales task); due date; assignee;
 *    participants, one per line; in progress since / done, with by whom.
 * 3. Its description and files, under a heading, when it has any (or the "details are restricted" note).
 * 4. "More": Start a meeting (a project task, for a holder of `meetings:access`, specs/20261104-meetings A18), Open in
 *    CRM (a pre-sales task with a company, AC-7.3), Record hours — hours-ui's widget, for the task's assignee and
 *    participants (`mayRecordOnTask`), done tasks included (specs/20261116-record-hours-in-place AC-3.1 – AC-3.6; not
 *    a `may` flag, hours-api decides) —, Edit and, last and set apart, Delete. Edit and Delete only on the project page,
 *    under `may.edit` / `may.delete` (My tasks never offered them: a pre-sales task is the CRM's, AC-7.3). Delete asks
 *    first, in a `ConfirmDialog` stacked on the drawer (the drawer holds no form, ADR 20261118 on dialogs); Edit is the
 *    board's `TaskFormDialog`, opened beside the drawer.
 *
 * The drawer stays mounted while the board reads its lists again after a write, so its error and the widget's own
 * message survive the re-read (design S3). A refusal that means the flags were stale (`forbidden`, `task_blocked`,
 * 404) also has the board read its lists again.
 */
/** A label of the panel: the library's fact-list term style (design-system.md type scale, `FactList` term). */
const TERM = 'm-0 font-mono text-2xs uppercase tracking-wide text-soft'

export default function TaskDrawer({
  task,
  mode,
  currentUserId,
  testIdPrefix,
  notice,
  onDismissNotice,
  onClose,
  onWritten,
  onDeleted,
  onStale,
  onEdit,
}: {
  task: MyTask
  mode: TaskBoardMode
  currentUserId: string | null
  /** The task's test ids: `${prefix}-${id}-toggle`, `-progress`, `-edit`, `-delete`, … */
  testIdPrefix: string
  /** The confirmation of the last write made from this drawer. */
  notice: string | null
  onDismissNotice: () => void
  onClose: () => void
  /** A write succeeded: confirm it here and read the lists again (the board's job). */
  onWritten: (message: string) => void
  /** The task was deleted: close the drawer, confirm on the board, read the lists again. */
  onDeleted: (message: string) => void
  /** A refusal means the flags are stale: read the lists again. */
  onStale: () => void
  /** Edit, on the project page only (TaskFormDialog). Without it there is neither Edit nor Delete. */
  onEdit?: (task: ProjectTask) => void
}) {
  const t = strings.tasks.row
  const my = strings.tasks.my
  const hintId = useId()
  const canStartMeetings = useCanStartMeetings()
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<'progress' | 'complete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const state = taskState(task)
  const status = taskStatus(task)
  const done = status === 'done'
  const blocked = state === 'blocked'
  const openBlockers = task.task.blockedBy?.filter((blocker) => !blocker.completed) ?? []
  const waiting =
    blocked && openBlockers.length > 0
      ? `${t.waitingOn(openBlockers.map((blocker) => blocker.subject).join(', '))}. ${t.blockedHint}`
      : null
  const participants = task.participants ?? []
  const prefix = `${testIdPrefix}-${task.id}`
  const projectTask = task.kind === 'operational' ? task : null
  // Only a drawer the person may record on mounts the widget: the board itself never loads the seam (plan R1).
  const recordHours = mayRecordOnTask(task, currentUserId) ? recordHoursPropsOf(task) : null

  const run = (kind: 'progress' | 'complete') => {
    if (blocked || running !== null) return
    const lane = kind === 'complete' ? (done ? 'open' : 'done') : status === 'in_progress' ? 'open' : 'in_progress'
    setRunning(kind)
    setError(null)
    moveTask(task, lane).then(
      (message) => {
        setRunning(null)
        onWritten(message)
      },
      (failure: unknown) => {
        setRunning(null)
        setError(taskErrorMessage(failure, 'row'))
        if (staleTaskFlags(failure)) onStale()
      },
    )
  }

  const remove = () => {
    setDeleting(true)
    setDeleteError(null)
    deleteTask(task.id).then(
      () => onDeleted(strings.tasks.saved.deleted),
      (failure: unknown) => {
        setDeleting(false)
        setDeleteError(taskErrorMessage(failure, 'dialog'))
      },
    )
  }

  const d = strings.tasks.drawer
  const started =
    status === 'in_progress' && task.task.startedBy && task.task.startedAt
      ? d.when(formatDate(task.task.startedAt), refName(task.task.startedBy, currentUserId))
      : null
  const completed =
    done && task.task.completedBy && task.task.completedAt
      ? d.when(formatDate(task.task.completedAt), refName(task.task.completedBy, currentUserId))
      : null

  /** The task's facts, one labelled row each. */
  const facts: { id: string; term: string; value: ReactNode }[] = []
  if (mode === 'my' && task.kind === 'pre_sales') {
    facts.push({ id: 'company', term: d.company, value: task.company?.name ?? my.unknownCompany })
    if (task.deal)
      facts.push({
        id: 'deal',
        term: d.deal,
        value: (
          // The CRM is a sibling tool outside this router's basepath: a plain anchor, its href built from the id.
          <a className="link" href={`/crm/deals/${encodeURIComponent(task.deal.id)}`} data-testid={`${prefix}-deal`}>
            {task.deal.title ?? my.unknownDeal}
          </a>
        ),
      })
  } else if (mode === 'my' && task.project) {
    facts.push({
      id: 'project',
      term: d.project,
      value: (
        <Link to="/$id" params={{ id: task.project.id }} className="link">
          {task.project.name ?? my.unknownProject}
        </Link>
      ),
    })
  }
  facts.push({ id: 'due', term: d.due, value: task.task.dueDate ? formatDate(task.task.dueDate) : t.noDue })
  facts.push({ id: 'assignee', term: d.assignee, value: refName(task.task.assignee, currentUserId) })
  if (participants.length > 0)
    facts.push({
      id: 'participants',
      term: d.participants,
      value: (
        <ul className="m-0 list-none p-0">
          {participants.map((person) => (
            <li key={person.id}>{refName(person, currentUserId)}</li>
          ))}
        </ul>
      ),
    })
  if (started) facts.push({ id: 'started', term: d.started, value: started })
  if (completed) facts.push({ id: 'completed', term: d.completed, value: completed })

  const progressShown = task.may.complete && !done
  const describedBy = blocked && waiting !== null ? hintId : undefined
  const hasDescription =
    task.detailsHidden === true || (task.task.description ?? null) !== null || (task.task.files ?? []).length > 0

  const meeting = canStartMeetings && projectTask !== null && projectTask.project !== null ? projectTask.project : null
  const company = task.kind === 'pre_sales' ? task.company : null
  const canEdit = onEdit !== undefined && projectTask !== null && task.may.edit
  const canDelete = onEdit !== undefined && projectTask !== null && task.may.delete
  const hasMore = meeting !== null || company !== null || recordHours !== null || canEdit || canDelete
  const wide = buttonClassName({ variant: 'secondary', className: 'w-full' })

  return (
    <Drawer title={task.subject} onClose={onClose} closeLabel={d.close} testIdPrefix="task-drawer">
      <div className="flex flex-col gap-5" data-testid={`${prefix}-details`}>
        <div className="flex flex-wrap items-center gap-2">
          {task.kind === 'pre_sales' && <Badge tone="neutral">{my.preSales}</Badge>}
          <StatusBadge status={TASK_STATE_MEANING[state]}>{strings.tasks.state[state]}</StatusBadge>
        </div>

        {task.may.complete && (
          <div className="flex flex-col gap-2">
            <div
              className={progressShown ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}
              role="group"
              aria-label={d.progressFor(task.subject)}
            >
              {progressShown && (
                <Button
                  variant="secondary"
                  className="w-full"
                  busy={running === 'progress'}
                  aria-disabled={blocked || undefined}
                  aria-describedby={describedBy}
                  onClick={() => run('progress')}
                  data-testid={`${prefix}-progress`}
                >
                  {running === 'progress' ? t.completing : status === 'in_progress' ? t.stop : t.start}
                </Button>
              )}
              <Button
                variant={done ? 'secondary' : 'primary'}
                className="w-full"
                busy={running === 'complete'}
                aria-disabled={blocked || undefined}
                aria-describedby={describedBy}
                onClick={() => run('complete')}
                data-testid={`${prefix}-toggle`}
              >
                {running === 'complete' ? t.completing : done ? t.reopen : t.complete}
              </Button>
            </div>
          </div>
        )}
        {waiting !== null && (
          // Why the buttons above do nothing; also their accessible description.
          <Banner tone="warning" live="off" id={hintId} data-testid={`${prefix}-waiting`}>
            {waiting}
          </Banner>
        )}
        {notice && <Saved message={notice} onDismiss={onDismissNotice} />}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <dl className="m-0 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2">
          {facts.map((fact) => (
            <Fragment key={fact.id}>
              <dt className={TERM} data-testid={`${prefix}-fact-${fact.id}`}>
                {fact.term}
              </dt>
              <dd className="m-0 min-w-0 break-words text-sm text-text">{fact.value}</dd>
            </Fragment>
          ))}
        </dl>

        {hasDescription && (
          <section className="flex flex-col gap-2" aria-labelledby={`${hintId}-description`}>
            <h3 id={`${hintId}-description`} className={TERM}>
              {d.description}
            </h3>
            {task.detailsHidden ? (
              <p className="text-sm text-soft" data-testid={`${prefix}-restricted`}>
                {my.detailsRestricted}
              </p>
            ) : (
              <RichTextFilesView
                doc={task.task.description ?? null}
                attachments={(task.task.files ?? [])
                  .filter((file) => file.kind === 'attachment')
                  .map((file) => ({ id: file.id, name: file.fileName, sizeBytes: file.sizeBytes }))}
                resolveImageUrl={taskFileUrlResolver(task.id)}
                onDownload={(item) => {
                  void openTaskFile(task.id, item.id).then((opened) => {
                    if (!opened) setError(strings.tasks.files.errors.openFailed)
                  })
                }}
                copy={{
                  images: strings.tasks.files.images,
                  check: strings.tasks.files.check,
                  attachments: strings.tasks.files.attachments,
                }}
                testIdPrefix={`project-task-${task.id}-description`}
              />
            )}
          </section>
        )}

        {hasMore && (
          <section className="flex flex-col gap-2" aria-labelledby={`${hintId}-more`}>
            <h3 id={`${hintId}-more`} className={TERM}>
              {d.more}
            </h3>
            <div className="flex flex-col items-stretch gap-2" role="group" aria-label={t.actionsFor(task.subject)}>
              {meeting !== null && (
                // specs/20261104-meetings A18: a meeting about a project task is linked to its project.
                <a
                  className={wide}
                  href={newMeetingHref(meeting.id, task.subject)}
                  aria-label={t.startMeetingFor(task.subject)}
                  data-testid={`${prefix}-meeting`}
                >
                  {t.startMeeting}
                </a>
              )}
              {company && (
                <a
                  className={wide}
                  href={`/crm/companies/${encodeURIComponent(company.id)}`}
                  aria-label={my.openInCrmFor(task.subject)}
                  data-testid={`${prefix}-crm`}
                >
                  {my.openInCrm}
                </a>
              )}
              {recordHours && (
                // hours-ui's widget (or the host's link to My hours) in a column of its own, so its button spans the panel.
                <div className="flex flex-col" data-testid={`${prefix}-record-hours`}>
                  <RecordHoursAction {...recordHours} />
                </div>
              )}
              {canEdit && (
                <Button
                  variant="secondary"
                  className="w-full"
                  aria-haspopup="dialog"
                  onClick={() => onEdit(projectTask)}
                  data-testid={`${prefix}-edit`}
                >
                  {t.edit}
                </Button>
              )}
              {canDelete && (
                // Destructive, last and set apart.
                <div className="mt-2 border-t border-rule pt-3">
                  <Button
                    variant="danger"
                    className="w-full"
                    aria-haspopup="dialog"
                    onClick={() => setConfirming(true)}
                    data-testid={`${prefix}-delete`}
                  >
                    {t.delete}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={strings.tasks.deleteDialog.title(task.subject)}
          confirmLabel={strings.tasks.deleteDialog.confirm}
          busyLabel={strings.tasks.deleteDialog.busy}
          cancelLabel={strings.common.cancel}
          closeLabel={strings.common.close}
          busy={deleting}
          error={deleteError}
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
          testIdPrefix="project-task-delete"
        >
          {strings.tasks.deleteDialog.body}
        </ConfirmDialog>
      )}
    </Drawer>
  )
}
