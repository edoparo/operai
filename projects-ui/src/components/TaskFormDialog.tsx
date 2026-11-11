import { useCallback, useRef, useState } from 'react'
import { Button, CheckboxGroupField, DateInput, Field, FormDialog, PersonChips, focusFirstInvalid } from '@operai/ui'
import { createTask, listProjectTasks, updateTask } from '../lib/activitiesApi'
import type { ProjectTask } from '../lib/activitiesApi'
import { ApiError } from '../lib/api'
import { codeOf, fieldErrorOf, taskErrorMessage } from '../lib/errors'
import { personName } from '../lib/people'
import type { Person, Project } from '../lib/types'
import { first, hasErrors, maxLength, required } from '../lib/validate'
import type { Errors } from '../lib/validate'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'
import { refName } from './TaskModel'

type FieldName = 'subject' | 'dueDate' | 'assignee' | 'blockedByIds' | 'participants'

/** The server's caps on a task's blockers (AC-4.1) and participants (AC-5.1). */
const MAX_BLOCKERS = 10
const MAX_PARTICIPANTS = 10

/** Server field names that are not this form's field names. */
const SERVER_FIELDS: Record<string, FieldName> = {
  subject: 'subject',
  dueDate: 'dueDate',
  assigneeUserId: 'assignee',
  blockedByIds: 'blockedByIds',
  participantIds: 'participants',
}

/** The project manager and the team, without repeats: who a task can be assigned to (AC-3.1). */
const assignable = (project: Pick<Project, 'projectManager' | 'team'>): Person[] =>
  [project.projectManager, ...project.team].filter(
    (person, index, all) => !person.deleted && all.findIndex((other) => other.id === person.id) === index,
  )

/**
 * TaskFormDialog — add a task to a project, or edit one (F2, F3, F6). Title is
 * required; the due date and the assignee are optional (empty = the author,
 * AC-3.1); blockers are the project's other open tasks, at most 10 (AC-4.1);
 * participants are module users, at most 10 (AC-5.1). The dialog can only make
 * a task (AC-3.6): there is no type to choose.
 *
 * An assignee who left the team stays selected and is resent unchanged, which
 * the server accepts (AC-3.7); once someone else is picked they leave the list.
 * Refusals stay inline, name the field when the server did, and keep every
 * typed value (dialog rules).
 */
