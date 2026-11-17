/**
 * An axe run for the form's tests (task T21; tests only): the rules that need a real browser (colour
 * contrast needs computed colours and layout) and the page-level ones a component fragment cannot satisfy
 * (landmarks) are off; everything else, including labels, names, roles, ARIA and heading order, is on.
 * Returns the violations as `rule: first target` lines, so a failure says what and where.
 */
import axe from 'axe-core'

export async function axeViolations(container: Element): Promise<string[]> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes[0]?.target.join(' ')} (${violation.help})`,
  )
}
