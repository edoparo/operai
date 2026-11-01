import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field } from './Field'
import { MoneyInput, parseDecimal } from './MoneyInput'
import { formatMoney } from '../lib/format'

/**
 * An amount field: a text input with the decimal keypad (never
 * `type="number"`, which rejects the comma the suite displays and silently
 * rounds), figures in DM Mono. The value stays the typed text; parse it with
 * `parseDecimal(text, decimals)` into integer minor units — exactly, never
 * through a float. `null` means "not a valid amount yet", never 0. Put it in a
 * `Field` and spread the control props.
 */
const meta = {
  title: 'Components/Forms/MoneyInput',
  component: MoneyInput,
  tags: ['autodocs'],
  parameters: { controls: { disable: true } },
} satisfies Meta<typeof MoneyInput>
export default meta

type Story = StoryObj<typeof meta>

function LiveParse({
  decimals,
  initial,
  label,
  hint,
}: {
  decimals: number
  initial: string
  label: string
  hint: string
}) {
  const [text, setText] = useState(initial)
  const minor = parseDecimal(text, decimals)
  const error = text.trim() !== '' && minor === null ? `Enter an amount with at most ${decimals} decimals.` : undefined
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Field label={label} hint={hint} error={error}>
        {(control) => <MoneyInput {...control} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <dl className="fact-list">
        <div>
          <dt>Typed text</dt>
          <dd className="font-mono">“{text}”</dd>
        </div>
        <div>
          <dt>parseDecimal(text, {decimals})</dt>
          <dd className="font-mono">{minor === null ? 'null' : String(minor)}</dd>
        </div>
        {decimals === 2 && (
          <div>
            <dt>formatMoney(…, &apos;EUR&apos;)</dt>
            <dd className="font-mono">{minor === null ? '—' : formatMoney(minor, 'EUR', 'en')}</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

/** Type `45,5`, `1299`, `1.15` or `12.345`: the parsed cents update live. */
export const Cents: Story = {
  name: 'Live parse to cents',
  render: () => <LiveParse decimals={2} initial="45,50" label="Price" hint="In euros, e.g. 45.50 or 45,50." />,
}

/** With 6 decimals the result is micros (a per-unit rate). */
export const Micros: Story = {
  name: 'Live parse to micros',
  render: () => <LiveParse decimals={6} initial="0.123456" label="Rate per unit" hint="Up to six decimals." />,
}

export const Required: Story = {
  render: () => (
    <div className="max-w-md">
      <Field label="Price" required error="Enter a price.">
        {(control) => <MoneyInput {...control} />}
      </Field>
    </div>
  ),
}
