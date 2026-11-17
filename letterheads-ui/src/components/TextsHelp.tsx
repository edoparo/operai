import { Card } from '@operai/ui'
import { useForm } from '../lib/formStateContext'
import { strings } from '../strings'

/**
 * TextsHelp — the help card "Placeholders and special characters" (design § How the frame model is
 * exposed; AC-5.2, 6.1, 6.2, 6.6). A native `details`, collapsed, in a card at the top of the form, outside
 * the disabled fieldset of a read-only form so it can always be opened. It is non-modal on purpose: it can
 * stay open beside the field being edited.
 *
 * The placeholders, the literal-brace table and the numbers come from the catalog, so the page never says
 * something the service does not do. A placeholder the catalog adds later is listed by its name alone. The
 * sample value the preview uses for each placeholder is not in the catalog and is not shown here (the
 * preview, T22, shows the sample document itself).
 */
export function TextsHelp() {
  const { catalog } = useForm()
  const { bounds, placeholders, escapes } = catalog
  const hasPageNumber = placeholders.some((placeholder) => placeholder.perPage)
  return (
    <Card data-testid="letterheads-help">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-text">{strings.help.title}</summary>
        <div className="mt-3 flex flex-col gap-4 text-sm text-text">
          <section className="flex flex-col gap-2">
            <p className="font-semibold">{strings.help.placeholdersLabel}</p>
            <p className="text-soft">{strings.help.placeholders}</p>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
              {placeholders.map((placeholder) => (
                <div key={placeholder.name} className="contents">
                  <dt className="font-mono">{`{${placeholder.name}}`}</dt>
                  <dd>{strings.help.placeholder[placeholder.name] ?? ''}</dd>
                </div>
              ))}
            </dl>
            {hasPageNumber && <p className="text-soft">{strings.help.pageFormat}</p>}
          </section>
          <section className="flex flex-col gap-2">
            <p className="font-semibold">{strings.help.literalLabel}</p>
            <p>{strings.help.literal}</p>
            <table className="w-max text-left">
              <caption className="visually-hidden">{strings.help.literalLabel}</caption>
              <thead>
                <tr className="text-soft">
                  <th scope="col" className="pr-6 font-medium">
                    {strings.help.youType}
                  </th>
                  <th scope="col" className="font-medium">
                    {strings.help.itPrints}
                  </th>
                </tr>
              </thead>
              <tbody>
                {escapes.map((escape) => (
                  <tr key={escape.type}>
                    <td className="pr-6 font-mono">{escape.type}</td>
                    <td className="font-mono">{escape.prints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="flex flex-col gap-2">
            <p className="font-semibold">{strings.help.segmentLabel}</p>
            <p>{strings.help.segment}</p>
          </section>
          <section className="flex flex-col gap-2">
            <p className="font-semibold">{strings.help.fitLabel}</p>
            <p>{strings.help.fit(bounds.fitTestValueChars)}</p>
          </section>
          <section className="flex flex-col gap-2">
            <p className="font-semibold">{strings.help.linesLabel}</p>
            <p>{strings.help.lines(bounds.maxLinesPerZone, bounds.lineSizePt.min, bounds.lineSizePt.max)}</p>
          </section>
        </div>
      </details>
    </Card>
  )
}
