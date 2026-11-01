import { Badge } from '@operai/ui'
import { strings } from '../strings'

/**
 * ConditionChip — one condition attached to a permission rule (T15,
 * specs/004-auth-roles-permissions, design.md Screen A2): the ownership chip
 * (`own`/`any`) plus one chip per attribute (`entity`/`department`/`jobTitle`).
 *
 * `kind` mirrors the plan's `conditions` JSON shape verbatim (plan.md §Data
 * model), so there is no translation layer between the API contract and the UI.
 *
 * `self-approval` (T4, specs/010-self-approval-control, ADR-0026) is the
 * `{key:"self-approval", match:"deny"}` attribute — a deny carve-out on
 * `request:approve`. It always renders as its OWN chip, never merged with the
 * entity chip (AC-1.4).
 *
 * A condition is metadata, not a status (INC-23): a neutral library `Badge`
 * with its label from `strings.badges.condition`, no glyph.
 */
export type ConditionChipKind = 'own' | 'any' | 'entity' | 'department' | 'jobTitle' | 'self-approval'

export type ConditionChipProps = {
  kind: ConditionChipKind
}

export default function ConditionChip({ kind }: ConditionChipProps) {
  return <Badge data-testid={`condition-chip-${kind}`}>{strings.badges.condition[kind]}</Badge>
}
