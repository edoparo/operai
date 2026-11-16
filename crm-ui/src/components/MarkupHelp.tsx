import { strings } from '../strings'

const rows = (items: readonly (readonly [string, string])[]) => (
  <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-xs">
    {items.map(([code, meaning]) => (
      <div key={code} className="contents">
        <dt className="font-mono text-text">{code}</dt>
        <dd className="text-soft">{meaning}</dd>
      </div>
    ))}
  </dl>
)

/**
 * The reference of the wizard template's text (specs/20261115-crm-offer-wizard AC-8.1): the offer markup of the
 * classic templates plus fields, conditions, sections, the cost table and the declarations. Plain content — the
 * editor shows it in a drawer; it is never a form.
 */
export function WizardMarkupReference() {
  const t = strings.templates.markup
  return (
    // focusable: the drawer's body scrolls and this is plain text, so it is the keyboard's way to scroll it (QE D17)
    <div
      role="region"
      aria-label={t.wizard.summary}
      tabIndex={0}
      className="flex flex-col gap-4"
      data-testid="crm-wizard-markup-reference"
    >
      <p className="text-xs text-soft">{t.wizard.intro}</p>
      <section className="flex flex-col gap-2">
        <h3 className="font-disp text-sm text-text">{t.summary}</h3>
        {rows(t.rows)}
      </section>
      {t.wizard.groups.map((group) => (
        <section key={group.title} className="flex flex-col gap-2">
          <h3 className="font-disp text-sm text-text">{group.title}</h3>
          {rows(group.rows)}
        </section>
      ))}
    </div>
  )
}

/**
 * MarkupHelp — the collapsible formatting and placeholder reference beside the text fields (specs/20261102-crm-offer-document AC-1.6).
 * `placeholders={false}` leaves out the legacy `{…}` placeholders (a wizard text has none); `note` is one more line of advice.
 */
export default function MarkupHelp({ placeholders = true, note }: { placeholders?: boolean; note?: string } = {}) {
  const t = strings.templates.markup
  return (
    <details className="rounded-md border border-rule p-3" data-testid="crm-markup-help">
      <summary className="cursor-pointer text-sm text-text">{t.summary}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-xs text-soft">{t.intro}</p>
        {rows(t.rows)}
        {note ? <p className="text-xs text-soft">{note}</p> : null}
        {placeholders ? (
          <>
            <h4 className="text-xs text-soft">{t.placeholders}</h4>
            {rows(t.placeholderRows)}
          </>
        ) : null}
      </div>
    </details>
  )
}
