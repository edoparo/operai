/**
 * @vitest-environment jsdom
 *
 * HealthWarningsModal renders its two read-only lists in the library
 * DataTable (INC-14): one row per activity / release, named by a row header,
 * with every warning of that record stacked in its Warning cell.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import HealthWarningsModal from './HealthWarningsModal'
import type { WarningCode } from '../lib/healthWarnings'
import { WARNING_META } from '../lib/healthWarnings'
import type { Activity, Release } from '../types'

afterEach(cleanup)

const act = (id: string, name: string): Activity =>
  ({
    id,
    act: name,
    epic: 'Core',
    release: 'R1',
    o: 1,
    ml: 2,
    p: 3,
    risk: 0,
    profile: '',
    notes: '',
  }) as unknown as Activity

const release = (id: string, name: string): Release => ({ id, name, fte: 1 }) as unknown as Release

describe('HealthWarningsModal', () => {
  it('lists warned activities and releases in DataTables, one row per record with its warnings stacked', () => {
    const activities = [act('a1', 'Login API'), act('a2', 'Healthy one')]
    const releases = [release('r1', 'R1')]
    const activityWarnings = new Map<string, WarningCode[]>([['a1', ['high-risk', 'no-profile']]])
    const releaseWarnings = new Map<string, WarningCode[]>([['r1', ['wide-range']]])

    render(
      <HealthWarningsModal
        activityWarnings={activityWarnings}
        releaseWarnings={releaseWarnings}
        activities={activities}
        releases={releases}
        onClose={vi.fn()}
      />,
    )

    const activityTable = screen.getByTestId('health-warnings-activities')
    expect(activityTable.querySelector('caption')?.textContent).toBe('Activity warnings')
    const rows = within(activityTable).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    const row = screen.getByTestId('health-warnings-activity-a1')
    expect(within(row).getByRole('rowheader').textContent).toContain('Login API')
    expect(within(row).getByText(WARNING_META['high-risk'].title)).toBeDefined()
    expect(within(row).getByText(WARNING_META['no-profile'].title)).toBeDefined()

    const releaseRow = screen.getByTestId('health-warnings-release-r1')
    expect(within(releaseRow).getByRole('rowheader').textContent).toBe('R1')
    expect(within(releaseRow).getByText(WARNING_META['wide-range'].title)).toBeDefined()
  })

  it('shows a genuine warning in the orange -text token, never the bare text-org (INC-20)', () => {
    render(
      <HealthWarningsModal
        activityWarnings={new Map([['a1', ['high-risk'] as WarningCode[]]])}
        releaseWarnings={new Map()}
        activities={[act('a1', 'Risky')]}
        releases={[]}
        onClose={vi.fn()}
      />,
    )
    const title = screen.getByText(WARNING_META['high-risk'].title)
    expect(title.parentElement?.className).toContain('text-org-text')
  })

  it('renders the all-clear state with no table when nothing is warned', () => {
    render(
      <HealthWarningsModal
        activityWarnings={new Map()}
        releaseWarnings={new Map()}
        activities={[]}
        releases={[]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('All clear — no warnings')).toBeDefined()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
