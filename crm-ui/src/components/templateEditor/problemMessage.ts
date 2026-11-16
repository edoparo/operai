import type { Problem } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'

/** The message of a problem code in the interface language; `name` is the field, block or column it is about. */
export function problemMessage(problem: Problem): string {
  const message = strings.templates.wizardEditor.problem[problem.code] as (name?: string) => string
  return message(problem.name)
}
