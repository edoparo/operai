import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field } from './Field'
import { DateInput } from './MoneyInput'
import { formatDate, formatDateLong } from '../lib/format'

/**
 * A calendar date: the native date picker, whose colour scheme follows the
 * theme, value `YYYY-MM-DD` (ISO 8601, as the APIs expect), figures in DM
 * Mono. Display the value with `formatDate` (dd.mm.yyyy). Never set
 * `colorScheme` on it.
 */
const meta = {
  title: 'Components/Forms/DateInput',
  component: DateInput,
  tags: ['autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof DateInput>
export default meta

type Story = StoryObj<typeof meta>

function Demo() {
  const [value, setValue] = useState('2026-11-15')
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Field label="Available from" hint="The first day the item can be ordered.">
        {(control) => <DateInput {...control} value={value} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <dl className="fact-list">
        <div>
          <dt>Value</dt>
          <dd className="font-mono">{value || '""'}</dd>
        </div>
        <div>
          <dt>formatDate</dt>
          <dd className="font-mono">{value ? formatDate(value) : '—'}</dd>
        </div>
        <div>
          <dt>formatDateLong</dt>
          <dd>{value ? formatDateLong(value, 'en') : '—'}</dd>
        </div>
      </dl>
    </div>
  )
}

export const Default: Story = { render: () => <Demo /> }

export const WithError: Story = {
  name: 'With an error',
  render: () => (
    <div className="max-w-md">
      <Field label="Available from" required error="Choose a date on or after today.">
        {(control) => <DateInput {...control} defaultValue="2020-01-01" />}
      </Field>
    </div>
  ),
}

export const WithBounds: Story = {
  name: 'With min and max',
  render: () => (
    <div className="max-w-md">
      <Field label="Delivery date" hint="Between 01.11.2026 and 31.12.2026.">
        {(control) => <DateInput {...control} min="2026-11-01" max="2026-12-31" defaultValue="2026-11-20" />}
      </Field>
    </div>
  ),
}
