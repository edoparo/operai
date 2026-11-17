import { Banner, buttonClassName } from '@operai/ui'
import { usePermissions } from 'shell/session'
import type { Entity } from '../../lib/types'
import { strings } from '../../strings'

const t = strings.offerWizard.letterhead

/** The configurator on the shell's path, opened on the entity (design F13). A plain link: Letterheads is another tool. */
const letterheadsHref = (entity: Entity): string => `/letterheads?entity=${encodeURIComponent(entity)}`

/** Whether the person may open Letterheads at all: UX only, the service's own 403 is the gate. */
function useCanOpenLetterheads(): boolean {
  return usePermissions().apps.includes('letterheads')
}

export type LetterheadNoticeProps = { entity: Entity; className?: string } & (
  | {
      /** 409 `letterhead_not_configured`: the entity has no active letterhead (AC-10.8). */
      problem: 'notConfigured'
      /** The pane's polite warning, or the Generate refusal (`danger`, announced at once, with its own sentence). */
      where: 'preview' | 'generate'
    }
  | {
      /** 409 `letterhead_overflow`: a profile value is too long for the header or the footer (T27, AC-5.3). */
      problem: 'overflow'
      frame: 'header' | 'footer'
    }
)

/**
 * The letterhead notice (design F13, S9; AC-10.7, AC-10.8): one rule in two places, the preview pane and the Generate error.
 * The action **Open Letterheads** exists only for a holder of access to Letterheads; everyone else is told to ask an
 * administrator and sees no link. Never a dialog; in the pane it is a polite status, announced once.
 */
export default function LetterheadNotice(props: LetterheadNoticeProps) {
  const { entity, className } = props
  const canOpen = useCanOpenLetterheads()
  const label = strings.badges.entity[entity]
  const open = canOpen ? (
    <a href={letterheadsHref(entity)} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
      {t.open}
    </a>
  ) : undefined

  if (props.problem === 'overflow') {
    return (
      <Banner
        tone="warning"
        live="polite"
        title={t.overflow.title(label, t.overflow[props.frame])}
        actions={open}
        {...(className ? { className } : {})}
        data-testid="crm-wizard-letterhead-overflow"
      >
        {canOpen ? t.overflow.body : t.overflow.bodyAskAdmin}
      </Banner>
    )
  }

  const generating = props.where === 'generate'
  return (
    <Banner
      tone={generating ? 'danger' : 'warning'}
      {...(generating ? {} : { live: 'polite' as const })}
      title={t.notConfigured.title(label)}
      actions={open}
      {...(className ? { className } : {})}
      data-testid="crm-wizard-letterhead-not-configured"
    >
      {generating ? t.notConfigured.generate : t.notConfigured.preview}
      {canOpen ? null : ` ${t.askAdmin}`}
    </Banner>
  )
}
