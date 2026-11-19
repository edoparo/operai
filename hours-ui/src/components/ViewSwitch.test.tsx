/**
 * @vitest-environment jsdom
 *
 * ViewSwitch — List | Week (specs/20261116-record-hours-in-place T10; design S6 "Control: Tabs"; AC-5.1). Two views
 * of the SAME page, so a real tablist, not links: one tab stop, the arrow keys, `aria-selected`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { strings } from '../strings'
import ViewSwitch from './ViewSwitch'
import type { ViewSwitchProps } from './ViewSwitch'

afterEach(() => cleanup())

const v = strings.table.view

const renderSwitch = (props: Partial<ViewSwitchProps> = {}) => {
  const onChange = vi.fn()
  const view = render(<ViewSwitch value="list" idPrefix="hours-view" onChange={onChange} {...props} />)
  return { onChange, ...view }
}

const list = () => screen.getByRole('tab', { name: v.list })
const week = () => screen.getByRole('tab', { name: v.week })

describe('the tablist (AC-5.1)', () => {
  it('is named "View of your hours" and has two tabs, List then Week', () => {
    renderSwitch()
    const tablist = screen.getByRole('tablist', { name: v.label })
    expect(tablist).not.toBeNull()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([v.list, v.week])
  })

  it('marks the current view with aria-selected, and only that one', () => {
    renderSwitch({ value: 'list' })
    expect(list().getAttribute('aria-selected')).toBe('true')
    expect(week().getAttribute('aria-selected')).toBe('false')
    cleanup()
    renderSwitch({ value: 'week' })
    expect(list().getAttribute('aria-selected')).toBe('false')
    expect(week().getAttribute('aria-selected')).toBe('true')
  })

  it('has one tab stop: the selected tab', () => {
    renderSwitch({ value: 'week' })
    expect(week().getAttribute('tabindex')).toBe('0')
    expect(list().getAttribute('tabindex')).toBe('-1')
  })

  it('points each tab at the panel the page draws with the same prefix', () => {
    renderSwitch({ idPrefix: 'hours-view' })
    expect(list().getAttribute('aria-controls')).toBe('hours-view-panel-list')
    expect(week().getAttribute('aria-controls')).toBe('hours-view-panel-week')
  })
})

describe('choosing a view', () => {
  it('a click on the other tab reports it', async () => {
    const { onChange } = renderSwitch({ value: 'list' })
    await userEvent.click(week())
    expect(onChange).toHaveBeenCalledExactlyOnceWith('week')
  })

  it('the arrow keys move between the two and report the one reached', async () => {
    const { onChange } = renderSwitch({ value: 'list' })
    list().focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('week')
    expect(document.activeElement).toBe(week())
  })
})
