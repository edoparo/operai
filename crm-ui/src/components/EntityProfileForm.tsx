import { useState } from 'react'
import type { FormEvent } from 'react'
import { Banner, Button, Card, Field, formatDateTime } from '@operai/ui'
import { saveEntityProfile } from '../lib/crmApi'
import { errorMessage } from '../lib/errors'
import type { Entity, EntityProfile } from '../lib/types'
import { first, maxLength, optional, required } from '../lib/validate'
import { strings } from '../strings'

type FieldName = 'legalName' | 'address' | 'vat' | 'iban' | 'termsEn' | 'termsIt' | 'place'

const splitLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

/**
 * EntityProfileForm — the letterhead and standard terms of ONE entity (specs/018
 * O2), saved whole with `PUT /entity-profiles/:entity`. Offers snapshot what
 * they printed, so saving never rewrites an issued offer.
 */
export default function EntityProfileForm({
  entity,
  profile,
  onSaved,
}: {
  entity: Entity
  profile: EntityProfile | null
  onSaved: (profile: EntityProfile) => void
}) {
  const t = strings.settings
  const label = strings.badges.entity[entity]
  const [legalName, setLegalName] = useState(profile?.legalName ?? '')
  const [address, setAddress] = useState((profile?.addressLines ?? []).join('\n'))
  const [vat, setVat] = useState(profile?.vatNumber ?? '')
  const [iban, setIban] = useState(profile?.iban ?? '')
  const [termsEn, setTermsEn] = useState(profile?.offerTermsEn ?? '')
  const [termsIt, setTermsIt] = useState(profile?.offerTermsIt ?? '')
  const [place, setPlace] = useState(profile?.placeOfIssue ?? '')
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const lines = splitLines(address)
    const found: Partial<Record<FieldName, string>> = {
      legalName: first(required(legalName), maxLength(legalName, 200)) ?? undefined,
      address:
        lines.length > 5 ? t.addressTooMany : lines.some((line) => line.length > 200) ? t.addressLineTooLong : undefined,
      vat: maxLength(vat, 50) ?? undefined,
      iban: maxLength(iban, 50) ?? undefined,
      termsEn: maxLength(termsEn, 10_000) ?? undefined,
      termsIt: maxLength(termsIt, 10_000) ?? undefined,
      place: maxLength(place, 100) ?? undefined,
    }
    setErrors(found)
    if (Object.values(found).some(Boolean)) return
    setBusy(true)
    setError(null)
    setSaved(null)
    saveEntityProfile(entity, {
      legalName: legalName.trim(),
      addressLines: lines,
      vatNumber: optional(vat),
      iban: optional(iban),
      offerTermsEn: optional(termsEn),
      offerTermsIt: optional(termsIt),
      placeOfIssue: optional(place),
    }).then(
      (next) => {
        setBusy(false)
        setSaved(t.saved(label))
        onSaved(next)
      },
      (failure: unknown) => {
        setBusy(false)
        setError(errorMessage(failure))
      },
    )
  }

  return (
    <Card title={t.profile(label)} data-testid={`crm-settings-${entity}`}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-3">
        {profile === null && <p className="text-xs text-soft">{t.notSet}</p>}
        {error && <Banner tone="danger">{error}</Banner>}
        {saved && (
          <Banner tone="success" compact autoDismiss onDismiss={() => setSaved(null)} dismissLabel={strings.common.dismiss}>
            {saved}
          </Banner>
        )}
        <Field label={t.fields.legalName} required error={errors.legalName} testId={`crm-settings-${entity}-legal`}>
          {(control) => <input {...control} value={legalName} onChange={(event) => setLegalName(event.target.value)} />}
        </Field>
        <Field label={t.fields.address} hint={t.fields.addressHint} error={errors.address} testId={`crm-settings-${entity}-address`}>
          {(control) => <textarea {...control} rows={4} value={address} onChange={(event) => setAddress(event.target.value)} />}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t.fields.vat} error={errors.vat} testId={`crm-settings-${entity}-vat`}>
            {(control) => <input {...control} value={vat} onChange={(event) => setVat(event.target.value)} />}
          </Field>
          <Field label={t.fields.iban} error={errors.iban} testId={`crm-settings-${entity}-iban`}>
            {(control) => <input {...control} className="font-mono" value={iban} onChange={(event) => setIban(event.target.value)} />}
          </Field>
        </div>
        <Field label={t.fields.placeOfIssue} hint={t.fields.placeOfIssueHint} error={errors.place} testId={`crm-settings-${entity}-place`}>
          {(control) => <input {...control} value={place} onChange={(event) => setPlace(event.target.value)} />}
        </Field>
        <Field label={t.fields.termsEn} hint={t.fields.termsHint} error={errors.termsEn} testId={`crm-settings-${entity}-terms-en`}>
          {(control) => <textarea {...control} rows={5} value={termsEn} onChange={(event) => setTermsEn(event.target.value)} />}
        </Field>
        <Field label={t.fields.termsIt} error={errors.termsIt} testId={`crm-settings-${entity}-terms-it`}>
          {(control) => <textarea {...control} rows={5} value={termsIt} onChange={(event) => setTermsIt(event.target.value)} />}
        </Field>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-soft">{profile ? t.updated(formatDateTime(profile.updatedAt)) : ''}</span>
          <Button type="submit" variant="primary" busy={busy} data-testid={`crm-settings-${entity}-save`}>
            {busy ? t.saving : t.save}
          </Button>
        </div>
      </form>
    </Card>
  )
}
