import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip } from './Tooltip'

afterEach(cleanup)

function renderTooltip() {
  render(
    <Tooltip content="Lets the deal skip the estimate.">
      {(describedBy) => (
        <button type="button" {...describedBy}>
          Override gate
        </button>
      )}
    </Tooltip>,
  )
  return screen.getByRole('button', { name: 'Override gate' })
}

describe('Tooltip', () => {
  it('describes the trigger, hidden until hovered', async () => {
    const user = userEvent.setup()
    const trigger = renderTooltip()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(trigger).toHaveAccessibleDescription('Lets the deal skip the estimate.')

    await user.hover(trigger)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Lets the deal skip the estimate.')
    await user.unhover(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens on keyboard focus and closes with Escape', async () => {
    const user = userEvent.setup()
    const trigger = renderTooltip()
    await user.tab()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('tooltip')).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})
