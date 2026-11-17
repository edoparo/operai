/**
 * VersionBanner — what heads the page while an older version is open (task T25; design F8, S6; AC-8.7): "Viewing
 * version {n}" (the heading takes focus when the version is shown), who saved it and when, that it is not the
 * active version, **Back to the active version** and, for a manager in scope, **Restore this version**. The
 * version's own answer carries neither who nor when, so they come from the history, which is asked for here; until
 * it answers (or if it cannot) the banner says only that this is not the active version.
 */
import { useEffect, useRef, useState } from 'react'
import { Banner, Button } from '@operai/ui'
import type { Entity } from '../lib/types'
import { strings } from '../strings'
import { formatSavedAt, newestVersion, useVersionHistory } from './HistoryPanelApi'
import { RestoreDialog } from './HistoryPanelRestore'

export interface VersionBannerProps {
  entity: Entity
  version: number
  /** The active version the page's list gave: the base of a restore until the history says better. */
  activeFallback: number | null
  /** The person may change this entity's letterhead and has not lost the grant: Restore is offered. */
  canRestore: boolean
  onBack: () => void
  onRestored: (next: number, from: number) => void
  onLost: () => void
  /** A restore found a newer version than the one the page knew (409). */
  onConflict: () => void
}

export function VersionBanner({
  entity,
  version,
  activeFallback,
  canRestore,
  onBack,
  onRestored,
  onLost,
  onConflict,
}: VersionBannerProps) {
  const history = useVersionHistory(entity)
  const [restoring, setRestoring] = useState(false)
  const headingRef = useRef<HTMLSpanElement>(null)
  // The version was just opened: the person is told what they are looking at (design § Accessibility "Focus management").
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const row = history.rows?.find((candidate) => candidate.version === version) ?? null
  const active = newestVersion(history.rows) ?? activeFallback ?? 0
  return (
    <>
      <Banner
        tone="info"
        live="off"
        data-testid="letterheads-version-banner"
        title={
          <span ref={headingRef} role="heading" aria-level={3} tabIndex={-1} data-testid="letterheads-version-heading">
            {strings.version.title(version)}
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={onBack} data-testid="letterheads-version-back">
              {strings.version.back}
            </Button>
            {canRestore && (
              <Button
                size="sm"
                variant="primary"
                aria-haspopup="dialog"
                onClick={() => setRestoring(true)}
                data-testid="letterheads-version-restore"
              >
                {strings.version.restore}
              </Button>
            )}
          </>
        }
      >
        {row === null ? strings.version.bodyPlain : strings.version.body(row.savedBy, formatSavedAt(row.createdAt))}
      </Banner>
      {restoring && (
        <RestoreDialog
          entity={entity}
          version={version}
          active={active}
          discardsEdits={false}
          onCancel={() => setRestoring(false)}
          onRestored={(next) => {
            setRestoring(false)
            onRestored(next, version)
          }}
          onConflict={() => {
            history.reload()
            onConflict()
          }}
          onLost={onLost}
        />
      )}
    </>
  )
}
