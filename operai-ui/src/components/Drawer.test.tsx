import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Drawer } from './Drawer'

afterEach(cleanup)

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Help
      </button>
      {open && (
        <Drawer
          title="Model reference"
          description="Formulas and glossary"
          closeLabel="Close"
          onClose={() => {
            onClose()
            setOpen(false)
          }}
        >
          <a href="#formulas">Formulas</a>
        </Drawer>
      )}
    </>
  )
}

describe('Drawer', () => {
  it('is a modal dialog named by its title and described by its description', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))

    const drawer = screen.getByRole('dialog', { name: 'Model reference' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(drawer).toHaveAccessibleDescription('Formulas and glossary')
  })

  it('moves focus to its heading on open and back to the trigger on Escape', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Help' })
    await userEvent.click(trigger)

    expect(screen.getByRole('heading', { name: 'Model reference' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes from × and from the backdrop, never from a click inside', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))

    await userEvent.click(screen.getByText('Formulas and glossary'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Help' }))
    await userEvent.click(screen.getByTestId('drawer-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
