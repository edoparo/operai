import { Link, useNavigate } from '@tanstack/react-router'
import { Banner, Button, DateInput, Field, MoneyInput, PageHeader, StatePanel, VisuallyHidden } from '@operai/ui'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import ErrorBanner from '../components/ErrorBanner'
import PermissionDenied from '../components/PermissionDenied'
import SkeletonListRows from '../components/SkeletonListRows'
import SupplierField from '../components/SupplierField'
import { useInventoryCapabilities } from '../hooks/useInventoryCapabilities'
import { useScope } from '../hooks/useScope'
import { ApiError } from '../lib/api'
import { registerAssets } from '../lib/assetsApi'
import { amountToCents, formatMoney } from '../lib/money'
import { splitPrice } from '../lib/splitPrice'
import { toInventoryError, validationField } from '../lib/types'
import type { AssetCategory, Currency, Entity, RegisterAssetsInput } from '../lib/types'
import { strings } from '../strings'
import { fillTemplate } from '../strings/errors'

/**
 * RegisterAssetPage — T3, `/assets/new` (T30, specs/20261006-hardware-inventory;
 * design.md § T3, F1, § Error and conflict catalogue; AC-1.1 to AC-1.7).
 *
 * `asset:manage` only (UX gate; the server's 403 is the real one). The entity
 * select is limited to `GET /scope`'s `asset` list and is a fixed read-only
 * value when that list has one entry; the currency follows the entity and is
 * shown, never editable (AC-1.2). With a quantity above 1 the page shows the
 * per-unit breakdown from `splitPrice` — the backend's own rule, mirrored — and
 * the serial numbers are either none or exactly one per unit (design Resolutions
 * G7; a blank line is ignored, so a unit cannot be skipped).
 *
 * Failure handling follows the catalogue. The one subtle case is a network
 * failure (or a gateway timeout): the POST is not idempotent and may have
 * created the assets, so the form is kept and the message says to check the list
 * before trying again — never "try again".
 *
 * On success the page navigates with a history `state` the destination can
 * announce: `{ registeredCount }` to the new asset (N = 1) or to the list
 * filtered by invoice reference (N > 1); Cancel returns to the list with
 * `{ focusRegister: true }` so focus lands on the Register button.
 */

type FieldKey = 'entity' | 'category' | 'description' | 'purchaseDate' | 'price' | 'quantity' | 'serials'

type FieldIssue = { message: string; conflictAssetId?: string }
type FieldErrors = Partial<Record<FieldKey, FieldIssue>>

type Failure = { kind: 'text'; text: string } | { kind: 'unavailable' }

type FormValues = {
  entity: Entity | ''
  category: AssetCategory | ''
  description: string
  purchaseDate: string
  price: string
  quantity: string
  serials: string
  notReceived: boolean
  supplier: string
  invoiceRef: string
  locationNote: string
}

const EMPTY: FormValues = {
  entity: '',
  category: '',
  description: '',
  purchaseDate: '',
  price: '',
  quantity: '1',
  serials: '',
  notReceived: false,
  supplier: '',
  invoiceRef: '',
  locationNote: '',
}

const FIELD_IDS: Record<FieldKey, string> = {
  entity: 'register-entity',
  category: 'register-category',
  description: 'register-description',
  purchaseDate: 'register-purchase-date',
  price: 'register-price',
  quantity: 'register-quantity',
  serials: 'register-serials',
}

/** AC-1.2: CHF for `welld_ch`, EUR for `welld_it`. Display only; the server derives it. */
const CURRENCY_OF: Record<Entity, Currency> = { welld_ch: 'CHF', welld_it: 'EUR' }
const CATEGORIES = Object.keys(strings.categories) as AssetCategory[]
const MAX_QUANTITY = 200

/** Present in every state of the page (also the denied and loading ones), so the route can be told apart. */
const PAGE_TEST_ID = 'inventory-register-asset-page'

/** Server field names -> form fields. */
const SERVER_FIELDS: Record<string, FieldKey> = {
  entity: 'entity',
  category: 'category',
  description: 'description',
  purchaseDate: 'purchaseDate',
  totalPriceCents: 'price',
  quantity: 'quantity',
  serialNumbers: 'serials',
}

const ORDER: FieldKey[] = ['entity', 'category', 'description', 'purchaseDate', 'price', 'quantity', 'serials']

