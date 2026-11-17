import { useId } from 'react'
import type { ReactNode } from 'react'
import { Button, Icon, VisuallyHidden } from '@operai/ui'
import { strings } from '../strings'

export interface SaveBarProps {
  /** The form differs from the version it was loaded from. */
  dirty: boolean
  /** The version the save would make ("Save as version {n}"). */
  nextVersion: number
  saving: boolean
  /** A newer version exists: Save waits for the reload. */
  conflict: boolean
  /** No Save, no status: the person cannot change this letterhead (design S5). Only Preview, below `xl`. */
  readOnly: boolean
  onSave: () => void
  /** Opens the preview in the Drawer (the pane is beside the form from `xl` up). */
  onPreview: () => void
  /** A confirmation shown with the bar, where the person is looking when it arrives. */
  notice?: ReactNode
}

/**
 * SaveBar — the sticky bar under the form (design F7, S1, S5): what the form is (clean or not), **Save as
 * version {n+1}**, and the Preview button below `xl`. Save is `aria-disabled`, not `disabled`, while there is
 * nothing to save, a newer version is waiting, or a save is running: it stays in the tab order and its reason is
 * read out (`aria-describedby`). A save in flight shows "Saving…" and a spinner (`busy`) and ignores clicks.
 * After a save focus stays where it is, on this button. The status is plain text with an icon, never colour
 * alone, and not a live region: the outcomes of a save are announced by their own banners.
 */
export function SaveBar({ dirty, nextVersion, saving, conflict, readOnly, onSave, onPreview, notice }: SaveBarProps) {
  const reasonId = useId()
  const preview = (
    <Button
      variant="secondary"
      className="xl:hidden"
      aria-haspopup="dialog"
      onClick={onPreview}
      data-testid="letterheads-preview-open"
    >
      {strings.bar.preview}
    </Button>
  )

  if (readOnly) {
    return (
      <div className="flex justify-end xl:hidden" data-testid="letterheads-bar">
        {preview}
      </div>
    )
  }

  const reason = conflict ? strings.bar.reloadFirst : !dirty ? strings.bar.nothingToSave : null
  const blocked = reason !== null || saving
  return (
    <div
      className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-rule bg-ink py-3"
      data-testid="letterheads-bar"
    >
      {notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 flex items-center gap-2 text-sm text-soft" data-testid="letterheads-status">
          {saving ? (
            strings.bar.saving
          ) : (
            <>
              <Icon name={dirty ? 'alert' : 'check'} />
              {dirty ? strings.bar.dirty : strings.bar.clean}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {preview}
          <Button
            variant="primary"
            busy={saving}
            aria-disabled={blocked || undefined}
            aria-describedby={reason !== null ? reasonId : undefined}
            onClick={blocked ? undefined : onSave}
            data-testid="letterheads-save"
          >
            {saving ? strings.bar.saving : strings.bar.save(nextVersion)}
          </Button>
          {reason !== null && <VisuallyHidden id={reasonId}>{reason}</VisuallyHidden>}
        </div>
      </div>
    </div>
  )
}
