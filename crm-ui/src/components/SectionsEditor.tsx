import { Button, Field, Icon } from '@operai/ui'
import { LIMITS, blankSection, checkSections } from '../lib/offerRules'
import type { SectionsCheck } from '../lib/offerRules'
import type { OfferSection } from '../lib/types'
import { strings } from '../strings'

/**
 * SectionsEditor — the ordered list of headed sections of an offer template or
 * of an offer being prepared (specs/020 AC-3.3): heading, text, the ONE section
 * that carries the cost table, move up/down, remove, add. One component for the
 * template page and the generate dialog; it is controlled and shows the errors
 * it is given (`check`, from `checkSections`) once the page has validated.
 */
export default function SectionsEditor({
  sections,
  onChange,
  check,
  disabled = false,
  testIdPrefix,
}: {
  sections: OfferSection[]
  onChange: (sections: OfferSection[]) => void
  /** Shown after a validation; `undefined` before. */
  check?: SectionsCheck
  disabled?: boolean
  testIdPrefix: string
}) {
  const t = strings.templates.sections
  const shown = check ?? checkSections([])
  const update = (index: number, patch: Partial<OfferSection>) =>
    onChange(sections.map((section, at) => (at === index ? { ...section, ...patch } : section)))
  const move = (from: number, to: number) => {
    const next = [...sections]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next)
  }
  const listError =
    check?.list === 'count'
      ? t.errors.count(LIMITS.sections.min, LIMITS.sections.max)
      : check?.list === 'costsSection'
        ? t.errors.costsSection
        : null
  const issueText = (issue: SectionsCheck['items'][number]) =>
    issue === 'headingRequired'
      ? t.errors.headingRequired
      : issue === 'headingTooLong'
        ? t.errors.headingTooLong(LIMITS.heading)
        : issue === 'bodyTooLong'
          ? t.errors.bodyTooLong(LIMITS.body)
          : undefined

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled} data-testid={`${testIdPrefix}-sections`}>
      <legend className="field-label">{t.legend}</legend>
      <p className="text-xs text-soft">{t.hint(LIMITS.sections.min, LIMITS.sections.max)}</p>
      {listError && (
        <p className="form-error" role="alert" data-testid={`${testIdPrefix}-sections-error`}>
          {listError}
        </p>
      )}
      {sections.map((section, index) => {
        const issue = shown.items[index] ?? null
        const n = index + 1
        return (
          <div
            key={index}
            className="flex flex-col gap-2 rounded-md border border-rule p-3"
            data-testid={`${testIdPrefix}-section-${index}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-soft">{t.item(n)}</span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={t.moveUp(n)}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  data-testid={`${testIdPrefix}-section-${index}-up`}
                >
                  <Icon name="arrow-up" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={t.moveDown(n)}
                  disabled={index === sections.length - 1}
                  onClick={() => move(index, index + 1)}
                  data-testid={`${testIdPrefix}-section-${index}-down`}
                >
                  <Icon name="arrow-down" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  aria-label={t.remove(n)}
                  disabled={sections.length <= LIMITS.sections.min}
                  onClick={() => onChange(sections.filter((_, at) => at !== index))}
                  data-testid={`${testIdPrefix}-section-${index}-remove`}
                >
                  <Icon name="trash" />
                </Button>
              </span>
            </div>
            <Field
              label={`${t.heading} (${n})`}
              required
              error={issue === 'headingRequired' || issue === 'headingTooLong' ? issueText(issue) : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  value={section.heading}
                  onChange={(event) => update(index, { heading: event.target.value })}
                />
              )}
            </Field>
            <Field label={`${t.body} (${n})`} error={issue === 'bodyTooLong' ? issueText(issue) : undefined}>
              {(control) => (
                <textarea
                  {...control}
                  rows={5}
                  value={section.body}
                  onChange={(event) => update(index, { body: event.target.value })}
                />
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="radio"
                name={`${testIdPrefix}-costs-section`}
                checked={section.costs}
                onChange={() => onChange(sections.map((item, at) => ({ ...item, costs: at === index })))}
                data-testid={`${testIdPrefix}-section-${index}-costs`}
              />
              {t.costs}
            </label>
          </div>
        )
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={sections.length >= LIMITS.sections.max}
          onClick={() => onChange([...sections, blankSection()])}
          data-testid={`${testIdPrefix}-section-add`}
        >
          {t.add}
        </Button>
      </div>
    </fieldset>
  )
}
