import type { ChangeEvent, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { SaveStatus } from '../context/EstimatorContext'
import { Badge, Icon, Spinner, VisuallyHidden } from '@operai/ui'
import type { BadgeTone } from '@operai/ui'
import { useSavedAgo } from '../hooks/useSavedAgo'
import { strings } from '../strings'

type HeaderProps = {
  name: string
  saveStatus: SaveStatus
  /** When the document was last stored (ISO 8601) — the badge's "Saved … ago". */
  lastSavedAt?: string | null
  onNameChange: (name: string) => void
  /**
   * T17 (specs/20260807-estimate-sharing/tasks.md; design.md S5): fed from
   * context's single `canEdit` gate (`!canEdit`). Defaults to `false` so
   * every pre-existing call site keeps its exact prior full-edit behaviour.
   * The name input becomes `readOnly` (not `disabled`); the save-status
   * span is omitted entirely — nothing ever autosaves for a viewer, so
   * there is nothing to report (not shown blank).
   */
  readOnly?: boolean
}

export default function Header({ name, saveStatus, lastSavedAt = null, onNameChange, readOnly = false }: HeaderProps) {
  const t = strings.editor
  const savedAgo = useSavedAgo(lastSavedAt)

  return (
    <header className="bg-ink-soft border-b border-rule px-4 sticky top-0 z-10">
      {/* Single desktop-only row. estimai-ui runs inside the desktop-only suite
          shell (specs/20260709-suite-shell), so there is no separate mobile header — one row is
          all this chrome needs. (Responsive variant utilities now behave
          correctly in-shell too: the suite runs a single shell-owned Tailwind
          sheet, so the old cross-sheet `sm:*` cascade is gone — see
          docs/adr/0006 Remote CSS strategy addendum.) */}
      <div className="flex items-center h-14">
        {/* Left — back to the list (INC-13): inline navigation is a `.link`
            text link, never a button. */}
        <div className="flex-1 flex items-center text-sm">
          <Link to="/estimates" className="link">
            <Icon name="arrow-left" className="mr-1 align-middle" />
            {t.backToEstimates}
          </Link>
        </div>

        {/* Center — project name */}
        <div className="flex-1 flex items-center justify-center">
          <input
            value={name}
            readOnly={readOnly}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onNameChange(e.target.value)}
            placeholder={t.namePlaceholder}
            aria-label={t.nameLabel}
            className="w-64 bg-transparent border-0 border-b border-rule rounded-none text-sm py-4 px-0 text-center focus:outline-none focus:shadow-none focus:border-acc"
          />
        </div>

        {/* Right — save badge: a spinner while saving, then how long ago the
            last save landed. It replaces the "Changes stored" banner, which
            pushed the page down on every save (owner, 2026-11-09). */}
        <div className="flex-1 flex items-center justify-end gap-3">
          {/* T17 (design.md S5): nothing ever autosaves for a viewer, so the
              save-status indicator is omitted entirely — not shown blank. */}
          {!readOnly && <SaveBadge saveStatus={saveStatus} savedAgo={savedAgo} />}
        </div>
      </div>
    </header>
  )
}

function SaveBadge({ saveStatus, savedAgo }: { saveStatus: SaveStatus; savedAgo: string | null }) {
  const t = strings.editor
  const badge = ((): { tone: BadgeTone; glyph: ReactNode; label: string } | null => {
    switch (saveStatus) {
      case 'saving':
        return { tone: 'neutral', glyph: <Spinner />, label: t.saving }
      // INC-20: "Save failed" / "Not saving" is a failed save → red; one tone for both (design.md S4).
      case 'error':
        return { tone: 'danger', glyph: <Icon name="alert" />, label: t.saveFailed }
      // T18 (design.md S4): autosave is suspended while a conflict is active —
      // visible, never a silent fall-through to "Saved".
      case 'conflict':
        return { tone: 'danger', glyph: <Icon name="alert" />, label: strings.conflict.savingSuspended }
      case 'saved':
        return { tone: 'success', glyph: <Icon name="check" />, label: savedAgo ?? t.saved }
      case 'idle':
        return savedAgo ? { tone: 'neutral', glyph: <Icon name="check" />, label: savedAgo } : null
    }
  })()
  // The live region announces the state only, not every tick of the clock.
  const announcement =
    saveStatus === 'saving'
      ? t.saving
      : saveStatus === 'saved'
        ? t.saved
        : saveStatus === 'error'
          ? t.saveFailed
          : saveStatus === 'conflict'
            ? strings.conflict.savingSuspended
            : ''
  return (
    <>
      <VisuallyHidden live data-testid="save-status-live">
        {announcement}
      </VisuallyHidden>
      {badge && (
        <Badge tone={badge.tone} glyph={badge.glyph} data-testid="save-status">
          {badge.label}
        </Badge>
      )}
    </>
  )
}
