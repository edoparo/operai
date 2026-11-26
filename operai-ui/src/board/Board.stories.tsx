import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Board } from './Board'
import type { BoardLane } from './Board'

/**
 * Cards in lanes, moved between lanes by dragging: a pipeline's stages, a list of tasks by status. Pointer: press and
 * move 8 px; a click opens the card. Keyboard: Tab to a card, Space picks it up, ←/→ jump a lane, Space drops, Escape
 * cancels, Enter opens. A lane that does not accept the dragged card is dimmed. The board only reports a drop
 * (`onMove`); the app writes and re-renders. Ships from `@operai/ui/board` because it needs `@dnd-kit/core`.
 */
const meta = {
  title: 'Components/Board',
  component: Board,
  tags: ['autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof Board>
export default meta

type Story = StoryObj

type Status = 'open' | 'in_progress' | 'done'
type Task = { id: string; title: string; status: Status; due?: string; blocked?: boolean }

const TASKS: Task[] = [
  { id: '1', title: 'Collect the requirements', status: 'open', due: '12.12.2026' },
  { id: '2', title: 'Set up the staging environment', status: 'open', blocked: true },
  { id: '3', title: 'Draft the data model', status: 'in_progress', due: '05.12.2026' },
  { id: '4', title: 'Kick-off meeting', status: 'done' },
]

const COPY = {
  label: 'Tasks',
  dragInstructions: 'Press Space to pick up a task, the arrows to move it, Space to drop it, Escape to cancel.',
  picked: (task: string, lane: string) => `Picked up ${task}, in ${lane}.`,
  over: (task: string, lane: string) => `${task} is over ${lane}.`,
  dropped: (task: string, lane: string) => `${task} moved to ${lane}.`,
  cancelled: (task: string) => `${task} was not moved.`,
}

function TaskBoard() {
  const [tasks, setTasks] = useState(TASKS)
  const lanes: BoardLane<Status>[] = [
    { id: 'open', title: 'Open', label: 'Open tasks', empty: 'No open tasks' },
    { id: 'in_progress', title: 'In progress', label: 'Tasks in progress', empty: 'Nothing in progress' },
    { id: 'done', title: 'Done', label: 'Done tasks', empty: 'Nothing done in the last 30 days' },
  ].map((lane) => ({ ...lane, count: tasks.filter((task) => task.status === lane.id).length }) as BoardLane<Status>)
  return (
    <Board<Task, Status>
      lanes={lanes}
      items={tasks}
      idOf={(task) => task.id}
      laneOf={(task) => task.status}
      titleOf={(task) => task.title}
      canDrag={(task) => !task.blocked}
      onMove={(moved, status) => setTasks((all) => all.map((task) => (task.id === moved.id ? { ...task, status } : task)))}
      onOpen={() => undefined}
      copy={COPY}
      renderCard={(task) => (
        <>
          <span className="text-sm font-medium">{task.title}</span>
          <span className="text-xs text-soft">{task.blocked ? 'Blocked' : (task.due ?? 'No due date')}</span>
        </>
      )}
    />
  )
}

export const Tasks: Story = { render: () => <TaskBoard /> }
