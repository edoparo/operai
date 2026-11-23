/**
 * @vitest-environment jsdom
 *
 * EstimateFilters (specs/20261108-estimate-list-oversight AC-1.1, AC-1.2, AC-2.1).
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
  const onOwnerChange = vi.fn()
  render(
    <EstimateFilters
      whose="mine"
      status="open"
      canChooseWhose
      onWhoseChange={onWhoseChange}
      onStatusChange={onStatusChange}
      owner={null}
      ownerOptions={[]}
      onOwnerChange={onOwnerChange}
      {...props}
    />,
  )
  return { onWhoseChange, onStatusChange, onOwnerChange }
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

  describe('Owner (US-4)', () => {
    const options = [
      { value: 'me', isMe: true },
      { value: 'Anna Rossi', isMe: false },
    ]

    it('is absent with one owner or none, nothing chosen', () => {
      renderFilters({ ownerOptions: [{ value: 'me', isMe: true }] })
      expect(screen.queryByLabelText(t.owner)).toBeNull()
    })

    it('offers Everyone, You and the other owners, and reports the choice', () => {
      const { onOwnerChange } = renderFilters({ ownerOptions: options })
      const owner = screen.getByLabelText(t.owner) as HTMLSelectElement
      expect(owner.value).toBe('')
      expect([...owner.options].map((o) => o.textContent)).toEqual([t.everyone, t.ownerMe, 'Anna Rossi'])
      fireEvent.change(owner, { target: { value: 'Anna Rossi' } })
      expect(onOwnerChange).toHaveBeenLastCalledWith('Anna Rossi')
      fireEvent.change(owner, { target: { value: '' } })
      expect(onOwnerChange).toHaveBeenLastCalledWith(null)
    })

    it('stays visible while an owner is chosen, even if the only one', () => {
      renderFilters({ owner: 'Anna Rossi', ownerOptions: [{ value: 'Anna Rossi', isMe: false }] })
      expect((screen.getByLabelText(t.owner) as HTMLSelectElement).value).toBe('Anna Rossi')
    })
  })
})
