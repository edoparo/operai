import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { Dialog } from './Dialog'

afterEach(cleanup)

/**
 * A dialog that opens a confirmation on top of itself (estimai's collaborators
 * dialog → "Remove this collaborator?"). Only the topmost dialog may react to
 * the keyboard; the one underneath waits until it is on top again.
 */
function Harness({ onOuterClose = vi.fn(), onInnerCancel = vi.fn() }) {
  const [inner, setInner] = useState(false)
  return (
    <Dialog title="Collaborators" closeLabel="Close" onClose={onOuterClose}>
      <button onClick={() => setInner(true)}>Remove Ada</button>
      <button>Add collaborator</button>
      {inner && (
        <ConfirmDialog
          title="Remove Ada?"
          confirmLabel="Remove"
          busyLabel="Removing…"
          cancelLabel="Cancel"
          closeLabel="Close confirmation"
          busy={false}
          error={null}
          onConfirm={vi.fn()}
          onCancel={() => {
            onInnerCancel()
            setInner(false)
          }}
        >
          Ada loses access.
        </ConfirmDialog>
      )}
    </Dialog>
  )
}

describe('nested dialogs', () => {
  it('Escape closes only the topmost dialog, then the one underneath', async () => {
    const user = userEvent.setup()
    const onOuterClose = vi.fn()
    const onInnerCancel = vi.fn()
    render(<Harness onOuterClose={onOuterClose} onInnerCancel={onInnerCancel} />)

    await user.click(screen.getByRole('button', { name: 'Remove Ada' }))
    expect(screen.getByRole('alertdialog', { name: 'Remove Ada?' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onInnerCancel).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Focus went back to the control that opened the confirmation.
    expect(screen.getByRole('button', { name: 'Remove Ada' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(onOuterClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the nested dialog on top when both mount in the same render', async () => {
    // React runs the inner dialog's effects first, so it registers first; the
    // outer one must still end up below it.
    const user = userEvent.setup()
    const onOuterClose = vi.fn()
    const onInnerClose = vi.fn()
    render(
      <Dialog title="Outer" closeLabel="Close outer" onClose={onOuterClose}>
        <Dialog title="Inner" closeLabel="Close inner" onClose={onInnerClose}>
          <button>Inside</button>
        </Dialog>
      </Dialog>,
    )

    await user.keyboard('{Escape}')
    expect(onInnerClose).toHaveBeenCalledTimes(1)
    expect(onOuterClose).not.toHaveBeenCalled()
  })

  it('Tab stays inside the topmost dialog, even when its markup is inside the outer one', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Remove Ada' }))

    const inner = screen.getByRole('alertdialog')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(inner.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true })
      expect(inner.contains(document.activeElement)).toBe(true)
    }
  })
})
