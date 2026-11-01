import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { CheckboxGroupField, Field, RadioGroupField, focusFirstInvalid } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { CatalogueFrame, t, useLatency } from './catalogue'

/**
 * A short settings form in the `narrow` column (40rem): one card, a few
 * fields (a select, a radio group, a checkbox group, a single checkbox), one primary. Save is busy for 0.9s, then a compact success `Banner`
 * appears above the form and dismisses itself after 3s. Clear the display
 * name and save to see validation and focus on the invalid field.
 */
const meta = {
  title: 'Pages/Settings',
  parameters: { frame: 'page', controls: { disable: true } },
} satisfies Meta
export default meta

type Story = StoryObj

function SettingsPage() {
  const titleId = useId()
  const radioName = useId()
  const later = useLatency()
  const formRef = useRef<HTMLFormElement>(null)
  const [displayName, setDisplayName] = useState('Giulia Bianchi')
  const [currency, setCurrency] = useState('EUR')
  const [pageSize, setPageSize] = useState('25')
  const [weekly, setWeekly] = useState(true)
  const [alerts, setAlerts] = useState<string[]>(['low-stock'])
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(0)
  const [showSaved, setShowSaved] = useState(false)

  const nameError = touched && displayName.trim() === '' ? t.settings.displayNameRequired : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (displayName.trim() === '') {
      // Once the error has rendered, focus the first invalid field.
      window.requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    setBusy(true)
    setShowSaved(false)
    later(900, () => {
      setBusy(false)
      setSaved((n) => n + 1)
      setShowSaved(true)
    })
  }

  return (
    <CatalogueFrame active="settings" width="narrow">
      <section aria-labelledby={titleId}>
        <PageHeader title={t.settings.heading} titleId={titleId} description={t.settings.description} />
        <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-4">
          {showSaved && (
            <Banner
              key={saved}
              tone="success"
              compact
              autoDismiss
              onDismiss={() => setShowSaved(false)}
              dismissLabel={t.delete.dismiss}
            >
              {t.settings.saved}
            </Banner>
          )}
          <Card title="Your preferences">
            <fieldset disabled={busy} className="flex flex-col gap-4">
              <Field label={t.settings.displayName} hint={t.settings.displayNameHint} required error={nameError}>
                {(control) => (
                  <input
                    {...control}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onBlur={() => setTouched(true)}
                  />
                )}
              </Field>
              <Field label={t.settings.currency}>
                {(control) => (
                  <select {...control} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option>EUR</option>
                    <option>CHF</option>
                  </select>
                )}
              </Field>
              <RadioGroupField label={t.settings.pageSize}>
                {['10', '25', '50'].map((size) => (
                  <label key={size} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={radioName}
                      value={size}
                      checked={pageSize === size}
                      onChange={() => setPageSize(size)}
                    />
                    {size}
                  </label>
                ))}
              </RadioGroupField>
              <CheckboxGroupField
                label={t.settings.alerts}
                options={t.settings.alertOptions}
                selected={alerts}
                onToggle={(id, checked) => setAlerts((a) => (checked ? [...a, id] : a.filter((x) => x !== id)))}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
                {t.settings.weeklySummary}
              </label>
            </fieldset>
          </Card>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? t.settings.saving : t.settings.save}
            </Button>
          </div>
        </form>
      </section>
    </CatalogueFrame>
  )
}

export const Default: Story = {
  render: () => <SettingsPage />,
}
