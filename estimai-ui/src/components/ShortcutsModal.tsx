import type { ReactNode } from 'react'
import { Dialog, Icon } from '@operai/ui'
import { strings } from '../strings'

interface Props {
  onClose: () => void
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.6rem] px-1.5 py-0.5 rounded border border-rule bg-ink-mid font-mono text-2xs text-text leading-none">
      {children}
    </kbd>
  )
}

function Row({ keys, label }: { keys: ReactNode[]; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 w-40 shrink-0 flex-wrap">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-soft text-2xs" aria-hidden="true">
                /
              </span>
            )}
            <Kbd>{k}</Kbd>
          </span>
        ))}
      </div>
      <span className="text-xs text-soft">{label}</span>
    </div>
  )
}

/**
 * Keyboard shortcuts reference — on @operai/ui's `Dialog` (modal, labelled,
 * Escape/backdrop/× close, focus trapped and returned to the trigger). Arrow
 * keys are `Icon`s with an accessible name (INC-31), never arrow glyphs.
 */
export default function ShortcutsModal({ onClose }: Props) {
  const t = strings.shortcuts
  const k = t.keys
  const arrow = (name: 'chevron-up' | 'chevron-down' | 'chevron-left' | 'chevron-right', label: string) => (
    <Icon name={name} label={label} />
  )
  const withShift = (key: string) => `${k.shift} ${key}`

  return (
    <Dialog title={t.title} size="sm" onClose={onClose} closeLabel={t.close} testIdPrefix="shortcuts">
      <div className="dialog-body flex flex-col gap-4">
        <section>
          <h3 className="text-2xs font-mono uppercase tracking-widest text-soft mb-2">{t.gridHeading}</h3>
          <div className="flex flex-col gap-2">
            <Row keys={[k.tab, withShift(k.tab)]} label={t.rows.nextPrevCell} />
            <Row keys={[k.enter, arrow('chevron-down', k.down)]} label={t.rows.down} />
            <Row keys={[arrow('chevron-up', k.up)]} label={t.rows.up} />
            <Row keys={[arrow('chevron-right', k.right), arrow('chevron-left', k.left)]} label={t.rows.sideways} />
          </div>
        </section>

        <div className="border-t border-rule" />

        <section>
          <h3 className="text-2xs font-mono uppercase tracking-widest text-soft mb-2">{t.generalHeading}</h3>
          <div className="flex flex-col gap-2">
            <Row keys={[withShift('?')]} label={t.rows.togglePanel} />
            <Row keys={[withShift('H')]} label={t.rows.toggleHealth} />
            <Row keys={[withShift('N')]} label={t.rows.newActivity} />
            <Row keys={[k.esc]} label={t.rows.closePanel} />
          </div>
        </section>
      </div>
    </Dialog>
  )
}
