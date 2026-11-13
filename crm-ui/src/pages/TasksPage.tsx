import { useCallback, useId, useState } from 'react'
import { Button, Field, ListRows, PageHeader, Pagination, StatePanel, Tabs, tabPanelProps } from '@operai/ui'
import ActivityFormDialog from '../components/ActivityFormDialog'
import ActivityItem from '../components/ActivityItem'
import ActivityLoadFailure from '../components/ActivityLoadFailure'
import { Loading, Saved } from '../components/LoadState'
import { listTaskAssignees, listTasks } from '../lib/activitiesApi'
import { personName } from '../lib/people'
import type { Activity } from '../lib/types'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'

const PAGE_SIZE = 25
const TABS_ID = 'crm-tasks'
const loadAssignees = (signal: AbortSignal) => listTaskAssignees({ signal })
type View = 'open' | 'done'

/**
 * TasksPage — "Tasks" (AC-4.4): tasks across every company, the caller's by
 * default, everyone's, or one colleague's (the "Assigned to" filter, whose
 * colleagues come from `GET /tasks/assignees` — people tasks were assigned to);
 * open (earliest due first, no due date last — the server's order) or done
 * (most recent first), switched with `Tabs` (views of the same page, no
 * navigation). Overdue tasks carry the attention badge (ActivityItem). Marking
 * one done or reopening it moves it to the other view, so the page reloads.
 * "New task" opens the activity dialog with the type fixed to task and a
 * company picker, since a task always belongs to a company.
 */
export default function TasksPage() {
  const t = strings.tasks
  const titleId = useId()
  const [view, setView] = useState<View>('open')
  const [page, setPage] = useState(1)
  const [saved, setSaved] = useState<string | null>(null)
  const [editing, setEditing] = useState<Activity | null>(null)
  const [creating, setCreating] = useState(false)
  /** `me`, `any`, or a colleague's user id — passed to the API as is. */
  const [assignee, setAssignee] = useState('me')
  const currentUserId = useCurrentUserId()
  const people = useResource(loadAssignees)
  const colleagues = (people.data?.items ?? []).filter((person) => person.id !== currentUserId)

  const load = useCallback(
    (signal: AbortSignal) => listTasks({ status: view, assignee, page, pageSize: PAGE_SIZE }, { signal }),
    [view, assignee, page],
  )
  const tasks = useResource(load, { cacheKey: `crm-tasks:${JSON.stringify([view, assignee, page])}` })

  const changed = (message: string) => {
    setSaved(message)
    tasks.retry()
  }

  /** A row left the view (Mark done, Reopen, Delete): focus rests on the selected tab, stable and visible, never `body` (specs/028 design.md). */
  const rowLeft = (message: string) => {
    changed(message)
    document.getElementById(`${TABS_ID}-tab-${view}`)?.focus()
  }

  let content
  if (tasks.status === 'loading') content = <Loading label={t.loading} />
  else if (tasks.status === 'error') content = <ActivityLoadFailure error={tasks.error} onRetry={tasks.retry} />
  else if (tasks.data!.total === 0)
    content =
      view === 'open' ? (
        <StatePanel title={t.emptyOpenTitle}>{assignee === 'me' ? t.emptyOpenBody : t.emptyOthersOpenBody}</StatePanel>
      ) : (
        <StatePanel title={t.emptyDoneTitle}>{assignee === 'me' ? t.emptyDoneBody : t.emptyOthersDoneBody}</StatePanel>
      )
  else
    content = (
      <div className="flex flex-col gap-3">
        <ListRows label={t.listLabel} testId="crm-tasks-list">
          {tasks.data!.items.map((task) => (
            <ActivityItem
              key={task.id}
              activity={task}
              showCompany
              onChanged={(updated) => rowLeft(updated.task?.completedAt ? t.completed : t.reopened)}
              onEdit={setEditing}
              onDeleted={() => rowLeft(strings.activities.deleted)}
            />
          ))}
        </ListRows>
        {tasks.data!.total > PAGE_SIZE && (
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={tasks.data!.total}
            onPageChange={setPage}
            label={strings.common.pagination.label}
            previousLabel={strings.common.pagination.previous}
            nextLabel={strings.common.pagination.next}
            status={strings.common.pagination.status}
            testId="crm-tasks-pagination"
          />
        )}
      </div>
    )

  return (
    <section aria-labelledby={titleId} data-testid="crm-tasks-page">
      <PageHeader
        title={t.heading}
        titleId={titleId}
        description={t.description}
        actions={
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            aria-haspopup="dialog"
            data-testid="crm-tasks-new"
          >
            {t.newTask}
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="max-w-xs">
          <Field label={t.assigneeFilter} testId="crm-tasks-assignee">
            {(control) => (
              <select
                {...control}
                value={assignee}
                onChange={(event) => {
                  setAssignee(event.target.value)
                  setPage(1)
                }}
              >
                <option value="me">{t.assigneeMe}</option>
                <option value="any">{t.assigneeAny}</option>
                {colleagues.length > 0 && (
                  <optgroup label={t.colleaguesGroup}>
                    {colleagues.map((person) => (
                      <option key={person.id} value={person.id}>
                        {personName(person)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
          </Field>
        </div>
        <Tabs
          label={t.viewsLabel}
          idPrefix={TABS_ID}
          value={view}
          onChange={(next) => {
            setView(next)
            setPage(1)
          }}
          tabs={[
            { id: 'open', label: t.open },
            { id: 'done', label: t.done },
          ]}
          testId="crm-tasks-tabs"
        />
        <div {...tabPanelProps(TABS_ID, view)} className="flex flex-col gap-3">
          {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
          {content}
        </div>
      </div>
      {creating && (
        <ActivityFormDialog
          fixedType="task"
          onCancel={() => setCreating(false)}
          onSaved={(_saved, warning) => {
            setCreating(false)
            // The task may be the first one for its assignee: refresh the filter's colleagues.
            people.retry()
            setView('open')
            setPage(1)
            changed(warning ?? t.created)
          }}
        />
      )}
      {editing && (
        <ActivityFormDialog
          company={editing.company}
          activity={editing}
          onCancel={() => setEditing(null)}
          onSaved={(_saved, warning) => {
            setEditing(null)
            changed(warning ?? strings.activities.saved)
          }}
        />
      )}
    </section>
  )
}
