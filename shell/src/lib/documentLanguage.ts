import { resolveLocale } from '@operai/ui'
import type { Locale } from '@operai/ui'

/**
 * The suite-wide language seam (INC-25). The shell decides the person's
 * language ONCE, at startup, and writes it to `<html lang>`; every strings
 * module in the suite — the shell's and every remote's — selects its catalog
 * through the library's `selectStrings` → `resolveLocale`, which reads
 * `<html lang>` first. So the chrome and whichever tool is mounted always
 * speak the same language, and the screen reader pronounces it correctly.
 *
 * index.html ships a static `lang="en"`, a placeholder for the page before
 * this runs, not a choice: it is cleared first so `resolveLocale` falls
 * through to the browser's preferred languages (the first the suite has,
 * else English).
 */
export function applyDocumentLanguage(): Locale {
  const root = document.documentElement
  root.removeAttribute('lang')
  const locale = resolveLocale()
  root.setAttribute('lang', locale)
  return locale
}
