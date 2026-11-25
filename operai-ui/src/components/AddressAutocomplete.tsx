/**
 * AddressAutocomplete — a text field that suggests addresses from Google Places as the person types, built on
 * `Combobox` and the library's Places client (`lib/googlePlaces.ts`). One component for the suite: the street of an
 * employee's address (admin-ui) and the From and To of a mileage trip (refund-ui).
 *
 * The field is always an ordinary text input first: below 3 characters nothing is asked, and when Google is
 * unreachable, slow, rate-limited or has no key, the field simply stays a text input with no caption and no error
 * (AC-3.2 of specs/20260803-employee-address). A genuine search with no result says so (AC-3.1).
 *
 * The library reads no environment and owns no copy: the app passes its key (`apiKey`) and the texts (`texts`,
 * from its own catalogue), and chooses what a pick does (`onPick`): take the suggestion's text, or ask for the
 * place's details (`resolveDetails`, one more billed call) to fill a structured address.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Combobox } from './Combobox'
import type { ComboboxOption } from './Combobox'
import { createAddressSuggester } from '../lib/googlePlaces'
import type {
  AddressLocale,
  AddressSuggester,
  AddressSuggesterOptions,
  PlaceDetails,
  PlaceKinds,
  PlaceSuggestion,
} from '../lib/googlePlaces'
import { resolveLocale } from '../lib/i18n'

export type AddressAutocompleteTexts = {
  /** Under the field while a search runs. */
  searching: string
  /** Under the field after a search that genuinely found nothing. */
  noResults: string
  /** Announced when suggestions arrive. */
  resultCount: (n: number) => string
  /** Announced after a search that found nothing. */
  noResultsAnnounce: string
  /** Google's attribution at the foot of the suggestions (never translated: "Powered by Google"). */
  attribution: string
}

export type AddressAutocompleteProps = {
  /** The input's id (from a `Field`'s control props). */
  id: string
  value: string
  onValueChange: (value: string) => void
  /**
   * A suggestion was chosen. `suggestion.text` is the whole place as Google writes it; `resolveDetails` asks for its
   * structured components and coordinates (or `null` on any failure, never a throw). The field's value is the
   * caller's to set.
   */
  onPick: (suggestion: PlaceSuggestion, resolveDetails: () => Promise<PlaceDetails | null>) => void
  texts: AddressAutocompleteTexts
  /** The app's public, referrer-restricted Google Maps key. Without one the field never suggests. */
  apiKey?: string
  /** `addresses` (street addresses only) or `any` (also companies, towns, places). Default `addresses`. */
  places?: PlaceKinds
  /** The language of the suggestions; the suite's resolved language by default. */
  language?: AddressLocale
  /** For tests and special callers: builds the suggester instead of the library's Google-backed one. */
  createSuggester?: (options: AddressSuggesterOptions) => AddressSuggester
  disabled?: boolean
  placeholder?: string
  ariaInvalid?: boolean
  ariaDescribedBy?: string
  ariaRequired?: boolean
  onBlur?: () => void
  /** data-testid of the input; `-searching` and `-no-results` name the captions (see `captionTestIdPrefix`). */
  testId?: string
  /** Prefix of the captions' test ids; `testId` by default. */
  captionTestIdPrefix?: string
}

export function AddressAutocomplete({
  id,
  value,
  onValueChange,
  onPick,
  texts,
  apiKey,
  places = 'addresses',
  language,
  createSuggester = createAddressSuggester,
  disabled = false,
  placeholder,
  ariaInvalid,
  ariaDescribedBy,
  ariaRequired,
  onBlur,
  testId,
  captionTestIdPrefix,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [caption, setCaption] = useState<'searching' | 'no-results' | null>(null)

  // Created once: its callbacks only call stable setters. `language`, `places` and `apiKey` are read at creation.
  const [suggester] = useState<AddressSuggester>(() =>
    createSuggester({
      language: language ?? resolveLocale(),
      places,
      apiKey,
      onSearchStart: () => setCaption('searching'),
      onResults: (found) => {
        setSuggestions(found)
        setOpen(found.length > 0)
        setCaption(found.length === 0 ? 'no-results' : null) // AC-3.1: a genuine, completed search with no result
      },
      onDegraded: () => {
        // AC-3.2: nothing at all, the field stays an ordinary text input.
        setSuggestions([])
        setOpen(false)
        setCaption(null)
      },
      onBelowThreshold: () => {
        setSuggestions([])
        setOpen(false)
        setCaption(null)
      },
    }),
  )
  useEffect(() => () => suggester.dispose(), [suggester])

  const handleValueChange = useCallback(
    (next: string) => {
      onValueChange(next)
      suggester.search(next)
    },
    [onValueChange, suggester],
  )

  const options: ComboboxOption[] = useMemo(
    () => suggestions.map((s) => ({ id: s.id, label: s.mainText, secondaryLabel: s.secondaryText })),
    [suggestions],
  )

  const handleSelect = useCallback(
    (option: ComboboxOption) => {
      const suggestion = suggestions.find((s) => s.id === option.id)
      if (!suggestion) return
      setSuggestions([])
      setOpen(false)
      setCaption(null)
      onPick(suggestion, () => suggester.selectSuggestion(suggestion.id))
    },
    [onPick, suggester, suggestions],
  )

  const liveRegionText =
    caption === 'no-results' ? texts.noResultsAnnounce : suggestions.length > 0 ? texts.resultCount(suggestions.length) : ''
  const captionPrefix = captionTestIdPrefix ?? testId

  return (
    <>
      <Combobox
        id={id}
        value={value}
        onValueChange={handleValueChange}
        options={options}
        onSelect={handleSelect}
        isOpen={open}
        onOpenChange={setOpen}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={placeholder}
        ariaInvalid={ariaInvalid}
        ariaDescribedBy={ariaDescribedBy}
        ariaRequired={ariaRequired}
        liveRegionText={liveRegionText}
        testId={testId}
        footer={
          open && options.length > 0 ? (
            <li aria-hidden="true" className="combobox-footer">
              {texts.attribution}
            </li>
          ) : undefined
        }
      />
      {caption === 'searching' && (
        <p className="field-hint" data-testid={captionPrefix ? `${captionPrefix}-searching` : undefined}>
          {texts.searching}
        </p>
      )}
      {caption === 'no-results' && (
        <p className="field-hint" data-testid={captionPrefix ? `${captionPrefix}-no-results` : undefined}>
          {texts.noResults}
        </p>
      )}
    </>
  )
}
