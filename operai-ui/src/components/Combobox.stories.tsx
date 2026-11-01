import { useEffect, useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Combobox } from './Combobox'
import type { ComboboxOption } from './Combobox'
import { Field } from './Field'

/**
 * A text field with suggestions (WAI-ARIA combobox with listbox popup), for
 * picking a person, a supplier, an address or a country by typing. Focus stays
 * in the input; ↓/↑ highlight, Enter picks, Escape closes, Tab leaves WITHOUT
 * picking. The caller owns the text, the options and when the popup is open,
 * so it also decides what an empty result says (loading, no match, an error)
 * and what screen readers hear (`liveRegionText`). Put it in a `Field` and
 * pass the control props as `id`, `ariaInvalid`, `ariaDescribedBy` and
 * `ariaRequired`.
 */
const meta = {
  title: 'Components/Forms/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: { controls: { disable: true }, docs: { story: { inline: false, iframeHeight: 360 } } },
} satisfies Meta<typeof Combobox>
export default meta

type Story = StoryObj

const PEOPLE: ComboboxOption[] = [
  { id: 'u1', label: 'Anna Keller', secondaryLabel: 'anna.keller@example.com' },
  { id: 'u2', label: 'Giulia Bianchi', secondaryLabel: 'giulia.bianchi@example.com' },
  { id: 'u3', label: 'Luca Ferrari', secondaryLabel: 'luca.ferrari@example.com' },
  { id: 'u4', label: 'Marco Rossi', secondaryLabel: 'marco.rossi@example.com' },
  { id: 'u5', label: 'Sara Conti', secondaryLabel: 'sara.conti@example.com' },
  { id: 'u6', label: 'Tom Weber', secondaryLabel: 'tom.weber@example.com' },
]

const matching = (query: string) =>
  PEOPLE.filter((person) => person.label.toLowerCase().includes(query.trim().toLowerCase()))

function PersonPicker({ required = false, error }: { required?: boolean; error?: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<ComboboxOption | null>(null)
  const options = matching(query)
  return (
    <div className="flex max-w-md flex-col gap-3">
      <Field label="Holder" hint="Type a name or pick from the list." required={required} error={error}>
        {(control) => (
          <Combobox
            id={control.id}
            ariaInvalid={control['aria-invalid']}
            ariaDescribedBy={control['aria-describedby']}
            ariaRequired={control['aria-required']}
            value={query}
            onValueChange={(next) => {
              setQuery(next)
              setPicked(null)
              setOpen(true)
            }}
            options={options}
            onSelect={(option) => {
              setPicked(option)
              setQuery(option.label)
            }}
            isOpen={open}
            onOpenChange={setOpen}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            emptyState="No people match."
            liveRegionText={open ? `${options.length} suggestions.` : ''}
          />
        )}
      </Field>
      <p className="text-sm text-soft">Picked: {picked ? picked.label : 'nobody yet'}</p>
    </div>
  )
}

/** Focus the field to see every option, type to filter, use the arrows and Enter. */
export const PickAPerson: Story = {
  name: 'Pick a person',
  render: () => <PersonPicker />,
}

/** Required and invalid, as after a failed save: the red border comes from the Field. */
export const Invalid: Story = {
  render: () => <PersonPicker required error="Choose who receives the item." />,
}

function SlowSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<{ query: string; options: ComboboxOption[] } | null>(null)
  const loading = results?.query !== query
  useEffect(() => {
    const timer = setTimeout(() => setResults({ query, options: matching(query) }), 700)
    return () => clearTimeout(timer)
  }, [query])
  const options = useMemo(() => (loading ? [] : (results?.options ?? [])), [loading, results])
  return (
    <div className="max-w-md">
      <Field label="Holder" hint="Results arrive after a short delay, as from a server.">
        {(control) => (
          <Combobox
            id={control.id}
            ariaDescribedBy={control['aria-describedby']}
            value={query}
            onValueChange={(next) => {
              setQuery(next)
              setOpen(true)
            }}
            options={options}
            onSelect={(option) => setQuery(option.label)}
            isOpen={open}
            onOpenChange={setOpen}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            emptyState={loading ? 'Searching…' : 'No people match.'}
            liveRegionText={open && !loading ? `${options.length} suggestions.` : ''}
            footer={<li className="combobox-footer">Directory of active accounts</li>}
          />
        )}
      </Field>
    </div>
  )
}

/** The empty-state line says why the list is empty; a footer row sits under the options. */
export const LoadingAndFooter: Story = {
  name: 'Loading, empty and footer',
  render: () => <SlowSearch />,
}