const parseQuantity = (raw: string): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null
  const quantity = Number(raw.trim())
  return quantity >= 1 && quantity <= MAX_QUANTITY ? quantity : null
}

const parsePrice = (raw: string): number | null => {
  const cents = amountToCents(raw)
  return cents !== null && cents > 0 ? cents : null
}

/** Non-blank trimmed lines. */
const serialLines = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

const optional = (raw: string): string | undefined => {
  const text = raw.trim()
  return text === '' ? undefined : text
}

/** A field's error line: the message, plus a link to the conflicting asset when the server named one. */
function issueText(error: FieldIssue | undefined): ReactNode {
  if (error === undefined) return undefined
  return (
    <>
      {error.message}
      {error.conflictAssetId !== undefined && (
        <>
          {' '}
          <Link to="/assets/$id" params={{ id: error.conflictAssetId }} className="link">
            {strings.register.validation.conflictLink}
          </Link>
        </>
      )}
    </>
  )
}

export default function RegisterAssetPage() {
  const { canManageAssets } = useInventoryCapabilities()
  const scope = useScope(canManageAssets)
  const navigate = useNavigate()

  const [values, setValues] = useState<FormValues>(EMPTY)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<Failure | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [summaryFocus, setSummaryFocus] = useState(0)
  const [showSummary, setShowSummary] = useState(false)
  const touched = useRef(new Set<keyof FormValues>())
  const inFlight = useRef(false)
  const summaryRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus()
  }, [summaryFocus])

  if (!canManageAssets) {
    return (
      <div data-testid={PAGE_TEST_ID}>
        <PermissionDenied />
      </div>
    )
  }

  if (scope.status !== 'ready') {
    const unavailable = scope.error instanceof ApiError && scope.error.status === 503
    const scopeMessage =
      scope.error instanceof ApiError ? (scope.error.detail ?? strings.errors.unknown) : strings.errors.network
    return (
      <div data-testid={PAGE_TEST_ID}>
        {scope.status === 'error' ? (
          unavailable ? (
            <ErrorBanner variant="authUnavailable" onRetry={scope.retry} />
          ) : (
            <ErrorBanner message={scopeMessage} onRetry={scope.retry} />
          )
        ) : (
          <>
            <VisuallyHidden live role="status">
              {strings.register.loadingScope}
            </VisuallyHidden>
            <SkeletonListRows />
          </>
        )}
      </div>
    )
  }

  const entities = scope.scope?.asset ?? []
  if (entities.length === 0) {
    return (
      <section aria-labelledby="register-heading" data-testid={PAGE_TEST_ID}>
        <PageHeader title={strings.register.heading} titleId="register-heading" />
        <StatePanel title={strings.register.noEntity} />
      </section>
    )
  }

  const entity: Entity | '' = entities.length === 1 ? entities[0] : values.entity
  const currency = entity === '' ? null : CURRENCY_OF[entity]
  const quantity = parseQuantity(values.quantity)
  const priceCents = parsePrice(values.price)

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K], clears?: FieldKey) => {
    touched.current.add(key)
    setValues((previous) => ({ ...previous, [key]: value }))
    if (clears !== undefined && errors[clears] !== undefined) {
      setErrors((previous) => {
        const next = { ...previous }
        delete next[clears]
        return next
      })
    }
  }

  const breakdown = ((): string | null => {
    if (quantity === null || quantity < 2 || priceCents === null || currency === null) return null
    const prices = splitPrice(priceCents, quantity)
    const each = prices[0]
    const last = prices[prices.length - 1]
    return strings.register.breakdown(
      quantity,
      formatMoney(each, currency),
      last === each ? null : formatMoney(last, currency),
    )
  })()

  const labels: Record<FieldKey, string> = {
    entity: strings.register.fields.entity,
    category: strings.register.fields.category,
    description: strings.register.fields.description,
    purchaseDate: strings.register.fields.purchaseDate,
    price: currency === null ? strings.register.fields.totalPrice : strings.register.fields.totalPriceIn(currency),
    quantity: strings.register.fields.quantity,
    serials: quantity === 1 || quantity === null ? strings.register.fields.serial : strings.register.fields.serials,
  }

  /** The client-side field errors of the form as it stands. */
  const check = (): FieldErrors => {
    const v = strings.register.validation
    const found: FieldErrors = {}
    if (entity === '') found.entity = { message: v.entityRequired }
    if (values.category === '') found.category = { message: v.categoryRequired }
    if (values.description.trim() === '') found.description = { message: v.required }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.purchaseDate)) found.purchaseDate = { message: v.dateInvalid }
    if (priceCents === null) found.price = { message: v.priceInvalid }
    if (quantity === null) found.quantity = { message: v.quantityInvalid }

    const lines = serialLines(values.serials)
    if (quantity !== null && lines.length > 0 && lines.length !== quantity) {
      found.serials = { message: v.serialCount(quantity) }
    } else if (new Set(lines).size !== lines.length) {
      found.serials = { message: v.serialDuplicate }
    }
    return found
  }

  /** Validates the form; returns the request or the field errors. */
  const validate = (): { input: RegisterAssetsInput } | { errors: FieldErrors } => {
    const found = check()
    const lines = serialLines(values.serials)

    if (
      Object.keys(found).length > 0 ||
      entity === '' ||
      values.category === '' ||
      priceCents === null ||
      quantity === null
    ) {
      return { errors: found }
    }

    const input: RegisterAssetsInput = {
      entity,
      category: values.category,
      description: values.description.trim(),
      purchaseDate: values.purchaseDate,
      totalPriceCents: priceCents,
      quantity,
    }
    if (lines.length > 0) input.serialNumbers = lines
    if (values.notReceived) input.received = false
    const supplier = optional(values.supplier)
    const invoiceRef = optional(values.invoiceRef)
    const locationNote = optional(values.locationNote)
    if (supplier) input.supplier = supplier
    if (invoiceRef) input.invoiceRef = invoiceRef
    if (locationNote) input.locationNote = locationNote
    return { input }
  }

  /** Maps a failed POST onto the form (design.md § Error and conflict catalogue). */
  const explain = (error: unknown, sentEntity: Entity): { fields: FieldErrors; failure: Failure | null } => {
    const known = toInventoryError(error)
    if (known?.code === 'serial_conflict') {
      const { serialNumber, assetId } = known.extras
      return {
        fields: {
          serials: {
            message:
              serialNumber === undefined
                ? strings.register.validation.serialConflictNoSerial
                : fillTemplate(strings.errors.serial_conflict, { serialNumber }),
            conflictAssetId: assetId,
          },
        },
        failure: null,
      }
    }
    if (known?.code === 'serial_count_mismatch') {
      return { fields: { serials: { message: strings.errors.serial_count_mismatch } }, failure: null }
    }
    if (known?.code === 'fiscal_year_closed') {
      const { year } = known.extras
      return {
        fields: {
          purchaseDate: {
            message:
              year === undefined
                ? strings.register.validation.yearClosedNoYear
                : fillTemplate(strings.errors.fiscal_year_closed, { year, entity: strings.common.entity[sentEntity] }),
          },
        },
        failure: null,
      }
    }
    if (error instanceof ApiError) {
      if (error.status === 422) {
        const named = validationField(error)
        const target = named === undefined ? undefined : SERVER_FIELDS[named]
        const message = error.detail ?? strings.errors.validation
        if (target !== undefined) return { fields: { [target]: { message } }, failure: null }
        return { fields: {}, failure: { kind: 'text', text: message } }
      }
      if (error.status === 403) {
        return { fields: {}, failure: { kind: 'text', text: strings.register.failure.entityForbidden } }
      }
      if (error.status === 503) return { fields: {}, failure: { kind: 'unavailable' } }
      if (error.status < 500) {
        return { fields: {}, failure: { kind: 'text', text: error.detail ?? strings.errors.unknown } }
      }
    }
    // A network failure, a gateway timeout or a 5xx: the assets may exist already.
    return { fields: {}, failure: { kind: 'text', text: strings.register.failure.unconfirmed } }
  }

  const submit = async () => {
    if (inFlight.current) return
    const result = validate()
    if ('errors' in result) {
      setErrors(result.errors)
      setFailure(null)
      setShowSummary(true)
      setSummaryFocus((n) => n + 1)
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setErrors({})
    setFailure(null)
    try {
      const { assets } = await registerAssets(result.input)
      const registeredCount = assets.length
      if (registeredCount === 1) {
        await navigate({ to: '/assets/$id', params: { id: assets[0].id }, state: { registeredCount } as never })
      } else {
        await navigate({
          to: '/assets',
          search: (result.input.invoiceRef ? { invoiceRef: result.input.invoiceRef } : {}) as never,
          state: { registeredCount } as never,
        })
      }
    } catch (error) {
      const explained = explain(error, result.input.entity)
      setErrors(explained.fields)
      setFailure(explained.failure)
      if (Object.keys(explained.fields).length > 0) {
        setShowSummary(true)
        setSummaryFocus((n) => n + 1)
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const summaryItems = ORDER.filter((key) => errors[key] !== undefined).map((key) => ({
    key,
    label: labels[key],
    message: errors[key]!.message,
  }))

  const jump = (key: FieldKey) => document.getElementById(FIELD_IDS[key])?.focus()

  /**
   * Blur of a field the person has typed in: show (or clear) that field's own error now, without waiting for
   * submit (design-system.md § Forms). Untouched fields stay quiet until the first submit; a server-side error
   * (a serial conflict, a closed year) stays until the field changes.
   */
  const blurred = (key: FieldKey & keyof FormValues) => () => {
    if (!touched.current.has(key)) return
    const issue = check()[key]
    // Typing already cleared this field's error (`set`), so one still here came from the server: keep it.
    setErrors((previous) =>
      previous[key] !== undefined || issue === undefined ? previous : { ...previous, [key]: issue },
    )
  }

  const received = strings.register.fields

  return (
    <section aria-labelledby="register-heading" data-testid={PAGE_TEST_ID} className="max-w-2xl">
      <PageHeader title={strings.register.heading} titleId="register-heading" />

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {showSummary && summaryItems.length > 0 && (
          // Danger: these are errors to fix (INC-20). Focusable so a failed submit can move focus here (the
          // error-summary pattern).
          <Banner
            ref={summaryRef}
            tone="danger"
            tabIndex={-1}
            data-testid="register-summary"
            title={strings.register.validation.summaryHeading}
          >
            <div>
              <ul className="flex flex-col gap-1">
                {summaryItems.map((item) => (
                  <li key={item.key}>
                    <a
                      href={`#${FIELD_IDS[item.key]}`}
                      onClick={(event) => {
                        event.preventDefault()
                        jump(item.key)
                      }}
                      className="link"
                    >
                      {item.label}
                    </a>
                    {': '}
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Banner>
        )}

        {failure?.kind === 'text' && (
          <Banner tone="danger" data-testid="register-form-error">
            {failure.text}
          </Banner>
        )}
        {failure?.kind === 'unavailable' && <ErrorBanner variant="authUnavailable" onRetry={() => void submit()} />}

        <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-4 border-0 p-0">
          {entities.length === 1 ? (
            <div className="field">
              <span className="field-label">{received.entity}</span>
              <p data-testid="register-entity-fixed" className="text-sm text-text">
                {strings.common.entity[entities[0]]}
              </p>
              <p className="field-hint">{strings.register.entityReadOnly}</p>
            </div>
          ) : (
            <Field
              id={FIELD_IDS.entity}
              label={received.entity}
              required
              error={issueText(errors.entity)}
              errorTestId="register-error-entity"
            >
              {(control) => (
                <select
                  {...control}
                  value={values.entity}
                  onChange={(event) => set('entity', event.target.value as Entity | '', 'entity')}
                  onBlur={blurred('entity')}
                  className="w-full"
                >
                  <option value="">{received.entityPlaceholder}</option>
                  {entities.map((value) => (
                    <option key={value} value={value}>
                      {strings.common.entity[value]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field
            id={FIELD_IDS.category}
            label={received.category}
            required
            error={issueText(errors.category)}
            errorTestId="register-error-category"
          >
            {(control) => (
              <select
                {...control}
                value={values.category}
                onChange={(event) => set('category', event.target.value as AssetCategory | '', 'category')}
                onBlur={blurred('category')}
                className="w-full"
              >
                <option value="">{received.categoryPlaceholder}</option>
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {strings.categories[value]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            id={FIELD_IDS.description}
            label={received.description}
            required
            error={issueText(errors.description)}
            errorTestId="register-error-description"
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={values.description}
                onChange={(event) => set('description', event.target.value, 'description')}
                onBlur={blurred('description')}
                className="w-full"
              />
            )}
          </Field>

          <Field
            id={FIELD_IDS.purchaseDate}
            label={received.purchaseDate}
            required
            error={issueText(errors.purchaseDate)}
            errorTestId="register-error-purchaseDate"
          >
            {(control) => (
              <DateInput
                {...control}
                value={values.purchaseDate}
                onChange={(event) => set('purchaseDate', event.target.value, 'purchaseDate')}
                onBlur={blurred('purchaseDate')}
                className="w-full"
              />
            )}
          </Field>

          <Field
            id={FIELD_IDS.price}
            label={labels.price}
            required
            error={issueText(errors.price)}
            errorTestId="register-error-price"
          >
            {(control) => (
              <div className="flex items-center gap-2">
                <MoneyInput
                  {...control}
                  value={values.price}
                  onChange={(event) => set('price', event.target.value, 'price')}
                  onBlur={blurred('price')}
                  className="w-full"
                />
                {currency !== null && (
                  <span aria-hidden="true" className="text-sm text-soft">
                    {currency}
                  </span>
                )}
              </div>
            )}
          </Field>

          <div className="flex flex-col gap-1">
            <Field
              id={FIELD_IDS.quantity}
              label={received.quantity}
              required
              hint={received.quantityHint}
              error={issueText(errors.quantity)}
              errorTestId="register-error-quantity"
            >
              {(control) => (
                // A count, not money: a number input is right here (INC-17 keeps non-money quantities numeric).
                <input
                  {...control}
                  type="number"
                  min={1}
                  max={MAX_QUANTITY}
                  step={1}
                  value={values.quantity}
                  onChange={(event) => set('quantity', event.target.value, 'quantity')}
                  onBlur={blurred('quantity')}
                  className="w-full"
                />
              )}
            </Field>
            <p aria-live="polite" data-testid="register-breakdown" className="text-sm text-text font-mono">
              {breakdown ?? ''}
            </p>
          </div>

          <Field
            id={FIELD_IDS.serials}
            label={labels.serials}
            hint={quantity !== null && quantity > 1 ? received.serialsHint(quantity) : undefined}
            error={issueText(errors.serials)}
            errorTestId="register-error-serials"
          >
            {(control) =>
              quantity !== null && quantity > 1 ? (
                <textarea
                  {...control}
                  rows={Math.min(quantity, 8)}
                  value={values.serials}
                  onChange={(event) => set('serials', event.target.value, 'serials')}
                  onBlur={blurred('serials')}
                  className="w-full input-figure"
                />
              ) : (
                <input
                  {...control}
                  type="text"
                  value={values.serials}
                  onChange={(event) => set('serials', event.target.value, 'serials')}
                  onBlur={blurred('serials')}
                  className="w-full"
                />
              )
            }
          </Field>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <input
                id="register-received"
                type="checkbox"
                checked={values.notReceived}
                onChange={(event) => set('notReceived', event.target.checked)}
                aria-describedby="register-received-hint"
              />
              <label htmlFor="register-received" className="text-sm text-text">
                {received.notReceived}
              </label>
            </div>
            <p id="register-received-hint" className="field-hint">
              {received.notReceivedHint}
            </p>
          </div>

          <Field id="register-supplier" label={received.supplier}>
            {(control) => (
              <SupplierField
                id={control.id}
                value={values.supplier}
                onChange={(value) => set('supplier', value)}
                ariaDescribedBy={control['aria-describedby']}
              />
            )}
          </Field>

          <Field id="register-invoice-ref" label={received.invoiceRef}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={values.invoiceRef}
                onChange={(event) => set('invoiceRef', event.target.value)}
                className="w-full"
              />
            )}
          </Field>

          <Field id="register-location-note" label={received.locationNote}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={values.locationNote}
                onChange={(event) => set('locationNote', event.target.value)}
                className="w-full"
              />
            )}
          </Field>
        </fieldset>

        {/* Submit on the right, Cancel (ghost) to its left (design-system.md § Forms). */}
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => void navigate({ to: '/assets', state: { focusRegister: true } as never })}
          >
            {strings.register.cancel}
          </Button>
          <Button
            type="submit"
            variant="primary"
            aria-busy={submitting || undefined}
            aria-disabled={submitting || undefined}
          >
            {submitting
              ? strings.register.submitting
              : quantity !== null && quantity > 1
                ? strings.register.submitMany(quantity)
                : strings.register.submit}
          </Button>
        </div>
      </form>
    </section>
  )
}
