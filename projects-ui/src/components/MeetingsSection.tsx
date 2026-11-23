import { Component, useEffect, useState } from 'react'
import type { ComponentType, ErrorInfo, ReactNode } from 'react'
import { Banner, Card } from '@operai/ui'
import { strings } from '../strings'
import { Loading } from './LoadState'
import { MEETINGS_HOST } from '../lib/meetings'

type HostExtensionComponent = typeof import('shell/extensions').HostExtension

type Seam = { status: 'loading' } | { status: 'ready'; HostExtension: HostExtensionComponent } | { status: 'failed' }

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
 * `shell/extensions` promises never to throw (ADR 20260803-suite-version-generated-file-federated-export), but this seam runs
 * across a deploy boundary, so the project page does not rely on it: a render-time
 * throw anywhere under the panel is contained to the Meetings card.
 */
class Contain extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn('projects-ui: the Meetings section failed to render', error, info.componentStack)
  }

  override render() {
    return this.state.failed ? unavailable : this.props.children
  }
}

/**
 * MeetingsSection — the "Meetings" card of the project page (specs/20261104-meetings A18). The panel is
 * Meetings' own (list, Start meeting, Link an existing meeting), a federated component loaded through
 * the shell's `shell/extensions` seam with `{hostApp:'projects', entityType:'project', entityId}`
 * (ADR 20261104-host-extension-federated-panel-through-the-shell). Imported dynamically: a shell that
 * predates the expose, a failing import or a module without `HostExtension` renders this card's own
 * fallback with the same heading, and the rest of the page is unaffected (ADR 20260803-suite-version-generated-file-federated-export).
 */
export default function MeetingsSection({ projectId }: { projectId: string }) {
  const [seam, setSeam] = useState<Seam>({ status: 'loading' })

  useEffect(() => {
    let live = true
    import('shell/extensions').then(
      (module) => {
        if (!live) return
        try {
          // Reading the export is inside the try: a module namespace can throw on access.
          const HostExtension = (module as { HostExtension?: ComponentType<never> }).HostExtension
          setSeam(
            typeof HostExtension === 'function'
              ? { status: 'ready', HostExtension: HostExtension as unknown as HostExtensionComponent }
              : { status: 'failed' },
          )
        } catch {
          setSeam({ status: 'failed' })
        }
      },
      () => {
        if (live) setSeam({ status: 'failed' })
      },
    )
    return () => {
      live = false
    }
  }, [])

  if (seam.status === 'loading') return loadingCard
  if (seam.status === 'failed') return unavailable
  const { HostExtension } = seam
  return (
    <Contain>
      <HostExtension
        name="meetings.hostMeetings"
        props={{ ...MEETINGS_HOST, entityId: projectId }}
        fallback={unavailable}
        loading={loadingCard}
      />
    </Contain>
  )
}
