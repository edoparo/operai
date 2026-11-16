import { Fragment, type ReactNode } from 'react'
import { VisuallyHidden } from '@operai/ui'
import { strings } from '../../strings'

import { splitMarked } from './splitMarked'

const t = strings.offerWizard

/** Visible word + brackets + highlight, with a hidden "Missing:" prefix: never colour alone (design § Accessibility). */
export function MissingRun({ label, surface }: { label: string; surface: 'paper' | 'form' }) {
  return (
    <mark
      className={
        surface === 'paper'
          ? 'rounded-sm bg-paper-mark px-1 text-paper-mark-ink'
          : 'rounded-sm bg-org/10 px-1 text-text'
      }
    >
      <VisuallyHidden>{t.preview.missing} </VisuallyHidden>
      {`⟦${label}⟧`}
    </mark>
  )
}

export function PendingRun({ label, surface }: { label: string; surface: 'paper' | 'form' }) {
  return (
    <span
      className={
        surface === 'paper'
          ? 'rounded-sm border border-dashed border-paper-soft px-1 text-paper-soft'
          : 'rounded-sm border border-dashed border-rule px-1 text-soft'
      }
      title={label}
    >
      {t.preview.pending}
    </span>
  )
}

/** A plain-surface string as React nodes: its text as text, its markers as marked runs. */
export function MarkedText({ text, surface = 'form' }: { text: string; surface?: 'paper' | 'form' }): ReactNode {
  return (
    <>
      {splitMarked(text).map((piece, index) => (
        <Fragment key={index}>
          {piece.kind === 'text' ? (
            piece.text
          ) : piece.kind === 'missing' ? (
            <MissingRun label={piece.label} surface={surface} />
          ) : (
            <PendingRun label={piece.label} surface={surface} />
          )}
        </Fragment>
      ))}
    </>
  )
}
