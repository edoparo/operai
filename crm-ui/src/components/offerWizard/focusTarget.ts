import { focusFirstInvalid } from '@operai/ui'

/**
 * Where an issue's `name` lands (specs/20261115-crm-offer-wizard AC-3.4, AC-3.6; design § Accessibility "Jump to
 * field"): the element carrying `data-wizard-field="{name}"` — a field's control, a list's or table's fieldset, a
 * cost line's card, the Cost table card (`cost:*`), a section's Edit text button (`section:<key>`).
 */
export function findWizardTarget(name: string): HTMLElement | null {
  // compared as strings, never put into a selector: a name holds `:`, `#`, `.` and a row id
  for (const element of document.querySelectorAll<HTMLElement>('[data-wizard-field]')) {
    if (element.dataset.wizardField === name) return element
  }
  return null
}

const NATIVE = 'input, select, textarea, button, [tabindex]'
const FIRST_CONTROL = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'

/** Focuses a target: the element itself when it can take focus, else its first invalid control, else its first control. */
export function focusWizardTarget(element: HTMLElement): boolean {
  let focused: HTMLElement | null = null
  if (element.matches(NATIVE)) {
    element.focus()
    focused = element
  } else if (focusFirstInvalid(element)) {
    focused = element.querySelector<HTMLElement>('[aria-invalid="true"]')
  } else {
    focused = element.querySelector<HTMLElement>(FIRST_CONTROL)
    focused?.focus()
  }
  if (focused === null || document.activeElement !== focused) return false
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  focused.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  return true
}

/** One jump at a time: a newer one cancels the frames the previous one still waits for. */
let latest = 0
/** Frames to wait for the step to render (the step may change through the router): about a second. */
const MAX_FRAMES = 60

/**
 * Focuses the target of `name` once it is in the page: right away when it already is (the Preview step's own
 * Edit text buttons), otherwise on the first frame after the step that holds it has rendered.
 */
export function jumpToField(name: string): void {
  const mine = ++latest
  let frames = 0
  const attempt = () => {
    if (mine !== latest) return
    const element = findWizardTarget(name)
    if (element !== null) {
      focusWizardTarget(element)
      return
    }
    frames += 1
    if (frames < MAX_FRAMES) requestAnimationFrame(attempt)
  }
  attempt()
}
