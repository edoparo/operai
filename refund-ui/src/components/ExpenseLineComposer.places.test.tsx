/**
 * @vitest-environment jsdom
 *
 * A mileage trip's From and To use the library's AddressAutocomplete through refund-ui's Places seam
 * (`lib/places.ts`, mocked here): a pick fills the field with the place as Google writes it, and the line is added
 * with both addresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AddressSuggesterOptions } from '@operai/ui'
import ExpenseLineComposer from './ExpenseLineComposer'
import { getTripSuggestions } from '../lib/suggestionsApi'
import * as ratesApi from '../lib/ratesApi'
import { createTripSuggester } from '../lib/places'
import { expectNoAxeViolations } from '../test-support/axe'

vi.mock('../lib/suggestionsApi')
vi.mock('../lib/ratesApi')
vi.mock('../lib/places')

const created: AddressSuggesterOptions[] = []

beforeEach(() => {
  created.length = 0
  vi.mocked(getTripSuggestions).mockResolvedValue([])
  vi.mocked(ratesApi.getEffectiveRate).mockResolvedValue({
    entity: 'welld_ch',
    date: '2026-07-16',
    currency: 'CHF',
    inEffect: true,
    ratePerKmMicros: 700000,
    ratePerKm: '0.70',
    validFrom: '2026-01-01',
  })
  vi.mocked(createTripSuggester).mockImplementation((options) => {
    created.push(options)
    return { search: vi.fn(), selectSuggestion: vi.fn(), reset: vi.fn(), dispose: vi.fn() }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExpenseLineComposer — From and To of a mileage trip', () => {
  it('appear only for a mileage line, required, each with its own suggester', async () => {
    render(<ExpenseLineComposer onAdd={vi.fn()} />)
    expect(screen.queryByTestId('composer-from')).toBeNull()
    fireEvent.change(screen.getByTestId('composer-type'), { target: { value: 'travel_km' } })
    expect(screen.getByTestId('composer-from').getAttribute('aria-required')).toBe('true')
    expect(screen.getByTestId('composer-to').getAttribute('aria-required')).toBe('true')
    expect(screen.getByLabelText(/^From/)).toBe(screen.getByTestId('composer-from'))
    expect(created).toHaveLength(2)
    await expectNoAxeViolations()
  })

  it('a pick fills the field with the whole place, and the line is added with both addresses', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined)
    render(<ExpenseLineComposer onAdd={onAdd} />)
    fireEvent.change(screen.getByTestId('composer-date'), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByTestId('composer-type'), { target: { value: 'travel_km' } })
    fireEvent.change(screen.getByTestId('composer-motivo'), { target: { value: 'Mtg cliente' } })
    fireEvent.change(screen.getByTestId('composer-entity'), { target: { value: 'welld_ch' } })
    fireEvent.change(screen.getByTestId('composer-km'), { target: { value: '240' } })

    fireEvent.change(screen.getByTestId('composer-from'), { target: { value: 'Via Can' } })
    act(() =>
      created[0]!.onResults([
        { id: 'p1', mainText: 'Via Cantonale 1', secondaryText: 'Lugano, Svizzera', text: 'Via Cantonale 1, Lugano, Svizzera' },
      ]),
    )
    fireEvent.click(screen.getByTestId('composer-from-option-p1'))
    expect((screen.getByTestId('composer-from') as HTMLInputElement).value).toBe('Via Cantonale 1, Lugano, Svizzera')

    fireEvent.change(screen.getByTestId('composer-to'), { target: { value: 'Piazza Duomo, Milano' } })
    fireEvent.click(screen.getByTestId('composer-add-button'))
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ km: 240, fromAddress: 'Via Cantonale 1, Lugano, Svizzera', toAddress: 'Piazza Duomo, Milano' }),
      ),
    )
  })

  it('never adds a mileage line without them: the failed Add marks both', () => {
    const onAdd = vi.fn()
    render(<ExpenseLineComposer onAdd={onAdd} />)
    fireEvent.change(screen.getByTestId('composer-date'), { target: { value: '2026-07-16' } })
    fireEvent.change(screen.getByTestId('composer-type'), { target: { value: 'travel_km' } })
    fireEvent.change(screen.getByTestId('composer-motivo'), { target: { value: 'Mtg cliente' } })
    fireEvent.change(screen.getByTestId('composer-entity'), { target: { value: 'welld_ch' } })
    fireEvent.change(screen.getByTestId('composer-km'), { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('composer-add-button'))
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByTestId('composer-from').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('composer-to').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(screen.getByTestId('composer-from'))
  })
})
