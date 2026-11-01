import { Fragment } from 'react'
import { Drawer } from '@operai/ui'
import { strings } from '../strings'

interface Props {
  onClose: () => void
}

/**
 * The model reference: formulas, the calculation chain and the glossary, in
 * the library Drawer (focus, Escape, backdrop and scroll lock come from it).
 */
export default function HelpDrawer({ onClose }: Props) {
  const t = strings.help
  const sections = [t.chain, t.ai, t.confidence]

  return (
    <Drawer title={t.title} description={t.subtitle} closeLabel={t.close} onClose={onClose} testIdPrefix="help-drawer">
      <div className="space-y-6">
        {sections.map((section) => (
          <Fragment key={section.heading}>
            <section>
              <h3 className="font-disp text-xs font-bold text-text mb-4">{section.heading}</h3>
              <div className="flex flex-col gap-3">
                {section.rows.map((row) => (
                  <div key={row.term} className="leading-relaxed">
                    <strong className="text-text">{row.term}</strong> {row.formula}
                  </div>
                ))}
                <div className="pl-3 py-1.5 border-l-2 border-acc/40 bg-acc/7 rounded-r text-2xs text-soft leading-relaxed">
                  {section.note}
                </div>
              </div>
            </section>
            <div className="border-t border-rule" />
          </Fragment>
        ))}

        <section>
          <h3 className="font-disp text-xs font-bold text-text mb-4">{t.glossary.heading}</h3>
          <div className="flex flex-col gap-3">
            {t.glossary.entries.map(({ term, definition }) => (
              <div key={term} className="flex gap-3">
                <code className="text-acc-hi font-mono shrink-0 w-20 text-2xs leading-relaxed">{term}</code>
                <span className="text-soft text-2xs leading-relaxed">{definition}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Drawer>
  )
}
