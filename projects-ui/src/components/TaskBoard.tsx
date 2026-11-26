import { useState } from 'react'
import type { ReactNode } from 'react'
import { Banner, Button, LoadMore, StatePanel } from '@operai/ui'
import { Board } from '@operai/ui/board'
import type { BoardLane } from '@operai/ui/board'
import type { MyTask, ProjectTask } from '../lib/activitiesApi'
import { codeOf, errorMessage, statusOf, taskErrorMessage } from '../lib/errors'
import { canMoveTask, canMoveTaskTo, moveTask, staleTaskFlags } from '../lib/taskMoves'
import type { TaskLane } from '../lib/taskMoves'
import type { TaskList, TaskLists } from '../hooks/useTaskLists'
import { strings } from '../strings'
import { Loading, Saved } from './LoadState'
import TaskCard from './TaskCard'
import TaskDrawer from './TaskDrawer'
import { taskCardLabel, taskStatus } from './TaskModel'
import type { TaskBoardMode } from './TaskModel'

/** What the board hands the page's edit dialog: the page renders it, the board reads its lists again. */
export type TaskEditProps = {
  task: ProjectTask
  onCancel: () => void
  onSaved: (message: string) => void
  onHostReadOnly: () => void
}

/** The failed-load state of the board: a permission panel, or a warning banner with Retry. */
function TaskListFailure({ error, onRetry, testIdBase }: { error: unknown; onRetry: () => void; testIdBase: string }) {
  const t = strings.tasks.loadFailure
  if (statusOf(error) === 403) {
    return (
      <StatePanel role="alert" title={strings.common.permissionDenied.heading} testId={`${testIdBase}-denied`}>
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
      data-testid={`${testIdBase}-error`}
    >
      {body}
    </Banner>
  )
}

/** A lane's "Load more", for a list whose total exceeds what is loaded; announces how many cards arrived. */
function MoreOf({ list, testId }: { list: TaskList; testId: string }) {
  const b = strings.tasks.board
  const count = list.data?.items.length ?? 0
  const [before, setBefore] = useState<number | null>(null)
  if (!list.hasMore && list.moreError === null && before === null) return null
  const announcement = before !== null && !list.loadingMore && count > before ? b.loadedMore(count - before) : ''
  return (
    <LoadMore
      hasMore={list.hasMore}
      loading={list.loadingMore}
      onLoadMore={() => {
        setBefore(count)
        list.loadMore()
      }}
      label={b.loadMore}
      loadingLabel={b.loadingMore}
      announcement={announcement}
      error={list.moreError === null ? null : errorMessage(list.moreError)}
      testId={testId}
    />
  )
}

/**
 * TaskBoard — the tasks of a project (its page) or of the person (My tasks) as ONE board: Open, In progress and Done
 * lanes (`Board`, design-system.md § Board), the same component in both places.
 *
 * - The lists are the page's `useTaskLists`: Open and In progress from `status=open` (split by each task's own
 *   status), Done from `status=done` over the last 30 days, with "Show older" for every done task and "Load more"
 *   where a total exceeds what is loaded. Cards keep the server's order.
 * - A card shows only what tells tasks apart (`TaskCard`); a click or Enter opens the drawer (`TaskDrawer`) with the
 *   whole task and every action.
 * - Dragging a card is the same write as the drawer's button (`moveTask`): Open → In progress starts, back stops,
 *   → Done completes, Done → Open reopens; Done → In progress is not offered. Only a task the person may complete
 *   and that is not blocked can be picked up. After a write the lists are read again with the cards kept on screen;
 *   a refusal shows in a banner above the board (and reads the lists again when the flags were stale).
 * - The first read shows the loading state; a failed read the card-local failure, nothing else of the page changes.
 */
export default function TaskBoard({
  mode,
  lists,
  currentUserId,
  testIdBase,
  cardTestIdPrefix,
  emptyOpen,
  saved,
  onSaved,
  renderEdit,
}: {
  mode: TaskBoardMode
  lists: TaskLists
  currentUserId: string | null
  /** `project-tasks` or `my-tasks`: `${base}-board`, `${base}-error`, `${base}-unavailable`, … */
  testIdBase: string
  /** `project-task` or `my-task`: a card is `${prefix}-${id}`, the drawer's actions `${prefix}-${id}-toggle`, … */
  cardTestIdPrefix: string
  /** The Open lane's empty text. */
  emptyOpen: string
  /** The confirmation shown above the board (a move, a delete, the page's own "Task added."). */
  saved: string | null
  onSaved: (message: string | null) => void
  /** The project page's edit dialog. Without it the drawer offers neither Edit nor Delete (My tasks). */
  renderEdit?: (props: TaskEditProps) => ReactNode
}) {
  const t = strings.tasks
  const b = t.board
  const { active, done } = lists
  const [openId, setOpenId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<MyTask | null>(null)
  const [drawerNotice, setDrawerNotice] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProjectTask | null>(null)

  const failed = active.status === 'error' ? active : done.status === 'error' ? done : null
  // The board waits for both first reads; a Done lane read again later ("Show older") says so in the lane.
  const loading = active.status === 'loading' || (done.status === 'loading' && !lists.olderDone)

  const doneItems = done.data?.items ?? []
  const doneIds = new Set(doneItems.map((task) => task.id))
  const items: MyTask[] = [...(active.data?.items ?? []).filter((task) => !doneIds.has(task.id)), ...doneItems]
  const openTask = openId === null ? null : (items.find((task) => task.id === openId) ?? snapshot)

  const cardTestId = (task: MyTask) => `${cardTestIdPrefix}-${task.id}`

  const open = (task: MyTask) => {
    setOpenId(task.id)
    setSnapshot(task)
    setDrawerNotice(null)
  }

  const close = () => {
    const id = openId
    setOpenId(null)
    setSnapshot(null)
    setDrawerNotice(null)
    // The card that opened the drawer may have moved lanes meanwhile (a new element): focus it there.
    window.setTimeout(() => {
      if (id === null || (document.activeElement && document.activeElement !== document.body)) return
      const card = [...document.querySelectorAll<HTMLElement>('[data-testid]')].find(
        (element) => element.dataset.testid === `${cardTestIdPrefix}-${id}`,
      )
      card?.focus()
    }, 0)
  }

  const move = (task: MyTask, lane: TaskLane) => {
    setMoveError(null)
    moveTask(task, lane).then(
      (message) => {
        onSaved(message)
        lists.reload()
      },
      (failure: unknown) => {
        setMoveError(taskErrorMessage(failure, 'row'))
        if (staleTaskFlags(failure)) lists.reload()
      },
    )
  }

  const unavailable = mode === 'my' && [active, done].some((list) => list.data?.unavailable.includes('crm') === true)

  const countOf = (lane: TaskLane) => items.filter((task) => taskStatus(task) === lane).length
  const doneLoading = done.status === 'loading'
  const lanes: BoardLane<TaskLane>[] = [
    {
      id: 'open',
      title: t.open,
      count: countOf('open'),
      label: b.lanes.open,
      empty: emptyOpen,
      footer: <MoreOf list={active} testId={`${testIdBase}-open-more`} />,
    },
    {
      id: 'in_progress',
      title: t.inProgress,
      count: countOf('in_progress'),
      label: b.lanes.in_progress,
      empty: b.emptyInProgress,
    },
    {
      id: 'done',
      title: t.done,
      count: countOf('done'),
      label: b.lanes.done,
      header: lists.olderDone ? undefined : <p className="text-xs text-soft">{b.doneRecent}</p>,
      empty: doneLoading ? b.loadingLane : lists.olderDone ? b.emptyDoneAll : b.emptyDoneRecent,
      footer: (
        <>
          <MoreOf list={done} testId={`${testIdBase}-done-more`} />
          {!lists.olderDone && (
            <Button size="sm" variant="ghost" onClick={lists.showOlderDone} data-testid={`${testIdBase}-show-older`}>
              {b.showOlder}
            </Button>
          )}
        </>
      ),
    },
  ]

  let content: ReactNode
  if (failed !== null)
    content = (
      <TaskListFailure
        error={failed.error}
        onRetry={() => {
          if (active.status === 'error') active.reload()
          if (done.status === 'error') done.reload()
        }}
        testIdBase={testIdBase}
      />
    )
  else if (loading) content = <Loading label={mode === 'my' ? t.my.loading : t.loading} />
  else
    content = (
      <Board<MyTask, TaskLane>
        lanes={lanes}
        items={items}
        idOf={(task) => task.id}
        laneOf={(task) => taskStatus(task)}
        titleOf={(task) => task.subject}
        cardLabel={(task) => taskCardLabel(task, mode, currentUserId)}
        renderCard={(task) => <TaskCard task={task} mode={mode} currentUserId={currentUserId} />}
        canDrag={canMoveTask}
        canDrop={canMoveTaskTo}
        onMove={move}
        onOpen={open}
        copy={{
          label: mode === 'my' ? t.my.boardLabel : b.label,
          dragInstructions: b.dragInstructions,
          picked: b.picked,
          over: b.over,
          dropped: b.dropped,
          cancelled: b.cancelled,
        }}
        testId={`${testIdBase}-board`}
        laneTestId={(lane) => `${testIdBase}-lane-${lane}`}
        cardTestId={cardTestId}
      />
    )

  return (
    <div className="flex flex-col gap-3">
      {unavailable && (
        <Banner
          tone="warning"
          live="polite"
          title={t.my.unavailableTitle}
          onRetry={lists.reload}
          retryLabel={strings.common.retry}
          data-testid={`${testIdBase}-unavailable`}
        >
          {t.my.unavailableBody}
        </Banner>
      )}
      {saved && <Saved message={saved} onDismiss={() => onSaved(null)} />}
      {moveError && failed === null && (
        <Banner
          tone="danger"
          title={b.moveFailedTitle}
          onDismiss={() => setMoveError(null)}
          dismissLabel={strings.common.dismiss}
          data-testid={`${testIdBase}-move-error`}
        >
          {moveError}
        </Banner>
      )}
      {content}
      {openTask !== null && (
        <TaskDrawer
          task={openTask}
          mode={mode}
          currentUserId={currentUserId}
          testIdPrefix={cardTestIdPrefix}
          notice={drawerNotice}
          onDismissNotice={() => setDrawerNotice(null)}
          onClose={close}
          onWritten={(message) => {
            setDrawerNotice(message)
            lists.reload()
          }}
          onDeleted={(message) => {
            close()
            onSaved(message)
            lists.reload()
          }}
          onStale={lists.reload}
          onEdit={renderEdit ? setEditing : undefined}
        />
      )}
      {editing !== null &&
        renderEdit?.({
          task: editing,
          onCancel: () => setEditing(null),
          onSaved: (message) => {
            setEditing(null)
            setDrawerNotice(message)
            lists.reload()
          },
          onHostReadOnly: lists.reload,
        })}
    </div>
  )
}
