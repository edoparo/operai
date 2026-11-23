import type { ReactNode } from 'react'
import { Banner, Card } from '@operai/ui'
import { strings } from '../strings'
import { Loading } from './LoadState'
import { useExtensionSeam } from '../lib/extensionSeam'
import ExtensionContain from './ExtensionContain'


/** The host's own card: the section keeps its heading whatever happens to the remote (AC-11.6). */
function MeetingsCard({ children }: { children: ReactNode }) {
  return (
    <Card title={strings.deals.meetings.heading} data-testid="crm-deal-meetings">
      {children}
    </Card>
  )
}

const unavailable = (
  <MeetingsCard>
    <Banner tone="info" data-testid="crm-deal-meetings-unavailable">
      {strings.deals.meetings.unavailable}
    </Banner>
  </MeetingsCard>
)

const loadingCard = (
  <MeetingsCard>
    <Loading label={strings.deals.meetings.loading} rows={2} />
  </MeetingsCard>
)

/**
 * MeetingsSection — the "Meetings" card of the deal page (specs/20261104-meetings AC-11.2).
 * The panel is Meetings' own, a federated component loaded through the shell's
 * `shell/extensions` seam with `{hostApp:'crm', entityType:'deal', entityId}`
 * (ADR 20261104-host-extension-federated-panel-through-the-shell). crm-ui imports the seam dynamically: a shell that predates the
 * expose, a failing import or a module without `HostExtension` renders this
 * card's own fallback with the same heading, and the rest of the page is
 * unaffected (AC-11.6, ADR 20260803-suite-version-generated-file-federated-export). No retry: a failed module import is cached,
 * so the fallback says to reload the page.
 *
 * Deals only: the company page rolls up no meetings in this release (AC-11.7).
 */
export default function MeetingsSection({ dealId }: { dealId: string }) {
  const seam = useExtensionSeam()

  if (seam.status === 'loading') return loadingCard
  if (seam.status === 'failed') return unavailable
  const { HostExtension } = seam
  return (
    <ExtensionContain widget="the Meetings section" resetKey={dealId} fallback={unavailable}>
      <HostExtension
        name="meetings.hostMeetings"
        props={{ hostApp: 'crm', entityType: 'deal', entityId: dealId }}
        fallback={unavailable}
        loading={loadingCard}
      />
    </ExtensionContain>
  )
}
