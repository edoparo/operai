import { useCallback, useId, useState } from 'react'
import { PageHeader } from '@operai/ui'
import TaskBoard from '../components/TaskBoard'
import { useCurrentUserId } from '../hooks/useCurrentUserId'
import { useTaskLists } from '../hooks/useTaskLists'
import type { TaskLister } from '../hooks/useTaskLists'
import { listMyTasks } from '../lib/activitiesApi'
import { strings } from '../strings'

/**
 * MyTasksPage — `/projects/tasks` (US-7, design S4, F7): the caller's project tasks and pre-sales tasks (assigned to
 * them or where they take part) as the same board as a project's (`TaskBoard`): Open, In progress and Done, each lane
 * in the ONE order the server sends (AC-7.2, AC-3.4). The page never sorts, merges or filters; it asks for
 * `kind=all&assignee=me` and renders what comes back.
 *
 * - A caller who cannot read the CRM simply gets no pre-sales cards and no notice (AC-7.4).
 * - When the CRM could not be reached the response says `unavailable: ["crm"]`: the project cards still render, with
 *   a warning above the board announced as status and a Retry (AC-7.5).
 * - There is no "New task" here, and no Edit or Delete: tasks are created and changed on a project or in the CRM.
 */
export default function MyTasksPage() {
  const t = strings.tasks.my
  const titleId = useId()
  const currentUserId = useCurrentUserId()
  const [saved, setSaved] = useState<string | null>(null)
  const list = useCallback<TaskLister>((query, init) => listMyTasks(query, init), [])
  const lists = useTaskLists(list)

  return (
    <section aria-labelledby={titleId} data-testid="my-tasks-page" className="flex flex-col gap-4">
      <PageHeader title={t.heading} titleId={titleId} description={t.description} />
      <TaskBoard
        mode="my"
        lists={lists}
        currentUserId={currentUserId}
        testIdBase="my-tasks"
        cardTestIdPrefix="my-task"
        emptyOpen={t.emptyOpen}
        saved={saved}
        onSaved={setSaved}
      />
    </section>
  )
}
