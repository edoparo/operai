import { strings } from '../strings'

/** MarkupHelp — the collapsible formatting and placeholder reference beside the text fields (specs/20261102-crm-offer-document AC-1.6). */
export default function MarkupHelp() {
  const t = strings.templates.markup
  const rows = (items: readonly [string, string][]) => (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-xs">
      {items.map(([code, meaning]) => (
        <div key={code} className="contents">
          <dt className="font-mono text-text">{code}</dt>
          <dd className="text-soft">{meaning}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <details className="rounded-md border border-rule p-3" data-testid="crm-markup-help">
      <summary className="cursor-pointer text-sm text-text">{t.summary}</summary>
      <div className="mt-2 flex flex-col gap-3">
        <p className="text-xs text-soft">{t.intro}</p>
        {rows(t.rows)}
        <h4 className="text-xs text-soft">{t.placeholders}</h4>
        {rows(t.placeholderRows)}
      </div>
    </details>
  )
}
