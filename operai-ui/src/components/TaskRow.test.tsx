import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskRow } from './TaskRow'
import type { TaskRowProps } from './TaskRow'

afterEach(cleanup)

const base: TaskRowProps = {
  state: 'open',
  stateLabel: 'Open',
  title: 'Send the offer',
  meta: ['Due 12.11.2026 · Assigned to Anna'],
  actionsLabel: 'Actions for Send the offer',
  onComplete: () => {},
  completeLabel: 'Mark done',
  testId: 'row',
}

describe('TaskRow', () => {
  it('shows the state as glyph plus text, the title and every meta line', () => {
    render(<TaskRow {...base} meta={['By Anna', 'Due 12.11.2026']} />)
    const row = screen.getByTestId('row')
    const badge = within(row).getByText('Open').closest('.badge')
    expect(badge).not.toBeNull()
    expect(badge!.querySelector('svg')).not.toBeNull()
    expect(within(row).getByText('Send the offer')).toBeInTheDocument()
    expect(within(row).getByText('By Anna')).toBeInTheDocument()
    expect(within(row).getByText('Due 12.11.2026')).toBeInTheDocument()
  })

  it('conveys overdue by a glyph and its text, not by colour alone', () => {
    render(<TaskRow {...base} state="overdue" stateLabel="Overdue" />)
    const badge = screen.getByText('Overdue').closest('.badge')!
    expect(badge.querySelector('svg')).not.toBeNull()
    expect(badge).toHaveClass('badge-warning')
  })

  it('lets the app remap a state to another meaning', () => {
    render(<TaskRow {...base} state="blocked" stateLabel="Blocked" stateMeanings={{ blocked: 'pending' }} />)
    expect(screen.getByText('Blocked').closest('.badge')).toHaveClass('badge-accent')
  })

  it('conveys Blocked by a glyph and text, and names what it waits on', () => {
    render(
      <TaskRow
        {...base}
        state="blocked"
        stateLabel="Blocked"
        waiting="Waiting on Draft, Review. Finish those first."
      />,
    )
    const badge = screen.getByText('Blocked').closest('.badge')!
    expect(badge.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('Waiting on Draft, Review. Finish those first.')).toBeVisible()
  })

  it('blocked Mark done is aria-disabled, reachable, described by the waiting line, and ignores clicks', async () => {
    const onComplete = vi.fn()
    render(
      <TaskRow
        {...base}
        state="blocked"
        stateLabel="Blocked"
        waiting="Waiting on Draft. Finish those first."
        onComplete={onComplete}
      />,
    )
    const button = screen.getByRole('button', { name: 'Mark done' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)).toHaveTextContent('Waiting on Draft. Finish those first.')
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.click(button)
    await userEvent.keyboard('{Enter}')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('an unblocked Mark done is a plain enabled button that calls back', async () => {
    const onComplete = vi.fn()
    render(<TaskRow {...base} onComplete={onComplete} />)
    const button = screen.getByRole('button', { name: 'Mark done' })
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).not.toHaveAttribute('aria-describedby')
    await userEvent.click(button)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('a done task shows no waiting hint and its button is not blocked', () => {
    render(<TaskRow {...base} state="done" stateLabel="Done" waiting="Waiting on X" completeLabel="Reopen" />)
    expect(screen.queryByText('Waiting on X')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reopen' })).not.toHaveAttribute('aria-disabled')
  })

  it('shows the busy label while completing and ignores a second click', async () => {
    const onComplete = vi.fn()
    render(<TaskRow {...base} completing completingLabel="Saving…" onComplete={onComplete} />)
    const button = screen.getByRole('button', { name: 'Saving…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('has no Mark done button without onComplete, and no group without any action', () => {
    const { onComplete, ...without } = base
    void onComplete
    render(<TaskRow {...without} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('puts the app actions in one labelled group with the complete button', () => {
    render(<TaskRow {...base} actions={<button type="button">Edit</button>} />)
    const group = screen.getByRole('group', { name: 'Actions for Send the offer' })
    expect(within(group).getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('announces a failed action as an alert, and renders body and leading badges', () => {
    render(<TaskRow {...base} error="Could not save" body="Call them" leading={<span>Call</span>} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByText('Call them')).toBeInTheDocument()
    expect(screen.getByText('Call')).toBeInTheDocument()
  })

  it('gives each row its own hint id', () => {
    render(
      <>
        <TaskRow {...base} state="blocked" stateLabel="Blocked" waiting="Waiting on A" testId="a" />
        <TaskRow {...base} state="blocked" stateLabel="Blocked" waiting="Waiting on B" testId="b" />
      </>,
    )
    const [first, second] = screen.getAllByRole('button', { name: 'Mark done' })
    expect(first!.getAttribute('aria-describedby')).not.toBe(second!.getAttribute('aria-describedby'))
  })
})
