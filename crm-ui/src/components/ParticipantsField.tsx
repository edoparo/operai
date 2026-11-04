import { Button, Icon } from '@operai/ui'
import { strings } from '../strings'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'

/** The server's cap on an activity's participants (specs/017 US-8). */
const MAX_PARTICIPANTS = 10

/**
 * ParticipantsField — the wellD colleagues who took part in an activity
 * (specs/017 US-8): a picker that adds a person, and the chosen people, each
 * removable. Contacts of the client are not participants.
 */
export default function ParticipantsField({
  value,
  onChange,
  error,
  testId,
}: {
  value: readonly PersonChoice[]
  onChange: (next: PersonChoice[]) => void
  error?: string | undefined
  testId: string
}) {
  const t = strings.activities.form
  const full = value.length >= MAX_PARTICIPANTS
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <PersonPicker
        appId="crm"
        label={t.participants}
        value={null}
        onChange={(next) => {
          if (next && !full && !value.some((person) => person.id === next.id)) onChange([...value, next])
        }}
        error={full ? t.participantsMax : error}
        exclude={value.map((person) => person.id)}
        clearOnSelect
        testId={`${testId}-picker`}
      />
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={t.participants}>
          {value.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-1 rounded-md border border-rule bg-ink-soft py-0.5 pr-0.5 pl-2 text-sm text-text"
            >
              {person.label}
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                aria-label={t.removeParticipant(person.label)}
                onClick={() => onChange(value.filter((other) => other.id !== person.id))}
                data-testid={`${testId}-remove-${person.id}`}
              >
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
