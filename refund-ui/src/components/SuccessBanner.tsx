import { useMemo } from 'react'
import { Banner } from '@operai/ui'
import { strings } from '../strings'

/**
 * SuccessBanner — the confirmation of the person's own action where they acted
 * (INC-19): a compact success `Banner` (`role="status"`), dismissed after a few
 * seconds or with ×. `testId` sits on the message itself, so its `textContent`
 * is exactly the message.
 */
export type SuccessBannerProps = {
  /** The confirmation; nothing renders while null/empty. */
  message: string | null
  onDismiss: () => void
  testId: string
  className?: string
}

export default function SuccessBanner({ message, onDismiss, testId, className }: SuccessBannerProps) {
  // A stable child keeps Banner's auto-dismiss timer from restarting on every parent render.
  const content = useMemo(() => <span data-testid={testId}>{message}</span>, [message, testId])

  if (!message) return null

  return (
    <Banner
      tone="success"
      compact
      autoDismiss
      onDismiss={onDismiss}
      dismissLabel={strings.settings.dismiss}
      dismissTestId={`${testId}-dismiss`}
      data-testid={`${testId}-banner`}
      className={className}
    >
      {content}
    </Banner>
  )
}
