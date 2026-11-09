/**
 * @vitest-environment jsdom
 *
 * EstimateFilters (specs/024 AC-1.1, AC-1.2, AC-2.1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import EstimateFilters from './EstimateFilters'
import { strings } from '../strings'

const t = strings.estimatesList.filters

afterEach(cleanup)

const renderFilters = (props: Partial<React.ComponentProps<typeof EstimateFilters>> = {}) => {
  const onWhoseChange = vi.fn()
  const onStatusChange = vi.fn()
  render(
    <EstimateFilters
      whose="mine"
      status="open"
      canChooseWhose
      onWhoseChange={onWhoseChange}
      onStatusChange={onStatusChange}
      {...props}
    />,
  )
  return { onWhoseChange, onStatusChange }
}

describe('EstimateFilters', () => {
  it('offers Mine (selected) and All for Whose, Open (selected) and Closed for Status, with labels', () => {
    renderFilters()

    const whose = screen.getByLabelText(t.whose) as HTMLSelectElement
    expect(whose.value).toBe('mine')
    expect([...whose.options].map((o) => o.textContent)).toEqual([t.mine, t.all])
    const status = screen.getByLabelText(t.status) as HTMLSelectElement
    expect(status.value).toBe('open')
    expect([...status.options].map((o) => o.textContent)).toEqual([t.open, t.closed])
  })

  it('removes Whose from the DOM without the permission — absent, not disabled', () => {
    renderFilters({ canChooseWhose: false })

    expect(screen.queryByLabelText(t.whose)).toBeNull()
    expect(screen.getByLabelText(t.status)).toBeDefined()
  })

  it('reports each change', () => {
    const { onWhoseChange, onStatusChange } = renderFilters()

    fireEvent.change(screen.getByLabelText(t.whose), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText(t.status), { target: { value: 'closed' } })

    expect(onWhoseChange).toHaveBeenCalledExactlyOnceWith('all')
    expect(onStatusChange).toHaveBeenCalledExactlyOnceWith('closed')
  })
})
