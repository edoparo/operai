import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RadioGroupField } from './Field'

/**
 * A group of radios with the same label, hint, required and error wiring as
 * `Field`: a `radiogroup` labelled by its label, described by the hint and
 * the error, `aria-invalid` when the error is set. Each radio is a plain
 * `<label><input type="radio" /> …</label>`, drawn by tokens.css.
 */
const meta = {
  title: 'Components/Forms/RadioGroupField',
  component: RadioGroupField,
  tags: ['autodocs'],
  args: { label: 'Who can see it', hint: '', error: '', required: false, children: null },
  argTypes: {
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    children: { control: false },
  },
} satisfies Meta<typeof RadioGroupField>
export default meta

type Story = StoryObj<typeof meta>

function Options({ initial }: { initial?: string }) {
  const name = useId()
  const [value, setValue] = useState(initial ?? '')
  return (
    <>
      {[
        ['public', 'Everyone'],
        ['team', 'Only my team'],
        ['private', 'Only me'],
      ].map(([id, text]) => (
        <label key={id} className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} value={id} checked={value === id} onChange={() => setValue(id)} />
          {text}
        </label>
      ))}
    </>
  )
}

export const Playground: Story = {
  render: (args) => (
    <RadioGroupField {...args}>
      <Options initial="public" />
    </RadioGroupField>
  ),
}

export const WithHint: Story = {
  name: 'With a hint',
  render: () => (
    <RadioGroupField label="Who can see it" hint="You can change this later.">
      <Options initial="team" />
    </RadioGroupField>
  ),
}

/** Required and unanswered after a submit: the error describes the group; focusFirstInvalid lands on its first radio. */
export const RequiredWithError: Story = {
  name: 'Required, with an error',
  render: () => (
    <RadioGroupField label="Who can see it" required error="Choose who can see it.">
      <Options />
    </RadioGroupField>
  ),
}
