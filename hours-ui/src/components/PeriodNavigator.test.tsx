/**
 * @vitest-environment jsdom
 *
 * PeriodNavigator — previous week, this week, next week (specs/20261116-record-hours-in-place T9, T20; design S7
 * "Navigator"; AC-5.5, AC-5.28; plan decision 12, R18). It holds no state: it is told the period shown and today, and
 * reports the period asked for. Next is unavailable on the current period and Previous on the first one hours-api
 * answers, each `aria-disabled` rather than `disabled`, so the keyboard stays where it is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TablePeriod } from '../lib/tablePeriod'
import { strings } from '../strings'
import PeriodNavigator from './PeriodNavigator'
import type { PeriodNavigatorProps } from './PeriodNavigator'

afterEach(() => cleanup())

const n = strings.table.nav

const week = (monday: string): TablePeriod => ({ kind: 'week', monday })

// Today is Wednesday 18 November 2026: its week begins on Monday 16 November.
const TODAY = '2026-11-18'
const THIS_WEEK = '2026-11-16'

const renderNavigator = (props: Partial<PeriodNavigatorProps> = {}) => {
  const onPeriodChange = vi.fn()
  const view = render(
    <PeriodNavigator period={week(THIS_WEEK)} today={TODAY} onPeriodChange={onPeriodChange} {...props} />,
  )
  return { onPeriodChange, ...view }
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

describe('previous and next week call back with the shifted week (AC-5.5)', () => {
  it('Previous week asks for the week that began seven days before', async () => {
    const { onPeriodChange } = renderNavigator()
    await userEvent.click(previous())
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week('2026-11-09'))
  })

  it('Next week asks for the week that begins seven days after, from a week before the current one', async () => {
    const { onPeriodChange } = renderNavigator({ period: week('2026-11-09') })
    await userEvent.click(next())
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week(THIS_WEEK))
  })

  it('shifts from the week shown, not from today, and over a month and a year', async () => {
    const { onPeriodChange, rerender } = renderNavigator({ period: week('2026-12-28'), today: '2027-03-10' })
    await userEvent.click(next())
    expect(onPeriodChange).toHaveBeenLastCalledWith(week('2027-01-04'))
    rerender(<PeriodNavigator period={week('2026-11-02')} today={TODAY} onPeriodChange={onPeriodChange} />)
    await userEvent.click(previous())
    expect(onPeriodChange).toHaveBeenLastCalledWith(week('2026-10-26'))
  })

  it('works from the keyboard, with Enter on the focused button', async () => {
    const { onPeriodChange } = renderNavigator()
    previous().focus()
    await userEvent.keyboard('{Enter}')
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week('2026-11-09'))
  })
})

describe('Next week is unavailable on the current week: the future is not browsed (AC-5.5, AC-5.28)', () => {
  it('is aria-disabled on the current week, still a button in the tab order and not `disabled`', () => {
    renderNavigator()
    expect(next().getAttribute('aria-disabled')).toBe('true')
    expect(next()).toHaveProperty('disabled', false)
  })

  it('is aria-disabled on the current week whichever day of it today is, the Monday and the Sunday included', () => {
    const { rerender, onPeriodChange } = renderNavigator({ today: THIS_WEEK })
    expect(next().getAttribute('aria-disabled')).toBe('true')
    rerender(<PeriodNavigator period={week(THIS_WEEK)} today="2026-11-22" onPeriodChange={onPeriodChange} />)
    expect(next().getAttribute('aria-disabled')).toBe('true')
  })

  it('is available on the week before the current one, and on every week before it', () => {
    const { rerender, onPeriodChange } = renderNavigator({ period: week('2026-11-09') })
    expect(next().getAttribute('aria-disabled')).toBeNull()
    rerender(<PeriodNavigator period={week('2000-01-03')} today={TODAY} onPeriodChange={onPeriodChange} />)
    expect(next().getAttribute('aria-disabled')).toBeNull()
  })

  it('asks for nothing when pressed, by pointer or by keyboard, and keeps the focus it has', async () => {
    const { onPeriodChange } = renderNavigator()
    next().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    await userEvent.click(next())
    expect(onPeriodChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(next())
  })

  it('keeps the focus on Next when a press of it reaches the current week, so the keyboard does not fall to the page (R18)', async () => {
    const { onPeriodChange, rerender } = renderNavigator({ period: week('2026-11-09') })
    next().focus()
    await userEvent.keyboard('{Enter}')
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week(THIS_WEEK))
    rerender(<PeriodNavigator period={week(THIS_WEEK)} today={TODAY} onPeriodChange={onPeriodChange} />)
    expect(document.activeElement).toBe(next())
    expect(next().getAttribute('aria-disabled')).toBe('true')
    // A second press, now unavailable, does nothing.
    await userEvent.keyboard('{Enter}')
    expect(onPeriodChange).toHaveBeenCalledOnce()
  })

  it('keeps the focus on the button once a step back has been made, so a second step needs no new Tab', async () => {
    const { onPeriodChange, rerender } = renderNavigator()
    await userEvent.click(previous())
    rerender(<PeriodNavigator period={week('2026-11-09')} today={TODAY} onPeriodChange={onPeriodChange} />)
    expect(document.activeElement).toBe(previous())
  })

  it('does not take the label away: unavailable is said by aria-disabled, the name stays "Next week"', () => {
    renderNavigator()
    expect(next().getAttribute('aria-label')).toBe(n.next)
  })
})

describe('Previous week is unavailable on the first week hours-api answers (plan decision 12)', () => {
  it('is available on a current week and on the second week of 2000', () => {
    const { rerender, onPeriodChange } = renderNavigator()
    expect(previous().getAttribute('aria-disabled')).toBeNull()
    rerender(<PeriodNavigator period={week('2000-01-10')} today={TODAY} onPeriodChange={onPeriodChange} />)
    expect(previous().getAttribute('aria-disabled')).toBeNull()
  })

  it('is aria-disabled on Monday 3 January 2000, the first week an address names, and asks for nothing', async () => {
    const { onPeriodChange } = renderNavigator({ period: week('2000-01-03') })
    expect(previous().getAttribute('aria-disabled')).toBe('true')
    expect(previous()).toHaveProperty('disabled', false)
    previous().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(previous())
    expect(onPeriodChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(previous())
    // …and Next is still there to leave it.
    expect(next().getAttribute('aria-disabled')).toBeNull()
  })
})

describe('This week returns to the current week (AC-5.5)', () => {
  it('asks for the week holding today from any other week', async () => {
    const { onPeriodChange } = renderNavigator({ period: week('2026-10-05') })
    expect(thisWeek().getAttribute('aria-disabled')).toBeNull()
    await userEvent.click(thisWeek())
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week(THIS_WEEK))
  })

  it('knows a Sunday belongs to the week that began six days before', async () => {
    const { onPeriodChange } = renderNavigator({ period: week('2026-11-02'), today: '2026-11-22' })
    await userEvent.click(thisWeek())
    expect(onPeriodChange).toHaveBeenCalledExactlyOnceWith(week('2026-11-16'))
  })

  it('is aria-disabled while the current week is shown, still a button that keeps focus, and asks for nothing', async () => {
    const { onPeriodChange } = renderNavigator()
    const button = thisWeek()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button).toHaveProperty('disabled', false)
    await userEvent.click(button)
    expect(onPeriodChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(button)
  })

  it('does not ask for the week it is already on from the keyboard either', async () => {
    const { onPeriodChange } = renderNavigator()
    thisWeek().focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onPeriodChange).not.toHaveBeenCalled()
  })
})
