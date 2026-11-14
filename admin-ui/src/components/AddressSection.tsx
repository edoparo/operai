/**
 * AddressSection — the admin-facing address editor, its states, and the
 * per-employee change-history panel (T11, specs/20260803-employee-address/tasks.md,
 * refs AC-1.1, AC-1.3, AC-2.2, AC-2.3, AC-2.6, AC-3.1, AC-3.2, AC-3.3, AC-5.3;
 * design.md "Screen C2 extension — AddressSection").
 *
 * Mounted into `UserDetail.tsx` (T12) BEHIND a capability check — this
 * component itself does no `roles` gating (AC-4.2 is the mounting caller's
 * job, per tasks.md T12; UserDetail hides this component entirely for a
 * non-admin rather than this component rendering a disabled/forbidden
 * variant of itself).
 *
 * Structural decision (design.md): NO view/edit toggle. A short read line
 * ("Current address: …" / "No address on file") sits above an
 * ALWAYS-EDITABLE form, pre-filled from the same value — the exact same
 * pattern this page's existing Attributes/Roles/Departments sections already
 * use. The read line updates only on a successful save, never as the admin
 * types.
 *
 * Two consumers of the library `Combobox` (moved from admin-ui's T10 primitive) (design.md "Country control"):
 *   - Street: async, Google-backed, debounced (`../lib/googlePlaces.ts`, T7).
 *   - Country: sync, local filter over the bundled ISO 3166-1 list
 *     (`../lib/countries.ts`), labels via `Intl.DisplayNames`.
 *
 * Coordinate handling (AC-2.5/AC-2.6): `coords` holds whatever a selection
 * last captured; `snapshot` holds the six structured values AS OF that
 * capture. `coordinatesForSave` (T8, a pure function) is the SINGLE decision
 * point — computed fresh from current `fields`/`snapshot`/`coords` at both
 * render time (the visible status line) and submit time (what's actually
 * sent) — so there is no separate "eagerly clear on edit" state to keep in
 * sync; the pure function IS the source of truth both times.
 *
 * AC-3.2 — this component does no failure-mode branching of its own for a
 * degraded suggestion service: `createAddressSuggester` (T7) already never
 * surfaces an error through its callbacks (`onDegraded` fires instead of
 * `onResults`, and is handled here by rendering nothing — no caption, no
 * spinner, no `role="alert"`), so there is nothing here that can leave the
 * field stuck or the save blocked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Combobox, Field, Icon, formatDateTime, resolveLocale } from '@operai/ui'
import type { ComboboxOption } from '@operai/ui'
import * as addressApi from '../lib/addressApi'
import { ApiError } from '../lib/addressApi'
import type { AddressHistoryEntry, AdminAddressView } from '../lib/addressApi'
import { createAddressSuggester } from '../lib/googlePlaces'
import type { AddressComponents, AddressSuggester, PlaceSuggestion } from '../lib/googlePlaces'
import { coordinatesForSave } from '../lib/addressCoordinates'
import type { LatLng } from '../lib/addressCoordinates'
import { ISO_3166_1_ALPHA2_CODES, countryDisplayName } from '../lib/countries'
import { strings } from '../strings'

const s = strings.address
import SkeletonListRows from './SkeletonListRows'
import ErrorBanner from './ErrorBanner'
import SuccessBanner from './SuccessBanner'

export type AddressSectionProps = {
  userId: string
}

type FormFields = AddressComponents

const EMPTY_FIELDS: FormFields = {
  countryCode: '',
  city: '',
  street: '',
  houseNumber: '',
  postalCode: '',
  region: '',
}

type LoadState =
  { status: 'loading' } | { status: 'loaded'; address: AdminAddressView | null } | { status: 'error'; message: string }

type HistoryState =
  { status: 'loading' } | { status: 'loaded'; entries: AddressHistoryEntry[] } | { status: 'error'; message: string }

type PreClearSnapshot = {
  fields: FormFields
  snapshot: FormFields | null
  coords: LatLng | null
  countryFilterText: string
}

/** AC-1.4's four required structured components — the only keys `missingFields` can ever name. */
type RequiredFieldKey = 'countryCode' | 'city' | 'street' | 'houseNumber'

