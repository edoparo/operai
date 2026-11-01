import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { CheckboxGroupField } from './Field'
import type { CheckboxGroupFieldProps } from './Field'

/**
 * Pick any number of options from a list — roles, departments, items to link.
 * A `<fieldset>` whose legend names the group (`hideLabel` keeps it for
 * screen readers when a Card title already names it), one labelled checkbox
 * per line, described by the hint and the error, disabled as a whole in
 * flight. `scroll` caps a long list inside a dialog. One yes/no choice is a
 * single checkbox in a `Field`; one choice among several is RadioGroupField.
 */
const meta = {
  title: 'Components/Forms/CheckboxGroupField',
  component: CheckboxGroupField,
  tags: ['autodocs'],
  args: {
    label: 'Shelves',
    hint: '',
    error: '',
    disabled: false,
    scroll: false,
    options: [],
    selected: [],
    onToggle: () => {},
  },
  argTypes: {
    label: { control: 'text' },
    hint: { control: 'text' },
    error: { control: 'text' },
    options: { control: false },
    selected: { control: false },
  },
} satisfies Meta<typeof CheckboxGroupField>
export default meta

type Story = StoryObj<typeof meta>

const SHELVES = [
  { id: 'a', label: 'Shelf A — lamps' },
  { id: 'b', label: 'Shelf B — chairs' },
  { id: 'c', label: 'Shelf C — desks' },
  { id: 'd', label: 'Shelf D — storage' },
  { id: 'e', label: 'Shelf E — returns' },
  { id: 'f', label: 'Shelf F — spare parts' },
]

function Stateful(props: Partial<CheckboxGroupFieldProps>) {
  const [selected, setSelected] = useState<string[]>(['b'])
  return (
    <CheckboxGroupField
      label="Shelves"
      options={SHELVES}
      {...props}
      selected={selected}
      onToggle={(id, checked) => setSelected((s) => (checked ? [...s, id] : s.filter((x) => x !== id)))}
    />
  )
}

export const Playground: Story = {
  render: (args) => <Stateful label={args.label} hint={args.hint} error={args.error} disabled={args.disabled} scroll={args.scroll} />,
}

export const WithHint: Story = {
  name: 'With a hint',
  render: () => <Stateful hint="Items on these shelves are counted every month." />,
}

/** In a dialog: the list scrolls instead of growing the dialog. */
export const Scrolling: Story = {
  render: () => <Stateful scroll />,
}

export const Disabled: Story = {
  name: 'Disabled (in flight)',
  render: () => <Stateful disabled />,
}

export const Empty: Story = {
  render: () => (
    <CheckboxGroupField label="Shelves" options={[]} selected={[]} onToggle={() => {}} emptyState="No shelves yet." />
  ),
}
