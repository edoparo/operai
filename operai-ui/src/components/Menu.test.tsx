import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu, MenuItem } from './Menu'

afterEach(cleanup)

function renderMenu(onAbout = vi.fn()) {
  render(
    <>
      <Menu triggerLabel="Suite menu" trigger="Logo" header="Alex Rivera">
        <MenuItem onClick={onAbout}>About</MenuItem>
        <a href="#profile" role="menuitem" className="menu-item">
          My profile
        </a>
        <MenuItem>Sign out</MenuItem>
      </Menu>
      <button type="button">Outside</button>
    </>,
  )
  return onAbout
}

describe('Menu', () => {
  it('is a menu button: closed until pressed, then focuses the first item', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Suite menu' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toHaveTextContent('Alex Rivera')
    expect(screen.getByRole('menuitem', { name: 'About' })).toHaveFocus()
  })

  it('moves with the arrows (wrapping), Home and End', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByRole('button', { name: 'Suite menu' }))
    const [about, profile, signOut] = screen.getAllByRole('menuitem')

    await user.keyboard('{ArrowDown}')
    expect(profile).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(signOut).toHaveFocus()
    await user.keyboard('{Home}')
    expect(about).toHaveFocus()
    await user.keyboard('{End}')
    expect(signOut).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Suite menu' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('closes when an item is chosen, on a click outside and on Tab', async () => {
    const user = userEvent.setup()
    const onAbout = renderMenu()
    const trigger = screen.getByRole('button', { name: 'Suite menu' })

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'About' }))
    expect(onAbout).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(trigger)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(trigger)
    await user.tab()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