export default function TaskFormDialog({
  project,
  task,
  currentUserId,
  onSaved,
  onCancel,
  onHostReadOnly,
}: {
  project: Pick<Project, 'id' | 'projectManager' | 'team'>
  task?: ProjectTask
  currentUserId: string | null
  /** The task was saved: `message` is the confirmation for the card to announce. */
  onSaved: (message: string) => void
  onCancel: () => void
  /** The project was closed meanwhile (409 `host_read_only`): the list reloads to show fresh flags. */
  onHostReadOnly: () => void
}) {
  const t = strings.tasks.form
  const people = assignable(project)
  const [subject, setSubject] = useState(task?.subject ?? '')
  const [dueDate, setDueDate] = useState(task?.task.dueDate ?? '')
  const [assignee, setAssignee] = useState(() => {
    if (task) return task.task.assignee?.id ?? ''
    return people.some((person) => person.id === currentUserId) ? (currentUserId ?? '') : ''
  })
  const [blockedByIds, setBlockedByIds] = useState<string[]>(() => task?.task.blockedBy?.map((b) => b.id) ?? [])
  const participantsRef = useRef<HTMLDivElement>(null)
  const [participants, setParticipants] = useState<PersonChoice[]>(
    () => task?.participants?.map((person) => ({ id: person.id, label: refName(person) })) ?? [],
  )
  const [errors, setErrors] = useState<Errors<FieldName>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)

  const loadOpenTasks = useCallback(
    (signal: AbortSignal) => listProjectTasks(project.id, { status: 'open', pageSize: 100 }, { signal }),
    [project.id],
  )
  const openTasks = useResource(loadOpenTasks)

  // The assignee select: the manager and the team, plus a current assignee who left (AC-3.7), marked.
  const currentAssignee = task?.task.assignee ?? null
  const departed =
    currentAssignee !== null && assignee === currentAssignee.id && !people.some((p) => p.id === currentAssignee.id)
  // A task that has an assignee has no "empty" choice: leaving it as it is means keeping them.
  const emptyChoice = task === undefined || currentAssignee === null

  // The project's open tasks except this one, plus any current blocker already done or past the first 100.
  const openItems = (openTasks.data?.items ?? []).filter((candidate) => candidate.id !== task?.id)
  const blockerChoices = [
    ...openItems.map((item) => ({ id: item.id, label: item.subject })),
    ...(task?.task.blockedBy ?? [])
      .filter((blocker) => !openItems.some((item) => item.id === blocker.id))
      .map((blocker) => ({
        id: blocker.id,
        label: blocker.completed ? t.blockedByDone(blocker.subject) : blocker.subject,
      })),
  ]

  const toggleBlocker = (id: string, checked: boolean) => {
    if (checked && blockedByIds.length >= MAX_BLOCKERS) {
      setErrors((current) => ({ ...current, blockedByIds: t.blockedByMax(MAX_BLOCKERS) }))
      return
    }
    setErrors((current) => ({ ...current, blockedByIds: undefined }))
    setBlockedByIds((current) => (checked ? [...current, id] : current.filter((value) => value !== id)))
  }

  const full = participants.length >= MAX_PARTICIPANTS

  const submit = () => {
    const found: Errors<FieldName> = {
      subject: first(required(subject), maxLength(subject, 200)) ?? undefined,
    }
    setErrors(found)
    if (hasErrors(found)) {
      requestAnimationFrame(() => focusFirstInvalid(fieldsRef.current))
      return
    }
    const body = {
      subject: subject.trim(),
      dueDate: dueDate === '' ? null : dueDate,
      ...(assignee !== '' ? { assigneeUserId: assignee } : {}),
      blockedByIds,
      participantIds: participants.map((person) => person.id),
    }
    setBusy(true)
    setError(null)
    const request = task
      ? updateTask(task.id, body).then(() => strings.tasks.saved.saved)
      : createTask({ type: 'task', projectId: project.id, ...body }).then(() => strings.tasks.saved.added)
    request.then(onSaved, (failure: unknown) => {
      setBusy(false)
      setErrors(fieldsFor(failure))
      if (codeOf(failure) === 'host_read_only') onHostReadOnly()
      if (!hasFieldError(failure)) setError(taskErrorMessage(failure, 'dialog'))
    })
  }

  return (
    <FormDialog
      title={task ? t.editTitle : t.addTitle}
      submitLabel={task ? t.submitSave : t.submitAdd}
      busyLabel={t.busy}
      cancelLabel={strings.common.cancel}
      closeLabel={strings.common.close}
      busy={busy}
      error={error}
      onSubmit={submit}
      onCancel={onCancel}
      size="lg"
      testIdPrefix="task-form"
    >
      <div ref={fieldsRef} className="contents">
        <Field label={t.subject} required error={errors.subject} testId="task-form-subject">
          {(control) => <input {...control} value={subject} onChange={(event) => setSubject(event.target.value)} />}
        </Field>
        <Field label={t.dueDate} error={errors.dueDate} testId="task-form-due">
          {(control) => <DateInput {...control} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />}
        </Field>
        <Field
          label={t.assignee}
          hint={task === undefined ? t.assigneeHint : undefined}
          error={errors.assignee}
          testId="task-form-assignee"
        >
          {(control) => (
            <select {...control} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
              {emptyChoice && <option value="">{t.assigneeEmpty}</option>}
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {personName(person, currentUserId)}
                </option>
              ))}
              {departed && currentAssignee && (
                <option value={currentAssignee.id}>
                  {t.assigneeDeparted(refName(currentAssignee, currentUserId))}
                </option>
              )}
            </select>
          )}
        </Field>
        {openTasks.status === 'error' ? (
          <div className="flex flex-col items-start gap-2" data-testid="task-form-blocked-by-failed">
            <p className="text-sm text-soft">{t.blockedByFailed}</p>
            <Button size="sm" onClick={openTasks.retry}>
              {t.blockedByRetry}
            </Button>
          </div>
        ) : (
          <CheckboxGroupField
            label={t.blockedBy(blockedByIds.length, MAX_BLOCKERS)}
            hint={t.blockedByHint}
            error={errors.blockedByIds}
            options={blockerChoices}
            selected={blockedByIds}
            onToggle={toggleBlocker}
            emptyState={openTasks.status === 'loading' ? t.blockedByLoading : t.blockedByEmpty}
            scroll
            testId="task-form-blocked-by"
            optionTestIdPrefix="task-form-blocker"
          />
        )}
        <div ref={participantsRef} className="flex flex-col gap-2" data-testid="task-form-participants">
          <PersonPicker
            label={t.participants}
            value={null}
            onChange={(next) => {
              if (next && !full && !participants.some((person) => person.id === next.id)) {
                setParticipants([...participants, next])
              }
            }}
            error={full ? t.participantsMax(MAX_PARTICIPANTS) : errors.participants}
            excludeIds={participants.map((person) => person.id)}
            clearOnSelect
            testId="task-form-participants-picker"
          />
          <PersonChips
            label={t.participants}
            people={participants}
            removeLabel={t.removeParticipant}
            focusAfterRemove={() => participantsRef.current?.querySelector('input') ?? null}
            onRemove={(id) => setParticipants(participants.filter((person) => person.id !== id))}
            testId="task-form-participants"
          />
        </div>
      </div>
    </FormDialog>
  )
}

/** The field a refusal names, as `{ field: message }`; empty when it names none (the dialog alert then speaks). */
function fieldsFor(failure: unknown): Errors<FieldName> {
  const t = strings.tasks
  if (!(failure instanceof ApiError)) return {}
  switch (failure.code) {
    case 'assignee_not_on_project':
      return { assignee: t.errors.assigneeNotOnProject }
    case 'blocker_cycle':
      return { blockedByIds: t.form.blockedByCycle }
    case 'blocker_is_self':
    case 'blocker_not_in_host':
      return { blockedByIds: failure.detail ?? strings.common.validation.fixErrors }
    case 'owner_not_app_user':
      return { participants: failure.detail ?? strings.common.validation.fixErrors }
  }
  const named = fieldErrorOf(failure)
  const field = named ? SERVER_FIELDS[named.field] : undefined
  return named && field ? { [field]: named.message } : {}
}

const hasFieldError = (failure: unknown): boolean => hasErrors(fieldsFor(failure))
