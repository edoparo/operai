import { useState } from 'react'
import { Card, CheckboxGroupField, DateInput, FactList, Field, Icon, RadioGroupField, resolveLocale } from '@operai/ui'
import { strings } from '../../strings'
import ListFieldEditor, { type ListItemDecl } from './ListFieldEditor'
import type { StepPanelProps } from './StepPanel'

const t = strings.offerWizard

const MIN_LINES = 1
const MAX_LINES = 8
const MAX_LINE_CHARS = 200
const MAX_CONTACTS = 5
const MAX_PLACE_CHARS = 120

const LINES_ITEM: ListItemDecl = {
  type: 'list',
  name: 'client:lines',
  label: t.client.lines,
  hint: t.client.linesHint,
  optional: false,
  handEditedIn: [],
}

/**
 * The Client step (design S3; AC-2.1, AC-2.2, AC-2.5): what the deal's company gives — client lines, contacts, place —
 * all prefilled and editable, the printed date (the day of generation, or one the person picks, checked against the
 * context's day), and the reference, which is shown and never asked: it is assigned when the offer is generated.
 */
export default function ClientStep({ answers, onAnswersChange, context, resolved, referenceNote }: StepPanelProps) {
  const [contactError, setContactError] = useState<string | null>(null)
  const { client } = answers
  const setClient = (patch: Partial<typeof client>) => onAnswersChange({ ...answers, client: { ...client, ...patch } })
  const dateIssue = resolved.invalid.find((issue) => issue.name === 'client:date')
  const specificDate = client.date !== null

  const toggleContact = (id: string, checked: boolean) => {
    if (checked && client.contactIds.length >= MAX_CONTACTS) {
      setContactError(t.client.contactsLimit)
      return
    }
    setContactError(null)
    setClient({
      contactIds: checked ? [...client.contactIds, id] : client.contactIds.filter((chosen) => chosen !== id),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card title={t.client.card}>
        <div className="flex flex-col gap-4">
          <ListFieldEditor
            item={LINES_ITEM}
            items={client.lines}
            language={resolveLocale()}
            minItems={MIN_LINES}
            maxItems={MAX_LINES}
            maxChars={MAX_LINE_CHARS}
            limitText={t.client.linesLimit}
            onChange={(lines) => setClient({ lines })}
          />
          <CheckboxGroupField
            label={t.client.contacts}
            error={contactError}
            options={context.contacts.map((contact) => ({ id: contact.id, label: contact.name }))}
            selected={client.contactIds}
            onToggle={toggleContact}
            emptyState={t.client.contactsEmpty}
            scroll
            testId="crm-wizard-contacts"
          />
        </div>
      </Card>
      <Card title={t.client.placeDate}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.client.place}>
            {(control) => (
              <input
                {...control}
                type="text"
                data-wizard-field="client:place"
                maxLength={MAX_PLACE_CHARS}
                value={client.place}
                onChange={(event) => setClient({ place: event.target.value })}
              />
            )}
          </Field>
          <div className="flex flex-col gap-3">
            <RadioGroupField label={t.client.date}>
              <label>
                <input
                  type="radio"
                  name="crm-wizard-date-mode"
                  checked={!specificDate}
                  onChange={() => setClient({ date: null })}
                />
                {t.client.dateToday}
              </label>
              <label>
                <input
                  type="radio"
                  name="crm-wizard-date-mode"
                  checked={specificDate}
                  onChange={() => setClient({ date: client.date ?? context.today })}
                />
                {t.client.dateOn}
              </label>
            </RadioGroupField>
            {specificDate ? (
              <Field label={t.client.dateInput} error={dateIssue ? t.client.dateRange : null}>
                {(control) => (
                  <DateInput
                    {...control}
                    data-wizard-field="client:date"
                    value={client.date ?? ''}
                    onChange={(event) =>
                      setClient({ date: event.target.value === '' ? context.today : event.target.value })
                    }
                  />
                )}
              </Field>
            ) : null}
          </div>
        </div>
      </Card>
      <Card title={t.client.reference}>
        <FactList
          items={[
            {
              id: 'reference',
              term: t.client.reference,
              value: (
                <>
                  <Icon name="lock" /> {referenceNote ?? t.client.referencePending}
                </>
              ),
            },
          ]}
        />
        <p className="mt-2 text-xs text-soft">{t.client.currency(context.currency)}</p>
      </Card>
    </div>
  )
}
