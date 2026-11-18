import { useState } from 'react'
import { Field } from '@operai/ui'
import FormModal from './FormModal'
import { ApiError } from '../lib/api'
import { createOffice, updateOffice } from '../lib/officesApi'
import { toInventoryError } from '../lib/types'
import type { Entity, Office } from '../lib/types'
import { strings } from '../strings'

/**
 * OfficeFormDialog — add an office, or rename / change the entity of one
 * (`/offices`). Name and entity are the only fields; the entity is information
 * only, so every entity in the caller's scope is offered. `office_name_taken` is a
 * field error on the name; a 404 (the office is gone or out of scope) goes to the
 * page with `onGone`; anything else stays inline and keeps what was typed.
 */

export type OfficeFormDialogProps = {
  /** The office being edited; null adds a new one. */
  office: Office | null
  /** Entities the caller manages; the office's own entity is always offered when editing. */
  entities: readonly Entity[]
  onSaved: (saved: Office, mode: 'added' | 'updated') => void
  onCancel: () => void
  /** The office disappeared (404): the page reloads the list. */
  onGone: () => void
}

const unavailable = `${strings.common.authUnavailable.heading}. ${strings.common.authUnavailable.body}`

export default function OfficeFormDialog({ office, entities, onSaved, onCancel, onGone }: OfficeFormDialogProps) {
  const t = strings.offices.form
  const options = office !== null && !entities.includes(office.entity) ? [office.entity, ...entities] : entities
  const [name, setName] = useState(office?.name ?? '')
  const [entity, setEntity] = useState<Entity | ''>(office?.entity ?? (entities.length === 1 ? entities[0]! : ''))
  const [nameError, setNameError] = useState<string | null>(null)
  const [entityError, setEntityError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setGeneralError(null)
    const trimmed = name.trim()
    const missingName = trimmed === ''
    const missingEntity = entity === ''
    setNameError(missingName ? t.nameRequired : null)
    setEntityError(missingEntity ? t.entityRequired : null)
    if (missingName || entity === '') return
    setSubmitting(true)
    try {
      if (office === null) onSaved(await createOffice({ name: trimmed, entity }), 'added')
      else {
        onSaved(
          await updateOffice(office.id, {
            ...(trimmed !== office.name ? { name: trimmed } : {}),
            ...(entity !== office.entity ? { entity } : {}),
          }),
          'updated',
        )
      }
    } catch (error) {
      const known = toInventoryError(error)
      if (known?.code === 'office_name_taken') setNameError(strings.errors.office_name_taken)
      else if (error instanceof ApiError && error.status === 404) onGone()
      else if (error instanceof ApiError && error.status === 422) setGeneralError(strings.errors.validation)
      else if (error instanceof ApiError && error.status === 503) setGeneralError(unavailable)
      else
        setGeneralError(error instanceof ApiError ? (error.detail ?? strings.errors.unknown) : strings.errors.network)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FormModal
      title={office === null ? t.addTitle : t.editTitle(office.name)}
      description={t.description}
      submitLabel={office === null ? t.create : t.save}
      submittingLabel={office === null ? t.creating : t.saving}
      submitting={submitting}
      generalError={generalError}
      onSubmit={() => void submit()}
      onCancel={onCancel}
      testIdPrefix="office-form"
    >
      <div className="flex flex-col gap-4">
        <Field label={t.name} required error={nameError ?? undefined}>
          {(control) => (
            <input
              {...control}
              type="text"
              value={name}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
              className="w-full"
            />
          )}
        </Field>
        <Field label={t.entity} required error={entityError ?? undefined}>
          {(control) => (
            <select
              {...control}
              value={entity}
              onChange={(event) => {
                setEntity(event.target.value as Entity)
                setEntityError(null)
              }}
              className="w-full"
            >
              <option value="" disabled>
                {t.entityPlaceholder}
              </option>
              {options.map((value) => (
                <option key={value} value={value}>
                  {strings.common.entity[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </FormModal>
  )
}
