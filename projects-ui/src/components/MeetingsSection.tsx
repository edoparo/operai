import type { ReactNode } from 'react'
import { Banner, Card } from '@operai/ui'
import { strings } from '../strings'
import { Loading } from './LoadState'
import { useExtensionSeam } from '../lib/extensionSeam'
import ExtensionContain from './ExtensionContain'
import { MEETINGS_HOST } from '../lib/meetings'


/** The host's own card: the section keeps its heading whatever happens to the remote (AC-11.6). */
function MeetingsCard({ children }: { children: ReactNode }) {
  return (
    <Card title={strings.project.meetings.heading} data-testid="project-meetings">
      {children}
    </Card>
  )
}

const unavailable = (
  <MeetingsCard>
    <Banner tone="info" data-testid="project-meetings-unavailable">
      {strings.project.meetings.unavailable}
    </Banner>
  </MeetingsCard>
)

const loadingCard = (
  <MeetingsCard>
    <Loading label={strings.project.meetings.loading} rows={2} />
  </MeetingsCard>
)

/**
 * MeetingsSection — the "Meetings" card of the project page (specs/20261104-meetings A18). The panel is
 * Meetings' own (list, Start meeting, Link an existing meeting), a federated component loaded through
 * the shell's `shell/extensions` seam with `{hostApp:'projects', entityType:'project', entityId}`
 * (ADR 20261104-host-extension-federated-panel-through-the-shell). Imported dynamically: a shell that
 * predates the expose, a failing import or a module without `HostExtension` renders this card's own
 * fallback with the same heading, and the rest of the page is unaffected (ADR 20260803-suite-version-generated-file-federated-export).
 */
export default function MeetingsSection({ projectId }: { projectId: string }) {
  const seam = useExtensionSeam()

  if (seam.status === 'loading') return loadingCard
  if (seam.status === 'failed') return unavailable
  const { HostExtension } = seam
  return (
    <ExtensionContain widget="the Meetings section" resetKey={projectId} fallback={unavailable}>
      <HostExtension
        name="meetings.hostMeetings"
        props={{ ...MEETINGS_HOST, entityId: projectId }}
        fallback={unavailable}
        loading={loadingCard}
      />
    </ExtensionContain>
  )
}
