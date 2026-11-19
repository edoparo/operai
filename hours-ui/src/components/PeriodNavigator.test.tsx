/**
 * @vitest-environment jsdom
 *
 * PeriodNavigator — previous week, this week, next week (specs/20261116-record-hours-in-place T9; design S7
 * "Navigator"; AC-5.5). It holds no state: it is told the week shown and today, and reports the Monday asked for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strings } from '../strings'
import PeriodNavigator from './PeriodNavigator'
import type { PeriodNavigatorProps } from './PeriodNavigator'

afterEach(() => cleanup())

const n = strings.table.nav

// Today is Wednesday 18 November 2026: its week begins on Monday 16 November.
const TODAY = '2026-11-18'
const THIS_WEEK = '2026-11-16'

const renderNavigator = (props: Partial<PeriodNavigatorProps> = {}) => {
  const onWeekChange = vi.fn()
  const view = render(<PeriodNavigator monday={THIS_WEEK} today={TODAY} onWeekChange={onWeekChange} {...props} />)
  return { onWeekChange, ...view }
}

const previous = () => screen.getByRole('button', { name: n.previous })
const next = () => screen.getByRole('button', { name: n.next })
const thisWeek = () => screen.getByRole('button', { name: n.thisWeek })

describe('the controls (AC-5.5)', () => {
  it('is one group named "Choose a week" with Previous week, This week and Next week, in that order', () => {
    renderNavigator()
    const group = screen.getByRole('group', { name: n.label })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual([n.previous, n.thisWeek, n.next])
  })

  it('names the icon-only buttons by their label, and shows no word on them', () => {
    renderNavigator()
    expect(previous().textContent).toBe('')
    expect(next().textContent).toBe('')
    expect(thisWeek().textContent).toBe(n.thisWeek)
  })
})

describe('previous and next week call back with the shifted Monday (AC-5.5)', () => {
  it('Previous week asks for the Monday seven days before', async () => {
    const { onWeekChange } = renderNavigator()
    await userEvent.click(previous())
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith('2026-11-09')
  })

  it('Next week asks for the Monday seven days after', async () => {
    const { onWeekChange } = renderNavigator()
    await userEvent.click(next())
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith('2026-11-23')
  })

  it('shifts from the week shown, not from today, and over a month and a year', async () => {
    const { onWeekChange, rerender } = renderNavigator({ monday: '2026-12-28' })
    await userEvent.click(next())
    expect(onWeekChange).toHaveBeenLastCalledWith('2027-01-04')
    rerender(<PeriodNavigator monday="2026-11-02" today={TODAY} onWeekChange={onWeekChange} />)
    await userEvent.click(previous())
    expect(onWeekChange).toHaveBeenLastCalledWith('2026-10-26')
  })

  it('offers Next week in a week that has not started: the grid there is blank, not forbidden', async () => {
    const { onWeekChange } = renderNavigator({ monday: '2026-11-30' })
    await userEvent.click(next())
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith('2026-12-07')
  })

  it('works from the keyboard, with Enter on the focused button', async () => {
    const { onWeekChange } = renderNavigator()
    previous().focus()
    await userEvent.keyboard('{Enter}')
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith('2026-11-09')
  })

  it('keeps focus on the button once the week has changed, so a second step needs no new Tab', async () => {
    const { onWeekChange, rerender } = renderNavigator()
    await userEvent.click(next())
    rerender(<PeriodNavigator monday="2026-11-23" today={TODAY} onWeekChange={onWeekChange} />)
    expect(document.activeElement).toBe(next())
  })
})

describe('This week returns to the current week (AC-5.5)', () => {
  it('asks for the Monday of the week holding today from any other week', async () => {
    const { onWeekChange } = renderNavigator({ monday: '2026-10-05' })
    expect(thisWeek().getAttribute('aria-disabled')).toBeNull()
    await userEvent.click(thisWeek())
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith(THIS_WEEK)
  })

  it('knows a Sunday belongs to the week that began six days before', async () => {
    const { onWeekChange } = renderNavigator({ monday: '2026-12-07', today: '2026-11-22' })
    await userEvent.click(thisWeek())
    expect(onWeekChange).toHaveBeenCalledExactlyOnceWith('2026-11-16')
  })

  it('is aria-disabled while the current week is shown, still a button that keeps focus, and asks for nothing', async () => {
    const { onWeekChange } = renderNavigator()
    const button = thisWeek()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button).toHaveProperty('disabled', false)
    await userEvent.click(button)
    expect(onWeekChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
  })

  it('does not ask for the week it is already on from the keyboard either', async () => {
    const { onWeekChange } = renderNavigator()
    thisWeek().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onWeekChange).not.toHaveBeenCalled()
  })
})
