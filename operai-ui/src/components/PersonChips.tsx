import { Button } from './Button'
import { Icon } from './Icon'

export type PersonChipsProps = {
  /** Names the list ("Participants"). */
  label: string
  people: readonly { id: string; label: string }[]
  /** Names a remove button after the person ("Remove Anna Rossi"): copy from the app. */
  removeLabel?: (name: string) => string
  /** Called with the person's id. Omit it (or `removeLabel`) and the chips are read-only. */
  onRemove?: (id: string) => void
  /**
   * Where focus goes once a chip is removed (the picker input that adds people). The removed chip's button
   * leaves the page with the chip, and focus would fall to <body>; the app returns it to the field the person
   * was working in. A `null` result leaves focus alone.
   */
  focusAfterRemove?: () => HTMLElement | null
  disabled?: boolean
  /** Each remove button is `<testId>-remove-<id>`. */
  testId?: string
}

/**
 * PersonChips — the people already chosen for something (participants of an
 * activity or a task), each with a labelled remove button. Pairs with
 * `PersonPicker clearOnSelect`, which adds. Renders nothing for an empty list.
 */
export function PersonChips({
  label,
  people,
  removeLabel,
  onRemove,
  focusAfterRemove,
  disabled = false,
  testId,
}: PersonChipsProps) {
  if (people.length === 0) return null
  const removable = onRemove !== undefined && removeLabel !== undefined
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {people.map((person) => (
        <li
          key={person.id}
          className={`flex items-center gap-1 rounded-md border border-rule bg-ink-soft py-0.5 text-sm text-text ${removable ? 'pr-0.5 pl-2' : 'px-2'}`}
        >
          {person.label}
          {removable && (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              disabled={disabled}
              aria-label={removeLabel(person.label)}
              onClick={() => {
                onRemove(person.id)
                // Before the chip unmounts: moving focus first means it is never lost to <body>.
                focusAfterRemove?.()?.focus()
              }}
              data-testid={testId ? `${testId}-remove-${person.id}` : undefined}
            >
              <Icon name="close" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
