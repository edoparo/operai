import { useId } from 'react'
import { Button } from '@operai/ui'
import { strings } from '../../strings'

const t = strings.offerWizard.bar

/** What Generate needs, owned by the wizard frame and given to every place that offers it (the bar, the Preview card). */
export interface GenerateState {
  onGenerate?: () => void
  generating: boolean
  missing: number
  invalid: number
  /** A reason beyond the answers (no ready estimate, a read-only draft); blocks Generate and is spoken with it. */
  blockedReason?: string
}

/**
 * The Generate button with the reason it is blocked, in one place so the action bar and the Preview step's issues
 * card cannot disagree (design S7.1; AC-3.5). Blocked is `aria-disabled`, never `disabled`, so the person can reach
 * the button to hear why; the click is ignored.
 */
export default function GenerateControl({
  onGenerate,
  generating,
  missing,
  invalid,
  blockedReason,
  className,
  testId,
  reasonShownAbove = false,
}: GenerateState & {
  className?: string
  testId?: string
  /** The card already says the reason in words just above: it stays here only for the button's description. */
  reasonShownAbove?: boolean
}) {
  const reasonId = useId()
  const blocked = missing + invalid > 0 || blockedReason !== undefined
  return (
    <div className={className} data-testid={testId}>
      {blocked ? (
        <span id={reasonId} className={reasonShownAbove ? 'sr-only' : 'text-xs text-soft'}>
          {missing + invalid > 0 ? <span>{t.counts(missing, invalid)}</span> : null}
          {blockedReason ? <span className="block">{blockedReason}</span> : null}
        </span>
      ) : null}
      <Button
        variant="primary"
        busy={generating}
        aria-disabled={blocked ? true : undefined}
        aria-describedby={blocked ? reasonId : undefined}
        onClick={blocked ? undefined : onGenerate}
      >
        {generating ? t.generating : t.generate}
      </Button>
    </div>
  )
}
