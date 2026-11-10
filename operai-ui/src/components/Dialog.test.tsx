import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { FormDialog } from './FormDialog'
import { NoticeDialog } from './NoticeDialog'

afterEach(cleanup)

const confirmProps = {
  title: 'Delete request?',
  confirmLabel: 'Delete',
  busyLabel: 'Deleting…',
  cancelLabel: 'Cancel',
  closeLabel: 'Close',
  error: null,
}

describe('ConfirmDialog', () => {
  it('is a labelled, described alertdialog with Cancel focused', () => {
    render(
      <ConfirmDialog {...confirmProps} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()}>
        This cannot be undone.
      </ConfirmDialog>,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Delete request?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('cancels on Escape and on the backdrop, but not while busy', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog {...confirmProps} busy={false} onConfirm={vi.fn()} onCancel={onCancel}>
        Body
      </ConfirmDialog>,
    )
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('confirm-dialog-backdrop'))
    expect(onCancel).toHaveBeenCalledTimes(2)

    rerender(
      <ConfirmDialog {...confirmProps} busy onConfirm={vi.fn()} onCancel={onCancel}>
        Body
      </ConfirmDialog>,
    )
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('confirm-dialog-backdrop'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    const confirm = screen.getByTestId('confirm-dialog-confirm')
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(confirm).toHaveTextContent('Deleting…')
  })

  it('a press that starts inside and is released on the backdrop (a text selection) does not close', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog {...confirmProps} busy={false} onConfirm={vi.fn()} onCancel={onCancel}>
        Body
      </ConfirmDialog>,
    )
    const backdrop = screen.getByTestId('confirm-dialog-backdrop')
    fireEvent.mouseDown(screen.getByText('Body'))
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps Confirm disabled until the acknowledgement is ticked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        {...confirmProps}
        acknowledgeLabel="I understand this cannot be undone."
        busy={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      >
        Body
      </ConfirmDialog>,
    )
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(screen.getByRole('checkbox', { name: 'I understand this cannot be undone.' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('with fields: focuses the first one, submits on Enter and locks them in flight', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const fields = (
      <label>
        Reason <input name="reason" />
      </label>
    )
    const { rerender } = render(
      <ConfirmDialog {...confirmProps} fields={fields} busy={false} onConfirm={onConfirm} onCancel={vi.fn()}>
        Body
      </ConfirmDialog>,
    )
    const reason = screen.getByRole('textbox', { name: 'Reason' })
    expect(reason).toHaveFocus()
    await user.type(reason, 'Broken{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)

    rerender(
      <ConfirmDialog {...confirmProps} fields={fields} busy onConfirm={onConfirm} onCancel={vi.fn()}>
        Body
      </ConfirmDialog>,
    )
    expect(screen.getByRole('textbox', { name: 'Reason' })).toBeDisabled()
  })

  it('with fields: ignores the backdrop so typed input survives; Escape and Cancel still close', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        {...confirmProps}
        fields={
          <label>
            Reason <input name="reason" />
          </label>
        }
        busy={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      >
        Body
      </ConfirmDialog>,
    )
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Duplicate')
    await user.click(screen.getByTestId('confirm-dialog-backdrop'))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveValue('Duplicate')

    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmDialog {...confirmProps} busy={false} onConfirm={vi.fn()} onCancel={vi.fn()}>
        Body
      </ConfirmDialog>,
    )
    const close = screen.getByRole('button', { name: 'Close' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()
  })

  it('shows the request error as an alert', () => {
    render(
      <ConfirmDialog {...confirmProps} error="Server unavailable" busy={false} onConfirm={vi.fn()} onCancel={vi.fn()}>
        Body
      </ConfirmDialog>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Server unavailable')
  })

  it('returns focus to the trigger on close', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open && (
            <ConfirmDialog {...confirmProps} busy={false} onConfirm={vi.fn()} onCancel={() => setOpen(false)}>
              Body
            </ConfirmDialog>
          )}
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })
})

describe('FormDialog', () => {
  const formProps = {
    title: 'Reject request',
    submitLabel: 'Reject',
    busyLabel: 'Rejecting…',
    cancelLabel: 'Cancel',
    closeLabel: 'Close',
    error: null,
  }

  it('ignores a click on the backdrop, so typed values survive; Escape and Cancel still close', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <FormDialog {...formProps} busy={false} onSubmit={vi.fn()} onCancel={onCancel}>
        <label>
          Reason
          <input />
        </label>
      </FormDialog>,
    )
    await user.type(screen.getByLabelText('Reason'), 'Duplicate')
    await user.click(screen.getByTestId('form-dialog-backdrop'))
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Reason')).toHaveValue('Duplicate')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('focuses the first field and submits on Enter', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <FormDialog {...formProps} busy={false} onSubmit={onSubmit} onCancel={vi.fn()}>
        <label>
          Reason
          <input />
        </label>
      </FormDialog>,
    )
    const input = screen.getByRole('textbox', { name: 'Reason' })
    expect(input).toHaveFocus()
    await user.type(input, 'Missing receipt{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does not submit while canSubmit is false', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <FormDialog {...formProps} busy={false} canSubmit={false} onSubmit={onSubmit} onCancel={vi.fn()}>
        <input aria-label="Reason" />
      </FormDialog>,
    )
    await user.type(screen.getByRole('textbox'), 'x{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId('form-dialog-submit')).toBeDisabled()
  })

  it('disables the fields while busy', () => {
    render(
      <FormDialog {...formProps} busy onSubmit={vi.fn()} onCancel={vi.fn()}>
        <input aria-label="Reason" />
      </FormDialog>,
    )
    expect(screen.getByRole('textbox')).toBeDisabled()
  })
})

describe('NoticeDialog', () => {
  it('has one button, focused, and every way out acknowledges', async () => {
    const user = userEvent.setup()
    const onAcknowledge = vi.fn()
    render(
      <NoticeDialog title="Already decided" acknowledgeLabel="OK" onAcknowledge={onAcknowledge}>
        Someone else approved this request.
      </NoticeDialog>,
    )
    expect(screen.getByRole('alertdialog', { name: 'Already decided' })).toHaveAccessibleDescription(
      'Someone else approved this request.',
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('notice-dialog-backdrop'))
    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAcknowledge).toHaveBeenCalledTimes(3)
  })
})
