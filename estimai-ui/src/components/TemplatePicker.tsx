import { TEMPLATES } from '../lib/templates'
import type { Template } from '../lib/templates'
import { Button, Icon } from '@operai/ui'
import { strings } from '../strings'

interface Props {
  onSelect: (t: Template) => void
  onBlank: () => void
}

function epicCount(t: Template): number {
  return new Set(t.activities.map((a) => a.epic)).size
}

/**
 * The starting point of an empty estimate. Template names and descriptions
 * are template data (lib/templates.ts), shown as written; the picker's own
 * copy comes from strings.activities.templates.
 */
export default function TemplatePicker({ onSelect, onBlank }: Props) {
  const t = strings.activities.templates
  return (
    <div className="flex flex-col items-center px-5.5 py-12 gap-8">
      <div className="text-center">
        <p className="text-soft text-sm">{t.intro}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl">
        {TEMPLATES.map((tpl) => (
          // A selectable card, not a button visually: kept as a plain <button>
          // (the brief's exception) with the global focus ring.
          <button
            key={tpl.id}
            type="button"
            onClick={() => onSelect(tpl)}
            className="group text-left flex flex-col gap-3 p-5 border border-rule bg-ink-soft rounded-md
              hover:border-acc/50 hover:bg-ink-mid transition-colors"
          >
            <span className="font-medium text-sm text-text">{tpl.name}</span>

            <p className="text-xs text-soft leading-relaxed flex-1">{tpl.description}</p>

            <div className="flex items-center gap-3 text-2xs font-mono text-soft">
              <span>{t.activities(tpl.activities.length)}</span>
              <span className="w-px h-3 bg-rule" />
              <span>{t.epics(epicCount(tpl))}</span>
            </div>

            <span className="inline-flex items-center gap-1 text-2xs font-medium text-acc-text opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
              {t.useTemplate}
              <Icon name="arrow-right" />
            </span>
          </button>
        ))}
      </div>

      <Button variant="ghost" onClick={onBlank}>
        {t.blank}
      </Button>
    </div>
  )
}
