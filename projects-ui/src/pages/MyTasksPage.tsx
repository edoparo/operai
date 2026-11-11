import { useCallback, useId, useState } from 'react'
import { Banner, ListRows, PageHeader, Pagination, StatePanel, Tabs, tabPanelProps } from '@operai/ui'
import { Loading, Saved } from '../components/LoadState'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useResource } from '../hooks/useResource'
import { listMyTasks } from '../lib/activitiesApi'
import type { TaskStatus } from '../lib/activitiesApi'
import { codeOf, errorMessage, statusOf } from '../lib/errors'
import { strings } from '../strings'
import MyTaskItem from './MyTasksPageRow'

const PAGE_SIZE = 25
const TABS_ID = 'my-tasks'

/** The page-level failure: a permission panel, or a warning banner with Retry. */
function MyTasksLoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = strings.tasks.loadFailure
  if (statusOf(error) === 403) {
    return (
      <StatePanel role="alert" title={strings.common.permissionDenied.heading} testId="my-tasks-denied">
        {strings.common.permissionDenied.body}
      </StatePanel>
    )
  }
  const code = codeOf(error)
  const [title, body] =
    code === 'host_unavailable'
      ? [t.hostUnavailableTitle, t.hostUnavailable]
      : code === 'maintenance'
        ? [t.maintenanceTitle, t.maintenance]
        : statusOf(error) === 503
          ? [strings.common.authUnavailable.heading, strings.common.authUnavailable.body]
          : [strings.common.loadErrorTitle, errorMessage(error)]
  return (
    <Banner
      tone="warning"
      title={title}
      onRetry={onRetry}
      retryLabel={strings.common.retry}
      data-testid="my-tasks-error"
    >
      {body}
    </Banner>
  )
}

/**
 * MyTasksPage — `/projects/tasks` (US-7, design S4, F7): the caller's project tasks and
 * pre-sales tasks (assigned to them or where they take part) in the ONE order the server
 * sends (AC-7.2, AC-3.4), Open / Done. The page never sorts, merges or filters; it asks for
 * `kind=all&assignee=me` and renders what comes back.
 *
 * - A caller who cannot read the CRM simply gets no pre-sales rows and no notice (AC-7.4).
 * - When the CRM could not be reached the response says `unavailable: ["crm"]`: the project
 *   rows still render, with a warning above the list announced as status and a Retry (AC-7.5).
 * - There is no "New task" here: tasks are created on a project or in the CRM.
 */
export default function MyTasksPage() {
  const t = strings.tasks.my
  const titleId = useId()
  const currentUserId = useCurrentUserId()
  const [view, setView] = useState<TaskStatus>('open')
  const [pageNumber, setPageNumber] = useState(1)
  const [saved, setSaved] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const load = useCallback(
    (signal: AbortSignal) => listMyTasks({ status: view, page: pageNumber, pageSize: PAGE_SIZE }, { signal }),
    [view, pageNumber],
  )
  const tasks = useResource(load)

  /** Where focus rests when a row leaves the view: the selected tab is stable and visible. */
  const focusTab = () => document.getElementById(`${TABS_ID}-tab-${view}`)?.focus()

  const changed = (message: string) => {
    setSaved(message)
    setRowErrors({})
    // The last row of a later page left: step back so the page is not empty.
    if ((tasks.data?.items.length ?? 0) === 1 && pageNumber > 1) setPageNumber(pageNumber - 1)
    else tasks.retry()
    focusTab()
  }

  const rowFailed = (id: string, message: string | null, reload: boolean) => {
    setRowErrors((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== id))
      return message === null ? rest : { ...rest, [id]: message }
    })
    if (reload) tasks.retry()
  }

  const unavailable = tasks.data?.unavailable?.includes('crm') === true

  let content
  if (tasks.status === 'loading') content = <Loading label={t.loading} />
  else if (tasks.status === 'error') content = <MyTasksLoadFailure error={tasks.error} onRetry={tasks.retry} />
  else
    content = (
      <div className="flex flex-col gap-3">
        {unavailable && (
          <Banner
            tone="warning"
            live="polite"
            title={t.unavailableTitle}
            onRetry={tasks.retry}
            retryLabel={strings.common.retry}
            data-testid="my-tasks-unavailable"
          >
            {t.unavailableBody}
          </Banner>
        )}
        {tasks.data!.items.length === 0 ? (
          view === 'open' ? (
            <StatePanel title={t.emptyOpenTitle}>{t.emptyOpenBody}</StatePanel>
          ) : (
            <StatePanel title={t.emptyDoneTitle}>{t.emptyDoneBody}</StatePanel>
          )
        ) : (
          <ListRows label={t.listLabel} testId="my-tasks-list">
            {tasks.data!.items.map((task) => (
              <MyTaskItem
                key={task.id}
                task={task}
                currentUserId={currentUserId}
                error={rowErrors[task.id]}
                onChanged={changed}
                onFailed={rowFailed}
              />
            ))}
          </ListRows>
        )}
        {tasks.data!.total > PAGE_SIZE && (
          <Pagination
            page={pageNumber}
            pageSize={PAGE_SIZE}
            total={tasks.data!.total}
            onPageChange={setPageNumber}
            label={strings.common.pagination.label}
            previousLabel={strings.common.pagination.previous}
            nextLabel={strings.common.pagination.next}
            status={strings.common.pagination.status}
            testId="my-tasks-pagination"
          />
        )}
      </div>
    )

  return (
    <section aria-labelledby={titleId} data-testid="my-tasks-page" className="flex flex-col gap-4">
      <PageHeader title={t.heading} titleId={titleId} description={t.description} />
      <Tabs
        label={strings.tasks.viewsLabel}
        idPrefix={TABS_ID}
        value={view}
        onChange={(next) => {
          setView(next)
          setPageNumber(1)
          setRowErrors({})
        }}
        tabs={[
          { id: 'open', label: strings.tasks.open },
          { id: 'done', label: strings.tasks.done },
        ]}
        testId="my-tasks-tabs"
      />
      <div {...tabPanelProps(TABS_ID, view)} className="flex flex-col gap-3">
        {saved && <Saved message={saved} onDismiss={() => setSaved(null)} />}
        {content}
      </div>
    </section>
  )
}
