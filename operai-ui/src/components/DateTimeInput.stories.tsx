import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field } from './Field'
import { DateTimeInput } from './MoneyInput'
import { formatDateTime } from '../lib/format'

/**
 * A date and a time (`datetime-local`, e.g. a cutoff). Same skin as
 * `DateInput`; the value is `YYYY-MM-DDTHH:mm` in local time. Display it with
 * `formatDateTime` (dd.mm.yyyy hh:mm).
 */
const meta = {
  title: 'Components/Forms/DateTimeInput',
  component: DateTimeInput,
  tags: ['autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof DateTimeInput>
export default meta

type Story = StoryObj<typeof meta>

function Demo() {
  const [value, setValue] = useState('2026-11-30T18:00')
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Field label="Orders close at" hint="Local time.">
        {(control) => <DateTimeInput {...control} value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <dl className="fact-list">
        <div>
          <dt>Value</dt>
          <dd className="font-mono">{value || '""'}</dd>
        </div>
        <div>
          <dt>formatDateTime</dt>
          <dd className="font-mono">{value ? formatDateTime(value) : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

export const Default: Story = { render: () => <Demo /> }

export const Required: Story = {
  render: () => (
    <div className="max-w-md">
      <Field label="Orders close at" required error="Choose a date and a time.">
        {(control) => <DateTimeInput {...control} />}
      </Field>
    </div>
  ),
}
