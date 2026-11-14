import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import { Banner, Button, Card, Field } from '@operai/ui'
import { ApiError } from '../lib/api'
import { getOfferSequence, setOfferSequence } from '../lib/crmApi'
import type { OfferSequence } from '../lib/crmApi'
import { codeOf, errorMessage } from '../lib/errors'
import type { Entity } from '../lib/types'
import { useResource } from '../hooks/useResource'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'

/** How an offer number prints: four digits, a slash and the year. */
const referenceOf = (next: number, year: number) => `${String(next).padStart(4, '0')}/${year}`

/**
 * OfferNumberingCard — where ONE entity's offer numbers continue from this year
 * (specs/20261102-crm-offer-document US-8), so the CRM follows wellD's document system. The server
 * refuses a number an offer already carries (409 `offer_number_used`).
 */
export default function OfferNumberingCard({ entity }: { entity: Entity }) {
  const t = strings.settings.numbering
  const label = strings.badges.entity[entity]
  const load = useCallback((signal: AbortSignal) => getOfferSequence(entity, { signal }), [entity])
  const sequence = useResource(load)
  return (
    <Card title={t.title(label)} data-testid={`crm-settings-${entity}-numbering`}>
      {sequence.status === 'loading' && <Loading label={t.loading} rows={1} />}
      {sequence.status === 'error' && <LoadFailure error={sequence.error} onRetry={sequence.retry} />}
      {sequence.status === 'ready' && (
        <NumberingForm entity={entity} sequence={sequence.data!} onSaved={(next) => sequence.replace(next)} />
      )}
    </Card>
  )
}

function NumberingForm({
  entity,
  sequence,
  onSaved,
}: {
  entity: Entity
  sequence: OfferSequence
  onSaved: (next: OfferSequence) => void
}) {
  const t = strings.settings.numbering
  const [text, setText] = useState(String(sequence.next))
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const value = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null
  // The hint states what is SAVED: describing the typed number made an unsaved
  // change read as applied, and an offer was numbered from the old counter.
  const example = referenceOf(sequence.next, sequence.year)
  const unsaved = value !== null && value !== sequence.next

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSaved(null)
    setError(null)
    if (value === null || value < 1 || value > 9_999) return setFieldError(t.invalid)
    if (value < sequence.lowestAllowed) return setFieldError(t.used(sequence.lowestAllowed))
    setFieldError(null)
    setBusy(true)
    setOfferSequence(entity, sequence.year, value).then(
      (next) => {
        setBusy(false)
        setSaved(t.saved(strings.badges.entity[entity], referenceOf(next.next, next.year)))
        onSaved(next)
      },
      (failure: unknown) => {
        setBusy(false)
        if (codeOf(failure) === 'offer_number_used' && failure instanceof ApiError) {
          const lowest = failure.extras['lowestAllowed']
          return setFieldError(t.used(typeof lowest === 'number' ? lowest : sequence.lowestAllowed))
        }
        setError(errorMessage(failure))
      },
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3">
      {error && <Banner tone="danger">{error}</Banner>}
      {saved && (
        <Banner tone="success" compact autoDismiss onDismiss={() => setSaved(null)} dismissLabel={strings.common.dismiss}>
          {saved}
        </Banner>
      )}
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[8rem_1fr]">
        <Field label={t.year} testId={`crm-settings-${entity}-numbering-year`}>
          {(control) => <input {...control} className="font-mono" value={sequence.year} readOnly />}
        </Field>
        <Field
          label={t.next}
          hint={t.nextHint(example, sequence.lowestAllowed)}
          error={fieldError}
          testId={`crm-settings-${entity}-numbering-next`}
        >
          {(control) => (
            <input
              {...control}
              className="font-mono"
              inputMode="numeric"
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setFieldError(null)
              }}
            />
          )}
        </Field>
      </div>
      {unsaved && !fieldError && (
        <Banner tone="warning" compact live="polite" data-testid={`crm-settings-${entity}-numbering-unsaved`}>
          {t.unsaved(example, referenceOf(value, sequence.year))}
        </Banner>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy} data-testid={`crm-settings-${entity}-numbering-save`}>
          {t.save}
        </Button>
      </div>
    </form>
  )
}
