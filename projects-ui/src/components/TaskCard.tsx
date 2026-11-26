import { Badge, StatusBadge } from '@operai/ui'
import type { MyTask } from '../lib/activitiesApi'
import { strings } from '../strings'
import { TASK_STATE_MEANING, assigneeOf, attentionOf, dueOf, taskContext } from './TaskModel'
import type { TaskBoardMode } from './TaskModel'

/**
 * TaskCard — what a task's card on the board shows, and nothing more (design-system.md § Board): its title, where it
 * belongs (My tasks only: its project, or "Pre-sales" and its company and deal), its due date, its assignee, and a
 * state badge only when it needs attention. No buttons: the card opens the drawer, which has them all.
 */
export default function TaskCard({
  task,
  mode,
  currentUserId,
}: {
  task: MyTask
  mode: TaskBoardMode
  currentUserId: string | null
}) {
  const attention = attentionOf(task)
  const context = mode === 'my' ? taskContext(task) : null
  const assignee = assigneeOf(task, currentUserId)
  return (
    <div className="flex flex-col gap-1">
      {mode === 'my' && (task.kind === 'pre_sales' || context !== null) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
          {task.kind === 'pre_sales' && <Badge tone="neutral">{strings.tasks.my.preSales}</Badge>}
          {context !== null && <span>{context}</span>}
        </div>
      )}
      <span className="font-medium text-text">{task.subject}</span>
      <span className="text-xs text-soft">{dueOf(task)}</span>
      {assignee !== null && <span className="text-xs text-soft">{assignee}</span>}
      {attention !== null && (
        <span>
          <StatusBadge status={TASK_STATE_MEANING[attention]}>{strings.tasks.state[attention]}</StatusBadge>
        </span>
      )}
    </div>
  )
}
