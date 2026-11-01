import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
const FIELD = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)'

/**
 * The open dialogs, bottom to top. Only the topmost one handles the keyboard:
 * with a confirmation open on top of a dialog, Escape closes the confirmation
 * alone and Tab cycles inside it, then the dialog underneath takes over again.
 * Each dialog used to listen on `window` on its own, so one Escape closed both.
 */
const openDialogs: HTMLElement[] = []

function registerDialog(dialog: HTMLElement): () => void {
  // React runs a child's effects before its parent's: when a dialog and one
  // nested inside it mount in the same commit, the inner one registers first.
  // A dialog that contains an already-registered one goes below it.
  const nestedIndex = openDialogs.findIndex((other) => dialog.contains(other))
  if (nestedIndex === -1) openDialogs.push(dialog)
  else openDialogs.splice(nestedIndex, 0, dialog)
  if (openDialogs.length === 1) lockPageScroll()
  return () => {
    const index = openDialogs.indexOf(dialog)
    if (index !== -1) openDialogs.splice(index, 1)
    if (openDialogs.length === 0) unlockPageScroll()
  }
}

// The page behind an open dialog does not scroll (INC-21): the wheel and touch
// would otherwise move content the user cannot see, and lose their place. Set
// while the FIRST dialog opens and restored when the LAST one closes, so a
// stacked confirm neither re-locks nor unlocks early.
let savedOverflow: string | null = null

function lockPageScroll() {
  savedOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlockPageScroll() {
  if (savedOverflow === null) return
  document.body.style.overflow = savedOverflow
  savedOverflow = null
}

const isTopmost = (dialog: HTMLElement | null): boolean =>
  dialog !== null && openDialogs[openDialogs.length - 1] === dialog

export type DialogBehaviorOptions = {
  dialogRef: RefObject<HTMLElement | null>
  /** Called on Escape — never while `busy`. */
  onClose: () => void
  /** While true the dialog is not dismissible. */
  busy: boolean
  /** What takes focus on open. Defaults to `[data-autofocus]`, then the first field, then `fallbackFocusRef`. */
  initialFocusRef?: RefObject<HTMLElement | null>
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

/**
 * The keyboard and focus contract every Operai dialog shares (extracted from
 * inventory-ui's FormModal, the most complete of the suite's dialog copies):
 *   - remembers the trigger and gives focus back on close, if it is still in the page;
 *   - moves focus into the dialog on open;
 *   - Escape closes, except while busy;
 *   - Tab / Shift+Tab are trapped over the REAL focusable set (a disabled
 *     button is not a stop), and focus that escaped is pulled back in;
 *   - with dialogs stacked, only the topmost one does any of the above;
 *   - the page behind does not scroll while any dialog is open.
 */
export function useDialogBehavior({
  dialogRef,
  onClose,
  busy,
  initialFocusRef,
  fallbackFocusRef,
}: DialogBehaviorOptions) {
  useEffect(() => {
    const dialog = dialogRef.current
    return dialog ? registerDialog(dialog) : undefined
  }, [dialogRef])

  // Declared before the focus move so it reads the trigger, not the dialog.
  useEffect(() => {
    const trigger = document.activeElement
    return () => {
      if (trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected) trigger.focus()
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    const target =
      initialFocusRef?.current ??
      dialog?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      dialog?.querySelector<HTMLElement>(FIELD) ??
      fallbackFocusRef?.current ??
      dialog
    target?.focus()
    // Open-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A dialog under another one leaves the keyboard to the one on top.
      if (!isTopmost(dialogRef.current)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onClose()
        return
      }
      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.matches(':disabled') && !(el instanceof HTMLInputElement && el.type === 'hidden'),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (!(active instanceof Node) || !dialog.contains(active)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey) {
        if (active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialogRef, onClose, busy])
}
