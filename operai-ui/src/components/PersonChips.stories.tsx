import { useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PersonChips } from './PersonChips'

/**
 * The people already chosen (participants of an activity or a task), each with a remove button named after the
 * person. It adds nothing: pair it with `PersonPicker clearOnSelect`. Without `onRemove` the chips are read-only;
 * an empty list renders nothing. Check both themes with the Theme toolbar.
 */
const meta = {
  title: 'Components/Forms/PersonChips',
  component: PersonChips,
  tags: ['autodocs'],
  args: {
    label: 'Participants',
    people: [
      { id: 'u1', label: 'Anna Rossi' },
      { id: 'u2', label: 'Bruno Bianchi' },
      { id: 'u3', label: 'Chiara Verdi' },
    ],
    removeLabel: (name: string) => `Remove ${name}`,
  },
} satisfies Meta<typeof PersonChips>
export default meta

type Story = StoryObj<typeof meta>

/** Removing a chip works; the list shrinks. */
export const Removable: Story = {
  render: (args) => {
    const [people, setPeople] = useState(args.people)
    return <PersonChips {...args} people={people} onRemove={(id) => setPeople(people.filter((p) => p.id !== id))} />
  },
}

/** Removing a chip returns focus to the field that adds people (here a plain input), never to the page. */
export const FocusReturnsToPicker: Story = {
  render: (args) => {
    const [people, setPeople] = useState(args.people)
    const input = useRef<HTMLInputElement>(null)
    return (
      <div className="flex flex-col gap-2">
        <input
          ref={input}
          aria-label="Add a participant"
          className="rounded-md border border-rule bg-ink-soft px-2 py-1"
        />
        <PersonChips
          {...args}
          people={people}
          onRemove={(id) => setPeople(people.filter((p) => p.id !== id))}
          focusAfterRemove={() => input.current}
        />
      </div>
    )
  },
}

export const ReadOnly: Story = {}

export const Disabled: Story = { args: { onRemove: () => {}, disabled: true } }

export const LongNames: Story = {
  decorators: [
    (Story) => (
      <div className="w-64 max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    onRemove: () => {},
    people: [
      { id: 'u1', label: 'Maria Alessandra Bianchi-Rossi' },
      { id: 'u2', label: 'Bruno Bianchi' },
    ],
  },
}
