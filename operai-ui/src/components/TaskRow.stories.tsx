import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Button } from './Button'
import { ListRows } from './ListRows'
import { TaskRow } from './TaskRow'
import type { TaskRowProps } from './TaskRow'

/**
 * One task in a list: a state badge (glyph + text, never colour alone), the title, meta lines, what it is
 * waiting on, and Mark done / Reopen plus the app's own buttons. Presentational: the app binds it to its API
 * and passes every string. A blocked task's Mark done is `aria-disabled`: Tab reaches it and a screen reader
 * hears the "Waiting on …" line; the click is ignored. Check both themes with the Theme toolbar.
 */
const meta = {
  title: 'Components/Data/TaskRow',
  component: TaskRow,
  tags: ['autodocs'],
  args: {
    state: 'open',
    stateLabel: 'Open',
    title: 'Send the offer to Acme',
    meta: ['Due 12.11.2026 · Assigned to Anna Rossi'],
    completeLabel: 'Mark done',
    actionsLabel: 'Actions for Send the offer to Acme',
    onComplete: () => {},
  },
  argTypes: { leading: { control: false }, actions: { control: false }, children: { control: false } },
  decorators: [
    (Story) => (
      <div className="w-[40rem] max-w-full">
        <ListRows label="Tasks">
          <Story />
        </ListRows>
      </div>
    ),
  ],
} satisfies Meta<typeof TaskRow>
export default meta

type Story = StoryObj<typeof meta>

const editDelete = (
  <>
    <Button size="sm" variant="ghost" aria-haspopup="dialog">
      Edit
    </Button>
    <Button size="sm" variant="ghost" aria-haspopup="dialog">
      Delete
    </Button>
  </>
)

export const Open: Story = { args: { actions: editDelete } }

export const Overdue: Story = {
  args: {
    state: 'overdue',
    stateLabel: 'Overdue',
    meta: ['Due 02.11.2026 · Assigned to Anna Rossi'],
    actions: editDelete,
  },
}

/** Tab to Mark done: it is reachable, announced as unavailable and described by the line above it. */
export const Blocked: Story = {
  args: {
    state: 'blocked',
    stateLabel: 'Blocked',
    waiting: 'Waiting on Draft the contract, Get legal review. Finish those first.',
    actions: editDelete,
  },
}

export const Done: Story = {
  args: {
    state: 'done',
    stateLabel: 'Done',
    completeLabel: 'Reopen',
    meta: ['Due 12.11.2026 · Assigned to Anna Rossi · Completed by Bruno Bianchi on 10.11.2026'],
  },
}

/** Badges before the state, a body, several meta lines. */
export const Full: Story = {
  args: {
    leading: <Badge tone="neutral">Pre-sales</Badge>,
    body: <p className="text-sm text-soft">Check the scope with the client before the call.</p>,
    meta: [
      'By Anna Rossi · 10.11.2026 09:30',
      'Due 12.11.2026 · Assigned to Bruno Bianchi',
      'With Chiara Verdi, Dario Neri',
    ],
    actions: editDelete,
  },
}

export const Failed: Story = { args: { error: 'The task could not be saved. Try again.' } }

/** Without `onComplete` the row is read-only. */
export const ReadOnly: Story = { args: { onComplete: undefined, completeLabel: undefined, actionsLabel: undefined } }

/** The button shows its busy label and ignores clicks. */
export const Completing: Story = { args: { completing: true, completingLabel: 'Saving…' } }

/** An app can remap a state's meaning (CRM shows Blocked as "waiting for someone else"). */
export const CustomMeaning: Story = {
  args: {
    state: 'blocked',
    stateLabel: 'Blocked',
    stateMeanings: { blocked: 'pending' },
    waiting: 'Waiting on Draft. Finish those first.',
  },
}

/** All four states, as a list. */
export const Lifecycle: Story = {
  render: () => {
    const [done, setDone] = useState(false)
    const rows: TaskRowProps[] = [
      { state: 'open', stateLabel: 'Open', title: 'Call the client', meta: ['Due 12.11.2026'] },
      { state: 'overdue', stateLabel: 'Overdue', title: 'Send the invoice', meta: ['Due 02.11.2026'] },
      {
        state: 'blocked',
        stateLabel: 'Blocked',
        title: 'Sign the contract',
        meta: ['No due date'],
        waiting: 'Waiting on Send the invoice. Finish those first.',
      },
    ]
    return (
      <>
        {rows.map((row) => (
          <TaskRow
            key={row.title as string}
            {...row}
            completeLabel="Mark done"
            onComplete={() => {}}
            actionsLabel={`Actions for ${row.title as string}`}
          />
        ))}
        <TaskRow
          state={done ? 'done' : 'open'}
          stateLabel={done ? 'Done' : 'Open'}
          title="Interactive: toggle me"
          meta={['Due 20.11.2026']}
          completeLabel={done ? 'Reopen' : 'Mark done'}
          onComplete={() => setDone(!done)}
          actionsLabel="Actions for Interactive: toggle me"
        />
      </>
    )
  },
}
