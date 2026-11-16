import { focusFirstInvalid } from '@operai/ui'

/**
 * After a server refusal, put focus where the person must look: the first field marked invalid (it scrolls into view
 * inside the dialog), else the dialog's announced error banner (`role="alert"`, made focusable here: the library's
 * FormDialog renders it as a plain paragraph). Without this the focus stays on the Submit button that just went
 * busy, i.e. on `<body>`, and a long form shows no change.
 */
export function focusRefusal(form: Element | null | undefined): void {
  if (!form) return
  if (focusFirstInvalid(form as HTMLElement)) return
  const banner = form.querySelector<HTMLElement>('[role="alert"]')
  if (!banner) return
  if (!banner.hasAttribute('tabindex')) banner.setAttribute('tabindex', '-1')
  banner.focus()
}
