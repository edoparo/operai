/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddressAutocomplete } from './AddressAutocomplete'
import type { AddressSuggester, AddressSuggesterOptions, PlaceDetails, PlaceSuggestion } from '../lib/googlePlaces'

afterEach(cleanup)

const texts = {
  searching: 'Searching…',
  noResults: 'No matching suggestions',
  resultCount: (n: number) => `${n} suggestions available`,
  noResultsAnnounce: 'Nothing found',
  attribution: 'Powered by Google',
}

const LUGANO: PlaceSuggestion = { id: 'p1', mainText: 'Via Cantonale 1', secondaryText: 'Lugano, Svizzera', text: 'Via Cantonale 1, Lugano, Svizzera' }
const DETAILS: PlaceDetails = {
  components: { countryCode: 'CH', city: 'Lugano', street: 'Via Cantonale', houseNumber: '1', postalCode: '6900', region: 'TI' },
  latitude: 46.0,
  longitude: 8.95,
}

/** A fake suggester the test drives: it records the options and what was searched. */
function fakeSuggester() {
  const calls = { options: null as AddressSuggesterOptions | null, searched: [] as string[], selected: [] as string[] }
  const suggester: AddressSuggester = {
    search: (q) => calls.searched.push(q),
    selectSuggestion: async (id) => {
      calls.selected.push(id)
      return DETAILS
    },
    reset: vi.fn(),
    dispose: vi.fn(),
  }
  const create = (options: AddressSuggesterOptions) => {
    calls.options = options
    return suggester
  }
  return { calls, create, suggester }
}

function Harness(props: { create: (o: AddressSuggesterOptions) => AddressSuggester; onPick: (s: PlaceSuggestion, d: () => Promise<PlaceDetails | null>) => void; places?: 'any' | 'addresses' }) {
  const [value, setValue] = useState('')
  return (
    <AddressAutocomplete
      id="from"
      value={value}
      onValueChange={setValue}
      onPick={props.onPick}
      texts={texts}
      apiKey="test-key"
      places={props.places}
      language="it"
      createSuggester={props.create}
      testId="trip-from"
    />
  )
}

describe('AddressAutocomplete', () => {
  it('passes the key, the language and the kinds of place to its suggester, and searches as the person types', () => {
    const fake = fakeSuggester()
    render(<Harness create={fake.create} onPick={vi.fn()} places="any" />)
    expect(fake.calls.options).toMatchObject({ apiKey: 'test-key', language: 'it', places: 'any' })
    fireEvent.change(screen.getByTestId('trip-from'), { target: { value: 'Via Can' } })
    expect(fake.calls.searched).toEqual(['Via Can'])
    expect((screen.getByTestId('trip-from') as HTMLInputElement).value).toBe('Via Can')
  })

  it('shows the suggestions with Google’s attribution, and a pick hands over the suggestion and a way to its details', async () => {
    const fake = fakeSuggester()
    const onPick = vi.fn()
    render(<Harness create={fake.create} onPick={onPick} />)
    act(() => fake.calls.options!.onSearchStart?.())
    expect(screen.getByTestId('trip-from-searching').textContent).toBe('Searching…')
    act(() => fake.calls.options!.onResults([LUGANO]))
    expect(screen.queryByTestId('trip-from-searching')).toBeNull()
    expect(screen.getByText('Powered by Google')).not.toBeNull()
    expect(screen.getByTestId('trip-from-live').textContent).toBe('1 suggestions available')

    fireEvent.mouseDown(screen.getByTestId('trip-from-option-p1'))
    fireEvent.click(screen.getByTestId('trip-from-option-p1'))
    expect(onPick).toHaveBeenCalledTimes(1)
    const [suggestion, resolveDetails] = onPick.mock.calls[0]!
    expect(suggestion).toEqual(LUGANO)
    expect(await resolveDetails()).toEqual(DETAILS)
    expect(fake.calls.selected).toEqual(['p1'])
    expect(screen.queryByText('Powered by Google')).toBeNull()
  })

  it('says when a search genuinely found nothing, and says nothing at all when Google is unavailable', () => {
    const fake = fakeSuggester()
    render(<Harness create={fake.create} onPick={vi.fn()} />)
    act(() => fake.calls.options!.onResults([]))
    expect(screen.getByTestId('trip-from-no-results').textContent).toBe('No matching suggestions')
    expect(screen.getByTestId('trip-from-live').textContent).toBe('Nothing found')
    act(() => fake.calls.options!.onDegraded?.())
    expect(screen.queryByTestId('trip-from-no-results')).toBeNull()
    expect(screen.queryByTestId('trip-from-searching')).toBeNull()
    expect(screen.getByTestId('trip-from-live').textContent).toBe('')
  })

  it('disposes its suggester when it goes away', () => {
    const fake = fakeSuggester()
    const { unmount } = render(<Harness create={fake.create} onPick={vi.fn()} />)
    unmount()
    expect(fake.suggester.dispose).toHaveBeenCalled()
  })
})
