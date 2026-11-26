import { useId, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge, Button, ConfirmDialog, Drawer, StatusBadge, formatDate } from '@operai/ui'
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
 * TaskDrawer — everything about one task, opened from its card on the board: where it belongs, its state, due date,
 * assignee, participants, what it waits on, when it was started or done, its description and files, and every action
 * the person may take on it. It replaces the task rows of the project page and of My tasks, so it carries what both
 * offered:
 *
 * - Start / Stop and Mark done / Mark not done, under the task's own `may.complete` (the server decided it for this
 *   caller, AC-3.2, AC-3.3, AC-3.8). A blocked task's buttons stay reachable, `aria-disabled` and described by the
 *   "Waiting on …" line, and do nothing (AC-4.2). They are the same writes as dragging the card (`moveTask`).
 * - Start a meeting (a project task, for a holder of `meetings:access`, specs/20261104-meetings A18) and Open in CRM
 *   (a pre-sales task with a company, AC-7.3).
 * - Edit and Delete on the project page only, under `may.edit` / `may.delete` (My tasks never offered them: a
 *   pre-sales task is the CRM's, AC-7.3). Delete asks first, in a `ConfirmDialog` stacked on the drawer (the drawer
 *   holds no form, ADR 20261118 on dialogs); Edit is the board's `TaskFormDialog`, opened beside the drawer.
 * - Record hours, hours-ui's widget, LAST, for the task's assignee and participants (`mayRecordOnTask`), done tasks
 *   included (specs/20261116-record-hours-in-place AC-3.1 – AC-3.6). It is not a `may` flag; hours-api decides.
 *
 * The drawer stays mounted while the board reads its lists again after a write, so its error and the widget's own
 * message survive the re-read (design S3). A refusal is shown here, as an alert; a refusal that means the flags were
 * stale (`forbidden`, `task_blocked`, 404) also has the board read its lists again.
 */
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

  const facts = [
    task.task.dueDate ? t.due(formatDate(task.task.dueDate)) : t.noDue,
    task.task.assignee ? t.assignedTo(refName(task.task.assignee, currentUserId)) : null,
  ].filter((fact): fact is string => fact !== null)
  const started =
    status === 'in_progress' && task.task.startedBy && task.task.startedAt
      ? t.startedBy(refName(task.task.startedBy, currentUserId), formatDate(task.task.startedAt))
      : null
  const completed =
    done && task.task.completedBy && task.task.completedAt
      ? t.completedBy(refName(task.task.completedBy, currentUserId), formatDate(task.task.completedAt))
      : null

  const where =
    mode !== 'my' ? null : task.kind === 'pre_sales' ? (
      <>
        <p className="text-sm text-soft">{my.company(task.company?.name ?? my.unknownCompany)}</p>
        {task.deal && (
          <p className="text-sm text-soft">
            {my.dealLabel}{' '}
            {/* The CRM is a sibling tool outside this router's basepath: a plain anchor, its href built from the id. */}
            <a className="link" href={`/crm/deals/${encodeURIComponent(task.deal.id)}`} data-testid={`${prefix}-deal`}>
              {task.deal.title ?? my.unknownDeal}
            </a>
          </p>
        )}
      </>
    ) : task.project ? (
      <p className="text-sm text-soft">
        {my.projectLabel}{' '}
        <Link to="/$id" params={{ id: task.project.id }} className="link">
          {task.project.name ?? my.unknownProject}
        </Link>
      </p>
    ) : null

  const progressShown = task.may.complete && !done
  const describedBy = blocked && waiting !== null ? hintId : undefined

  return (
    <Drawer title={task.subject} onClose={onClose} closeLabel={strings.tasks.drawer.close} testIdPrefix="task-drawer">
      <div className="flex flex-col gap-4" data-testid={`${prefix}-details`}>
        <div className="flex flex-wrap items-center gap-2">
          {task.kind === 'pre_sales' && <Badge tone="neutral">{my.preSales}</Badge>}
          <StatusBadge status={TASK_STATE_MEANING[state]}>{strings.tasks.state[state]}</StatusBadge>
        </div>
        {where}
        <div className="flex flex-col gap-1">
          <p className="text-sm text-soft">{facts.join(' · ')}</p>
          {participants.length > 0 && (
            <p className="text-sm text-soft">
              {t.with(participants.map((person) => refName(person, currentUserId)).join(', '))}
            </p>
          )}
          {started && <p className="text-sm text-soft">{started}</p>}
          {completed && <p className="text-sm text-soft">{completed}</p>}
          {waiting !== null && (
            <p className="text-sm text-soft" id={hintId} data-testid={`${prefix}-waiting`}>
              {waiting}
            </p>
          )}
        </div>
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
        {notice && <Saved message={notice} onDismiss={onDismissNotice} />}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.actionsFor(task.subject)}>
          {progressShown && (
            <Button
              size="sm"
              variant="secondary"
              busy={running === 'progress'}
              aria-disabled={blocked || undefined}
              aria-describedby={describedBy}
              onClick={() => run('progress')}
              data-testid={`${prefix}-progress`}
            >
              {running === 'progress' ? t.completing : status === 'in_progress' ? t.stop : t.start}
            </Button>
          )}
          {task.may.complete && (
            <Button
              size="sm"
              busy={running === 'complete'}
              aria-disabled={blocked || undefined}
              aria-describedby={describedBy}
              onClick={() => run('complete')}
              data-testid={`${prefix}-toggle`}
            >
              {running === 'complete' ? t.completing : done ? t.reopen : t.complete}
            </Button>
          )}
          {canStartMeetings && projectTask !== null && projectTask.project !== null && (
            // specs/20261104-meetings A18: a meeting about a project task is linked to its project.
            <a
              className="link text-sm"
              href={newMeetingHref(projectTask.project.id, task.subject)}
              aria-label={t.startMeetingFor(task.subject)}
              data-testid={`${prefix}-meeting`}
            >
              {t.startMeeting}
            </a>
          )}
          {task.kind === 'pre_sales' && task.company && (
            <a
              className="link text-sm"
              href={`/crm/companies/${encodeURIComponent(task.company.id)}`}
              aria-label={my.openInCrmFor(task.subject)}
              data-testid={`${prefix}-crm`}
            >
              {my.openInCrm}
            </a>
          )}
          {onEdit && projectTask !== null && task.may.edit && (
            <Button
              size="sm"
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => onEdit(projectTask)}
              data-testid={`${prefix}-edit`}
            >
              {t.edit}
            </Button>
          )}
          {onEdit && projectTask !== null && task.may.delete && (
            <Button
              size="sm"
              variant="ghost"
              aria-haspopup="dialog"
              onClick={() => setConfirming(true)}
              data-testid={`${prefix}-delete`}
            >
              {t.delete}
            </Button>
          )}
          {recordHours && <RecordHoursAction {...recordHours} />}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
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
