import type { ChangeEvent } from 'react'
import { Link } from '@tanstack/react-router'
import type { SaveStatus } from '../context/EstimatorContext'
import { Icon } from '@operai/ui'
import { strings } from '../strings'

type HeaderProps = {
  name: string
  saveStatus: SaveStatus
  onNameChange: (name: string) => void
  /**
   * T17 (specs/013-estimate-sharing/tasks.md; design.md S5): fed from
   * context's single `canEdit` gate (`!canEdit`). Defaults to `false` so
   * every pre-existing call site keeps its exact prior full-edit behaviour.
   * The name input becomes `readOnly` (not `disabled`); the save-status
   * span is omitted entirely — nothing ever autosaves for a viewer, so
   * there is nothing to report (not shown blank).
   */
  readOnly?: boolean
}

export default function Header({ name, saveStatus, onNameChange, readOnly = false }: HeaderProps) {
  const t = strings.editor

  return (
    <header className="bg-ink-soft border-b border-rule px-4 sticky top-0 z-10">
      {/* Single desktop-only row. estimai-ui runs inside the desktop-only suite
          shell (specs/003), so there is no separate mobile header — one row is
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

        {/* Right — save indicator */}
        <div className="flex-1 flex items-center justify-end gap-3">
          {/* T17 (design.md S5): nothing ever autosaves for a viewer, so the
              save-status indicator is omitted entirely — not shown blank. */}
          {!readOnly && (
            <span
              className={`text-2xs font-mono transition-opacity duration-500 ${
                saveStatus === 'saved'
                  ? 'text-grn'
                  : saveStatus === 'saving'
                    ? 'text-soft'
                    : // INC-20: "Save failed" / "Not saving" is a failed save → red,
                      // the -text token for light-theme contrast; one tone for both (design.md S4).
                      saveStatus === 'error' || saveStatus === 'conflict'
                      ? 'text-red-text'
                      : 'text-grn'
              }`}
              style={{ opacity: saveStatus === 'idle' ? 0 : 1 }}
              aria-live="polite"
            >
              {saveStatus === 'saving'
                ? t.saving
                : saveStatus === 'error'
                  ? t.saveFailed
                  : /* T18 (design.md S4): the 4th state — autosave is
                       suspended while a conflict is active, so this makes
                       that suppression visible rather than silently falling
                       through to "Saved". */
                    saveStatus === 'conflict'
                    ? strings.conflict.savingSuspended
                    : (
                        <>
                          <Icon name="check" className="mr-1 align-middle" />
                          {t.saved}
                        </>
                      )}
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
