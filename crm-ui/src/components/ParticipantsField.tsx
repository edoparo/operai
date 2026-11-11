import { useRef } from 'react'
import { PersonChips } from '@operai/ui'
import { strings } from '../strings'
import PersonPicker from './PersonPicker'
import type { PersonChoice } from './PersonPicker'

/** The server's cap on an activity's participants (specs/017 US-8). */
const MAX_PARTICIPANTS = 10

/**
 * ParticipantsField — the wellD colleagues who took part in an activity
 * (specs/017 US-8): a picker that adds a person, and the chosen people, each
 * removable (the library's `PersonChips`). Contacts of the client are not participants.
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
  const root = useRef<HTMLDivElement>(null)
  return (
    <div ref={root} className="flex flex-col gap-2" data-testid={testId}>
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
      <PersonChips
        label={t.participants}
        people={value}
        removeLabel={t.removeParticipant}
        focusAfterRemove={() => root.current?.querySelector('input') ?? null}
        onRemove={(id) => onChange(value.filter((other) => other.id !== id))}
        testId={testId}
      />
    </div>
  )
}