/**
 * Fallback message for the address/history GET fetch paths (F1/F5). An
 * `ApiError` always wins (it carries a real server-supplied message);
 * otherwise falls back to the localized `strings.address.loadError` (QE
 * fix — was a hardcoded, always-English literal that ALSO leaked into the
 * unrelated save-failure path below; see `saveErrorMessageFor`).
 */
const loadErrorMessageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.detail ?? error.title
  }
  return s.loadError
}

/**
 * Fallback message for the `PUT` save path (F2 step 7's "Unexpected
 * failure"). Deliberately a SEPARATE function from `loadErrorMessageFor` (QE
 * fix) — the two states are wired to different `strings.address` keys
 * (`saveError` vs `loadError`) because "could not load"
 * copy is simply wrong when what actually failed was a save.
 */
const saveErrorMessageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.detail ?? error.title
  }
  return s.saveError
}

const fieldsFromAddress = (address: AdminAddressView): FormFields => ({
  countryCode: address.countryCode,
  city: address.city,
  street: address.street,
  houseNumber: address.houseNumber,
  postalCode: address.postalCode ?? '',
  region: address.region ?? '',
})

/** Renders an audit `data.before`/`data.after` side — an address-shaped object with `formatted`, or `null`/absent for "no address on file". */
const formatHistorySide = (value: unknown): string => {
  if (value && typeof value === 'object' && 'formatted' in value) {
    const formatted = (value as { formatted?: unknown }).formatted
    if (typeof formatted === 'string' && formatted.length > 0) return formatted
  }
  return s.none
}

const formatHistoryActor = (actorUserId: string | null): string =>
  actorUserId ?? s.history.deletedUser


