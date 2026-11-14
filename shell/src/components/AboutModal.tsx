/**
 * AboutModal — the About dialog, describing the Operai suite itself.
 *
 * Relocated from estimai-ui/src/components/AboutModal.tsx (T6, specs/20260709-suite-shell,
 * AC-1.4) — structurally unchanged. Content is sourced from the relocated,
 * suite-level ../lib/appInfo (name/description/version = Operai the suite, not a single
 * tool). The EstimAI original's "Part of the {APP_SUITE} suite" subtitle is dropped here
 * — this dialog no longer describes a tool that's *part of* a suite, it describes the
 * suite itself, so that framing no longer applies.
 *
 * "Version" above shows the umbrella suite version (APP_VERSION). Below it, a
 * "Components" section additionally lists each mounted remote's OWN version
 * (../hooks/useRemoteVersions) — see that module's doc for the resolution/
 * degradation contract. Every row renders independently and immediately: a
 * remote whose version can't be resolved (unreachable, cold-starting, timed
 * out, or predating this feature and missing `./version` entirely) shows a
 * muted "—" rather than blocking the dialog or throwing.
 */
import { Dialog, VisuallyHidden } from '@operai/ui'
import { APP_NAME, APP_DESCRIPTION, APP_TAGLINE, APP_AUTHOR, APP_AUTHOR_URL, APP_VERSION } from '../lib/appInfo'
import { REMOTE_VERSION_SOURCES, useRemoteVersions, type RemoteVersionSource } from '../hooks/useRemoteVersions'
import { strings } from '../strings'

interface Props {
  onClose: () => void
  /**
   * Test-only injection seam, defaulting to the real suite remotes. Lets
   * AboutModal.test.tsx exercise each of a remote's `./version` import's
   * failure shapes (rejection, timeout, malformed export) with plain,
   * directly-controllable loader functions instead of mocking Module
   * Federation's bare import specifiers — the same shape RemoteMount's
   * `loader` prop already establishes in this codebase for testing async
   * remote-loading states deterministically.
   */
  remoteVersionSources?: readonly RemoteVersionSource[]
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-rule/50 last:border-0">
      <span className="text-2xs font-mono uppercase tracking-widest text-muted shrink-0">{label}</span>
      <span className="text-xs text-text text-right">{children}</span>
    </div>
  )
}

export default function AboutModal({ onClose, remoteVersionSources = REMOTE_VERSION_SOURCES }: Props) {
  const remoteVersions = useRemoteVersions(remoteVersionSources)

  // The library Dialog (INC-07/09) owns the frame, aria-modal, the focus trap,
  // Escape and focus restore. Its title is the accessible name: the visible
  // heading stays "Operai" next to the logo, the name reads "About Operai".
  return (
    <Dialog
      size="sm"
      onClose={onClose}
      closeLabel={strings.about.close}
      testIdPrefix="about-modal"
      title={
        <span className="flex items-center gap-3">
          <img src="/operai.svg" alt="" className="h-9 w-9 rounded-md shrink-0" />
          <VisuallyHidden>{strings.about.title(APP_NAME)}</VisuallyHidden>
          <span aria-hidden="true">{APP_NAME}</span>
        </span>
      }
    >
      <p className="text-xs text-soft leading-relaxed mb-1">{APP_DESCRIPTION}</p>
      <p className="text-2xs text-muted italic mb-4">{APP_TAGLINE}</p>

      <div className="flex flex-col">
        <InfoRow label={strings.about.version}>
          <span className="font-mono">{APP_VERSION}</span>
        </InfoRow>
        <InfoRow label={strings.about.author}>
          <a href={APP_AUTHOR_URL} target="_blank" rel="noreferrer" className="link">
            {APP_AUTHOR}
          </a>
        </InfoRow>
      </div>

      <div className="flex flex-col mt-3 pt-3 border-t border-rule/50">
        <p className="text-2xs font-mono uppercase tracking-widest text-muted mb-1.5">{strings.about.components}</p>
        {remoteVersionSources.map((source) => {
          const version = remoteVersions[source.id]
          return (
            <InfoRow key={source.id} label={source.label}>
              <span data-testid={`remote-version-${source.id}`} className={version ? 'font-mono' : 'font-mono text-dim'}>
                {version ?? '—'}
              </span>
            </InfoRow>
          )
        })}
      </div>
    </Dialog>
  )
}
