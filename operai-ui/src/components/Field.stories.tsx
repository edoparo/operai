import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field } from './Field'

/**
 * Label + control + hint + error, wired together: the label points at the
 * control, the hint and the error describe it, an error marks it
 * `aria-invalid`. Label above, hint and error under the control. Required
 * fields get a `*` (hidden from screen readers) and `aria-required`; never
 * write "(required)" or "(optional)" in a label. Spread the control props on
 * an input, select or textarea.
 */
const meta = {
  title: 'Components/Forms/Field',
  component: Field,
  tags: ['autodocs'],
  args: {
    label: 'Name',
    hint: 'As customers will see it.',
    error: '',
    required: false,
    children: (control) => <input {...control} defaultValue="Oak desk lamp" />,
  },
  argTypes: {
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    children: { control: false },
  },
} satisfies Meta<typeof Field>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const WithHint: Story = {
  name: 'With a hint',
  args: { error: undefined },
}

/** The error replaces nothing: the hint stays, and both describe the control. */
export const WithError: Story = {
  name: 'With an error',
  args: {
    error: 'Use at most 60 characters.',
    children: (control) => <input {...control} defaultValue={'x'.repeat(64)} />,
  },
}

export const Required: Story = {
  args: { required: true, hint: undefined, children: (control) => <input {...control} /> },
}

/** A fixed `id` when something else must address the control (a combobox's listbox, an external label). */
export const FixedId: Story = {
  name: 'Fixed id',
  args: {
    id: 'item-code',
    label: 'Code',
    hint: 'The control’s id is “item-code”.',
    children: (control) => <input {...control} className="font-mono" defaultValue="CAT-0104" />,
  },
}

/** Every native control: input, select, textarea, and a checkbox with its own label. */
export const Controls: Story = {
  name: 'Every control',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Field label="Name" required>
        {(control) => <input {...control} />}
      </Field>
      <Field label="Category" hint="Where the item is listed.">
        {(control) => (
          <select {...control} defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option>Furniture</option>
            <option>Lighting</option>
            <option>Stationery</option>
          </select>
        )}
      </Field>
      <Field label="Description">{(control) => <textarea {...control} rows={3} />}</Field>
      <Field label="Search" hint="Name or code">
        {(control) => <input {...control} type="search" />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" defaultChecked /> Show archived items
      </label>
    </div>
  ),
}

function BlurValidationDemo() {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)
  const error = touched && value.trim() === '' ? 'Enter a name.' : undefined
  return (
    <div className="flex max-w-md flex-col gap-2">
      <Field label="Name" required error={error}>
        {(control) => (
          <input
            {...control}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>
      <p className="text-xs text-soft">Focus the field, leave it empty and press Tab: the error appears on blur.</p>
    </div>
  )
}

export const ValidateOnBlur: Story = {
  name: 'Validate on blur',
  parameters: { controls: { disable: true } },
  render: () => <BlurValidationDemo />,
}

/** A bare control (a toolbar filter) is compact; inside a Field it is the form size. */
export const Sizes: Story = {
  name: 'Form size vs compact',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Field label="In a Field: form size">{(control) => <input {...control} defaultValue="14px" />}</Field>
      <label className="flex flex-col gap-1 text-xs text-soft">
        Bare: compact
        <input defaultValue="12px" />
      </label>
    </div>
  ),
}