export default function AddressSection({ userId }: AddressSectionProps) {
  // The suite's one resolved language (INC-25) — for Google's suggestion language and the country names.
  const locale = resolveLocale()

  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS)
  const [snapshot, setSnapshot] = useState<FormFields | null>(null)
  const [coords, setCoords] = useState<LatLng | null>(null)
  const [countryFilterText, setCountryFilterText] = useState('')

  const [streetSuggestions, setStreetSuggestions] = useState<PlaceSuggestion[]>([])
  const [streetPopupOpen, setStreetPopupOpen] = useState(false)
  const [streetCaption, setStreetCaption] = useState<'searching' | 'no-results' | null>(null)
  const [countryPopupOpen, setCountryPopupOpen] = useState(false)

  const [missingFields, setMissingFields] = useState<ReadonlySet<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // INC-19: "Address saved" / "Address cleared" beside the Save button.
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)

  const [pendingClear, setPendingClear] = useState(false)
  const preClearRef = useRef<PreClearSnapshot | null>(null)

  const [historyState, setHistoryState] = useState<HistoryState>({ status: 'loading' })
  const [historyReloadToken, setHistoryReloadToken] = useState(0)

  const houseNumberInputRef = useRef<HTMLInputElement | null>(null)

  // -------------------------------------------------------------------------
  // The Google Places suggester (T7) — created once. Its callbacks only ever
  // call stable setState functions, so no dependency array is needed and no
  // stale-closure risk exists (React setState setters have a stable identity
  // across renders).
  // -------------------------------------------------------------------------
  const [suggester] = useState<AddressSuggester>(() =>
    createAddressSuggester({
      language: locale,
      onSearchStart: () => {
        setStreetCaption('searching')
      },
      onResults: (suggestions) => {
        setStreetSuggestions(suggestions)
        setStreetPopupOpen(suggestions.length > 0)
        setStreetCaption(suggestions.length === 0 ? 'no-results' : null) // AC-3.1 — a GENUINE, completed zero-result search
      },
      onDegraded: () => {
        // AC-3.2 — deliberately nothing: no caption, no popup, no error, no
        // spinner. The field is left exactly as an ordinary text input.
        setStreetSuggestions([])
        setStreetPopupOpen(false)
        setStreetCaption(null)
      },
      onBelowThreshold: () => {
        setStreetSuggestions([])
        setStreetPopupOpen(false)
        setStreetCaption(null)
      },
    }),
  )

  useEffect(() => () => suggester.dispose(), [suggester])

  // -------------------------------------------------------------------------
  // Fetch — GET /admin/users/:id/address (F1). Promise-chain-in-effect
  // (mirrors UserDetail.tsx/AuditPage.tsx's documented
  // react-hooks/set-state-in-effect rationale).
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setLoadState({ status: 'loading' })
      })
      .then(() => addressApi.getAddress(userId))
      .then((response) => {
        if (cancelled) return
        setLoadState({ status: 'loaded', address: response.address })
        if (response.address) {
          const loadedFields = fieldsFromAddress(response.address)
          setFields(loadedFields)
          setCountryFilterText(loadedFields.countryCode ? countryDisplayName(loadedFields.countryCode, locale) : '')
          if (response.address.latitude != null && response.address.longitude != null) {
            setSnapshot(loadedFields)
            setCoords({ lat: response.address.latitude, lng: response.address.longitude })
          } else {
            setSnapshot(null)
            setCoords(null)
          }
        } else {
          setFields(EMPTY_FIELDS)
          setCountryFilterText('')
          setSnapshot(null)
          setCoords(null)
        }
        setMissingFields(new Set())
        setPendingClear(false)
        preClearRef.current = null
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadState({ status: 'error', message: loadErrorMessageFor(error) })
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reloadToken])

  // -------------------------------------------------------------------------
  // History — GET /admin/audit?targetType=user&targetId=…&action=user.address.set (F5, AC-5.3).
  // Independent fetch: a slow/failed history load must never block the form above it.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    Promise.resolve()
      .then(() => {
        if (!cancelled) setHistoryState({ status: 'loading' })
      })
      .then(() => addressApi.listAddressHistory(userId))
      .then((page) => {
        if (!cancelled) setHistoryState({ status: 'loaded', entries: page.items })
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryState({ status: 'error', message: loadErrorMessageFor(error) })
      })

    return () => {
      cancelled = true
    }
  }, [userId, historyReloadToken, locale])

  const handleRetry = useCallback(() => setReloadToken((n) => n + 1), [])
  const handleHistoryRetry = useCallback(() => setHistoryReloadToken((n) => n + 1), [])

  // -------------------------------------------------------------------------
  // Street combobox wiring (AC-2.1, AC-2.2, AC-2.4, AC-2.5)
  // -------------------------------------------------------------------------

  const handleStreetValueChange = useCallback(
    (value: string) => {
      setFields((prev) => ({ ...prev, street: value }))
      suggester.search(value)
    },
    [suggester],
  )

  const streetOptions: ComboboxOption[] = useMemo(
    () => streetSuggestions.map((s) => ({ id: s.id, label: s.mainText, secondaryLabel: s.secondaryText })),
    [streetSuggestions],
  )

  const handleStreetSelect = useCallback(
    (option: ComboboxOption) => {
      void (async () => {
        const details = await suggester.selectSuggestion(option.id)
        if (!details) return // AC-3.2 — details fetch failed; leave the field exactly as typed, no error
        setFields((prev) => ({ ...prev, ...details.components }))
        setSnapshot({ ...details.components })
        setCoords(
          details.latitude !== null && details.longitude !== null
            ? { lat: details.latitude, lng: details.longitude }
            : null,
        )
        setCountryFilterText(
          details.components.countryCode ? countryDisplayName(details.components.countryCode, locale) : '',
        )
        setStreetSuggestions([])
        setStreetPopupOpen(false)
        setStreetCaption(null)
        // R9 — a route-level prediction often carries no house number; move
        // focus there so the admin's next keystroke fills the one thing
        // still missing. Otherwise focus already stayed on Street (Combobox's
        // own behavior) — nothing further to do.
        if (!details.components.houseNumber) {
          houseNumberInputRef.current?.focus()
        }
      })()
    },
    [locale, suggester],
  )

  const streetLiveRegionText = useMemo(() => {
    if (streetCaption === 'no-results') return s.suggest.noResultsAnnounce
    if (streetSuggestions.length > 0) return s.suggest.resultCount(streetSuggestions.length)
    return ''
  }, [streetCaption, streetSuggestions.length])

  // -------------------------------------------------------------------------
  // Country combobox wiring — sync, local, never Google-backed (design.md
  // "Country control")
  // -------------------------------------------------------------------------

  const countryOptions: ComboboxOption[] = useMemo(() => {
    const query = countryFilterText.trim().toLowerCase()
    const withLabels = ISO_3166_1_ALPHA2_CODES.map((code) => ({ id: code, label: countryDisplayName(code, locale) }))
    if (query === '') return withLabels
    return withLabels.filter((option) => option.label.toLowerCase().includes(query))
  }, [countryFilterText, locale])

  const handleCountrySelect = useCallback((option: ComboboxOption) => {
    setFields((prev) => ({ ...prev, countryCode: option.id }))
    setCountryFilterText(option.label)
    setCountryPopupOpen(false)
  }, [])

  const handleCountryBlur = useCallback(() => {
    setCountryPopupOpen(false)
    setCountryFilterText(fields.countryCode ? countryDisplayName(fields.countryCode, locale) : '')
  }, [fields.countryCode, locale])

  const countryLiveRegionText = useMemo(() => {
    if (!countryPopupOpen) return ''
    return countryOptions.length > 0
      ? s.country.resultCount(countryOptions.length)
      : s.country.noMatch
  }, [countryPopupOpen, countryOptions.length])

  // -------------------------------------------------------------------------
  // Plain field handlers (AC-2.3 — hand-edits after a selection persist)
  // -------------------------------------------------------------------------

  const handleFieldChange = useCallback(
    (key: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const { value } = e.target
      setFields((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  // -------------------------------------------------------------------------
  // Coordinate-staleness status (AC-2.6) — a pure derivation, recomputed
  // every render from fields/snapshot/coords; no separate state to drift.
  // -------------------------------------------------------------------------

  const coordsForSave = coordinatesForSave(fields, snapshot, coords)
  const coordStatus: 'captured' | 'cleared' | 'none' =
    coordsForSave.latitude !== null ? 'captured' : snapshot !== null && coords !== null ? 'cleared' : 'none'

  // -------------------------------------------------------------------------
  // Save / Clear (F2 step 7, F3)
  // -------------------------------------------------------------------------

  const hasAnyFieldContent = Object.values(fields).some((v) => v.trim() !== '')
  const canSave = !saving && (pendingClear || hasAnyFieldContent)
  const hasStoredAddress = loadState.status === 'loaded' && loadState.address !== null

  const handleClearRequest = useCallback(() => {
    preClearRef.current = { fields, snapshot, coords, countryFilterText }
    setPendingClear(true)
  }, [fields, snapshot, coords, countryFilterText])

  const handleUndoClear = useCallback(() => {
    const pre = preClearRef.current
    if (!pre) return
    setFields(pre.fields)
    setSnapshot(pre.snapshot)
    setCoords(pre.coords)
    setCountryFilterText(pre.countryFilterText)
    setPendingClear(false)
    preClearRef.current = null
  }, [])

  const handleSave = useCallback(() => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)

    const input = pendingClear
      ? null
      : {
          countryCode: fields.countryCode.trim().toUpperCase(),
          city: fields.city.trim(),
          street: fields.street.trim(),
          houseNumber: fields.houseNumber.trim(),
          postalCode: fields.postalCode.trim() === '' ? null : fields.postalCode.trim(),
          region: fields.region.trim() === '' ? null : fields.region.trim(),
          latitude: coordsForSave.latitude,
          longitude: coordsForSave.longitude,
        }

    addressApi
      .putAddress(userId, input)
      .then((response) => {
        setSaving(false)
        setMissingFields(new Set())
        setLoadState({ status: 'loaded', address: response.address })
        if (response.address) {
          const loadedFields = fieldsFromAddress(response.address)
          setFields(loadedFields)
          setCountryFilterText(loadedFields.countryCode ? countryDisplayName(loadedFields.countryCode, locale) : '')
          if (response.address.latitude != null && response.address.longitude != null) {
            setSnapshot(loadedFields)
            setCoords({ lat: response.address.latitude, lng: response.address.longitude })
          } else {
            setSnapshot(null)
            setCoords(null)
          }
        } else {
          setFields(EMPTY_FIELDS)
          setCountryFilterText('')
          setSnapshot(null)
          setCoords(null)
        }
        setPendingClear(false)
        preClearRef.current = null
        setSaveSuccess(response.address ? s.saved : s.cleared)
        setHistoryReloadToken((n) => n + 1) // AC-5.3 — the history panel gains a new row
      })
      .catch((error: unknown) => {
        setSaving(false)
        if (error instanceof ApiError && error.status === 422 && error.code === 'address_incomplete') {
          setMissingFields(new Set(error.missingFields ?? []))
          return
        }
        setSaveError(saveErrorMessageFor(error))
      })
  }, [userId, fields, pendingClear, coordsForSave, locale])

  // A 422 (address_incomplete) marks the missing fields; focus moves to the
  // first invalid one in the form's order (INC-16).
  useEffect(() => {
    if (missingFields.size === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [missingFields])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // A missing required component's error (from the 422), on its own Field.
  const fieldError = (key: RequiredFieldKey) =>
    missingFields.has(key) ? (
      <span role="alert" data-testid={`address-error-${key}`}>
        {s.field.requiredError}
      </span>
    ) : null

  return (
    <Card title={s.sectionTitle} data-testid="address-section">
      {loadState.status === 'loading' && <SkeletonListRows rows={2} label={s.loading} />}

      {loadState.status === 'error' && <ErrorBanner message={loadState.message} onRetry={handleRetry} />}

      {loadState.status === 'loaded' && (
        <div ref={formRef} className="flex flex-col gap-3 max-w-md">
          <p className="text-sm text-soft" data-testid="address-current-line">
            {loadState.address
              ? s.currentLabel(loadState.address.formatted)
              : s.none}
          </p>

          {/* Street — the Google-backed combobox */}
          <Field label={s.field.street} required error={fieldError('street')}>
            {(control) => (
              <>
                <Combobox
                  id={control.id}
                  value={fields.street}
                  onValueChange={handleStreetValueChange}
                  options={streetOptions}
                  onSelect={handleStreetSelect}
                  isOpen={streetPopupOpen}
                  onOpenChange={setStreetPopupOpen}
                  disabled={pendingClear}
                  ariaInvalid={control['aria-invalid']}
                  ariaDescribedBy={control['aria-describedby']}
                  ariaRequired={control['aria-required']}
                  liveRegionText={streetLiveRegionText}
                  testId="address-street-combobox"
                  footer={
                    streetPopupOpen && streetOptions.length > 0 ? (
                      <li aria-hidden="true" className="combobox-footer">
                        {/* Google's required attribution when predictions render without a map (Places API terms). Text
                            placeholder for the branded "Powered by Google" light/dark asset, which must be sourced from
                            Google's Maps Platform branding kit (design.md "Google attribution" / plan.md gap #1, routed
                            to devops/infra follow-up). The trademark text is never translated: both catalogs carry
                            it verbatim (strings/address.ts). */}
                        {s.googleAttribution}
                      </li>
                    ) : undefined
                  }
                />
                {streetCaption === 'searching' && (
                  <p className="field-hint" data-testid="address-street-searching">
                    {s.suggest.searching}
                  </p>
                )}
                {streetCaption === 'no-results' && (
                  <p className="field-hint" data-testid="address-street-no-results">
                    {s.suggest.noResults}
                  </p>
                )}
              </>
            )}
          </Field>

          {/* House / building number */}
          <Field label={s.field.houseNumber} required error={fieldError('houseNumber')}>
            {(control) => (
              <input
                {...control}
                ref={houseNumberInputRef}
                type="text"
                value={fields.houseNumber}
                onChange={handleFieldChange('houseNumber')}
                aria-disabled={pendingClear || undefined}
                readOnly={pendingClear}
                data-testid="address-housenumber-input"
              />
            )}
          </Field>

          {/* Postal code — optional */}
          <Field label={s.field.postalCode}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={fields.postalCode}
                onChange={handleFieldChange('postalCode')}
                aria-disabled={pendingClear || undefined}
                readOnly={pendingClear}
                data-testid="address-postalcode-input"
              />
            )}
          </Field>

          {/* City */}
          <Field label={s.field.city} required error={fieldError('city')}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={fields.city}
                onChange={handleFieldChange('city')}
                aria-disabled={pendingClear || undefined}
                readOnly={pendingClear}
                data-testid="address-city-input"
              />
            )}
          </Field>

          {/* Region / canton / state — optional */}
          <Field label={s.field.region}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={fields.region}
                onChange={handleFieldChange('region')}
                aria-disabled={pendingClear || undefined}
                readOnly={pendingClear}
                data-testid="address-region-input"
              />
            )}
          </Field>

          {/* Country — the local, non-Google combobox (design.md "Country control") */}
          <Field label={s.field.country} required error={fieldError('countryCode')}>
            {(control) => (
              <Combobox
                id={control.id}
                value={countryFilterText}
                onValueChange={(value) => {
                  setCountryFilterText(value)
                  setCountryPopupOpen(true)
                }}
                options={countryOptions}
                onSelect={handleCountrySelect}
                isOpen={countryPopupOpen}
                onOpenChange={setCountryPopupOpen}
                onFocus={() => setCountryPopupOpen(true)}
                onBlur={handleCountryBlur}
                disabled={pendingClear}
                placeholder={s.country.placeholder}
                ariaInvalid={control['aria-invalid']}
                ariaDescribedBy={control['aria-describedby']}
                ariaRequired={control['aria-required']}
                emptyState={s.country.noMatch}
                liveRegionText={countryLiveRegionText}
                testId="address-country-combobox"
              />
            )}
          </Field>

          {/* Coordinate-staleness status (AC-2.6) — calm, aria-live="polite", never styled as an error */}
          <p
            className="text-xs text-soft"
            aria-live="polite"
            data-testid="address-coords-status"
          >
            {coordStatus === 'captured' && s.coords.captured}
            {coordStatus === 'cleared' && s.coords.cleared}
            {coordStatus === 'none' && s.coords.none}
          </p>

          {pendingClear && (
            <p
              className="text-xs text-soft"
              aria-live="polite"
              data-testid="address-clear-pending-notice"
            >
              {s.clearPending}{' '}
              <Button variant="ghost" size="sm" onClick={handleUndoClear} data-testid="address-clear-undo">
                {s.clearUndo}
              </Button>
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!canSave} busy={saving} data-testid="address-save-button">
              {saving ? s.saving : s.save}
            </Button>

            {hasStoredAddress && !pendingClear && (
              <Button onClick={handleClearRequest} disabled={saving} data-testid="address-clear-button">
                {s.clear}
              </Button>
            )}
          </div>

          {/* A failed save is red (INC-20); a successful one confirms here (INC-19). */}
          {saveError && (
            <p role="alert" data-testid="address-save-error" className="form-error">
              {saveError}
            </p>
          )}

          <SuccessBanner message={saveSuccess} onDismiss={() => setSaveSuccess(null)} testId="address-save-success" />

          {/* History panel (F5, AC-5.3) — independent load/error state */}
          <div className="border-t border-rule pt-3 mt-2" data-testid="address-history-panel">
            <h4 className="text-xs font-semibold mb-2 text-text">{s.history.title}</h4>

            {historyState.status === 'loading' && <SkeletonListRows rows={2} />}

            {historyState.status === 'error' && (
              <ErrorBanner
                message={historyState.message}
                onRetry={handleHistoryRetry}
                retryLabel={s.retry}
              />
            )}

            {historyState.status === 'loaded' && historyState.entries.length === 0 && (
              <p className="text-xs text-soft" data-testid="address-history-empty">
                {s.history.empty}
              </p>
            )}

            {historyState.status === 'loaded' && historyState.entries.length > 0 && (
              <ul className="flex flex-col gap-2">
                {historyState.entries.map((entry) => (
                  <li
                    key={entry.id}
                    data-testid={`address-history-entry-${entry.id}`}
                    className="text-xs text-text"
                  >
                    <span className="text-soft">
                      {/* sr-only column labels (design.md "Changed by / Changed on / Previous → New") — the visible
                          layout is a compact, un-headered list (design.md: "not necessarily a full paginated
                          <table>"), but a screen-reader user still benefits from knowing which value is which. */}
                      <span className="sr-only">{s.history.changedBy}: </span>
                      {formatHistoryActor(entry.actorUserId)}
                      {' · '}
                      <span className="sr-only">{s.history.changedOn}: </span>
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <br />
                    <span className="sr-only">{s.history.previous}: </span>
                    {formatHistorySide(entry.data?.before)}
                    {' '}
                    <Icon name="arrow-right" />{' '}
                    <span className="sr-only">{s.history.new}: </span>
                    {formatHistorySide(entry.data?.after)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
