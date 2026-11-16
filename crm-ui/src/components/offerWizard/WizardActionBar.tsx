import { Button, Icon, ProgressBar, VisuallyHidden } from '@operai/ui'
import { ACTION_BAR_ATTRIBUTE } from '../../hooks/useFitToScrollport'
import { strings } from '../../strings'
import GenerateControl from './GenerateControl'

const t = strings.offerWizard.bar

export interface WizardActionBarProps {
  /** 1-based position of the current step and how many there are. */
  position: number
  total: number
  stepName: string
  onBack: () => void
  /** Absent on the last step. */
  onNext?: () => void
  /** The last step of a deal: Generate takes the place of Next. */
  showGenerate: boolean
  onGenerate?: () => void
  generating?: boolean
  missing: number
  invalid: number
  /** A reason beyond the answers (no ready estimate, a read-only draft); blocks Generate and is spoken with it. */
  blockedReason?: string
  /** Narrow screens: opens the preview in a drawer. Absent = no button. */
  onOpenPreview?: () => void
}

/**
 * The sticky bar under the step panel (design S1): Back, where the person is with a determinate bar, Preview
 * (narrow only) and Next — on the last step Generate. Generate is `aria-disabled`, never `disabled`, while
 * anything is missing or invalid, so the person can reach it to hear why; the click is ignored (AC-3.5).
 */
export default function WizardActionBar({
  position,
  total,
  stepName,
  onBack,
  onNext,
  showGenerate,
  onGenerate,
  generating = false,
  missing,
  invalid,
  blockedReason,
  onOpenPreview,
}: WizardActionBarProps) {
  return (
    <div
      className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center gap-3 border-t border-rule bg-ink-soft px-4 pb-3 pt-3"
      data-testid="offer-wizard-action-bar"
      {...{ [ACTION_BAR_ATTRIBUTE]: '' }}
    >
      <Button variant="secondary" onClick={onBack} disabled={position <= 1 || generating}>
        <Icon name="arrow-left" /> {t.back}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none sm:basis-64">
        <span className="text-xs text-soft">{t.stepOf(position, total, stepName)}</span>
        <ProgressBar label={t.progress} value={position} max={total} />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {onOpenPreview ? (
          <Button variant="secondary" aria-haspopup="dialog" onClick={onOpenPreview} className="xl:hidden">
            {t.preview}
          </Button>
        ) : null}
        {showGenerate ? (
          <>
            <GenerateControl
              {...(onGenerate ? { onGenerate } : {})}
              generating={generating}
              missing={missing}
              invalid={invalid}
              {...(blockedReason !== undefined ? { blockedReason } : {})}
              className="flex flex-wrap items-center gap-3"
            />
            <VisuallyHidden live>{generating ? t.generatingLive : ''}</VisuallyHidden>
          </>
        ) : onNext ? (
          <Button variant="primary" onClick={onNext} disabled={generating}>
            {t.next} <Icon name="arrow-right" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
