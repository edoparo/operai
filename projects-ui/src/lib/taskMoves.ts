/**
 * The moves of a task between the board's lanes (Open, In progress, Done) and the ONE write each one is. Dragging a
 * card and pressing the drawer's buttons call the same functions, so a move is never something only the board can do
 * (design-system.md § Board) and never a different write from the button's.
 *
 * Who may move what is the task's own `may.complete` (the server decided it for this caller, as for the buttons) and
 * its state: a blocked task cannot be started or completed, so it does not move at all. Done → In progress is not a
 * move: a done task is reopened (Done → Open) and then started.
 */
import { setTaskCompleted, startTask, stopTask } from './activitiesApi'
import type { MyTask } from './activitiesApi'
import { codeOf, statusOf } from './errors'
import { taskState, taskStatus } from '../components/TaskModel'
import { strings } from '../strings'

export type TaskLane = 'open' | 'in_progress' | 'done'

/** From each lane, the lanes a card may be dropped in. */
const MOVES: Record<TaskLane, readonly TaskLane[]> = {
  open: ['in_progress', 'done'],
  in_progress: ['open', 'done'],
  done: ['open'],
}

/** Whether the card can be picked up at all: the person may complete it, and it is not blocked. */
export const canMoveTask = (task: MyTask): boolean => task.may.complete && taskState(task) !== 'blocked'

/** Whether the card may be dropped in `lane`. */
export const canMoveTaskTo = (task: MyTask, lane: TaskLane): boolean =>
  canMoveTask(task) && MOVES[taskStatus(task)].includes(lane)

/**
 * Performs the write that moves `task` to `lane` and resolves with the confirmation to show: start (Open → In
 * progress), stop (In progress → Open), complete (→ Done) or reopen (Done → Open). Rejects with the server's refusal.
 */
export function moveTask(task: MyTask, lane: TaskLane): Promise<string> {
  const saved = strings.tasks.saved
  const from = taskStatus(task)
  if (lane === 'done') return setTaskCompleted(task.id, true).then(() => saved.completed)
  if (from === 'done') return setTaskCompleted(task.id, false).then(() => saved.reopened)
  if (lane === 'in_progress') return startTask(task.id).then(() => saved.started)
  return stopTask(task.id).then(() => saved.stopped)
}

/** A refusal that means the task's flags were stale: the lists are read again to get fresh `may` flags. */
export const staleTaskFlags = (failure: unknown): boolean =>
  codeOf(failure) === 'forbidden' || codeOf(failure) === 'task_blocked' || statusOf(failure) === 404
