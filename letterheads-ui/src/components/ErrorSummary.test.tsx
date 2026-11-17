/**
 * @vitest-environment jsdom
 *
 * ErrorSummary (task T24; design F7.3, S4; AC-8.3): the alert that says nothing was saved and lists what was
 * refused, one button per problem.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { ErrorSummary } from './ErrorSummary'

afterEach(() => cleanup())

const problems = [
  { path: '/margins/top', reason: 'out_of_range' },
  { path: '/variants/default/footer', reason: 'footer_overflow' },
]

describe('ErrorSummary', () => {
  it('is an alert that says nothing was saved and how many values were refused', () => {
    render(<ErrorSummary problems={problems} describe={(problem) => `S ${problem.path}`} onGo={() => undefined} />)
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Nothing was saved: 2 values were refused')).not.toBeNull()
    expect(within(alert).getByText('Fix them and save again.')).not.toBeNull()
    expect(within(alert).getAllByRole('listitem')).toHaveLength(2)
  })

  it('says "1 value was refused" for one', () => {
    render(<ErrorSummary problems={problems.slice(0, 1)} describe={() => 'x'} onGo={() => undefined} />)
    expect(screen.getByText('Nothing was saved: 1 value was refused')).not.toBeNull()
  })

  it('lists a button per problem, reading the sentence, that goes to the problem’s path', async () => {
    const onGo = vi.fn()
    render(<ErrorSummary problems={problems} describe={(problem) => `Sentence of ${problem.path}`} onGo={onGo} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Sentence of /margins/top',
      'Sentence of /variants/default/footer',
    ])
    await userEvent.click(buttons[1])
    expect(onGo).toHaveBeenCalledExactlyOnceWith('/variants/default/footer')
  })

  it('can be used with the keyboard: the buttons are in the tab order and Enter activates', async () => {
    const onGo = vi.fn()
    render(<ErrorSummary problems={problems} describe={(problem) => problem.reason} onGo={onGo} />)
    await userEvent.tab()
    expect(document.activeElement?.textContent).toBe('out_of_range')
    await userEvent.keyboard('{Enter}')
    expect(onGo).toHaveBeenCalledWith('/margins/top')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(<ErrorSummary problems={problems} describe={(p) => p.reason} onGo={() => undefined} />)
    expect(await axeViolations(container)).toEqual([])
  })
})
