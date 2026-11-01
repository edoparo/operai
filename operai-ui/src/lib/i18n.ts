/**
 * The suite's languages and copy catalogs (INC-24, INC-25).
 *
 * Every app keeps its copy in a strings module with one catalog per language,
 * the Italian typed as the English (`const it: typeof en`), and exports
 * `strings = selectStrings({ en, it })`. The language is resolved ONCE, here,
 * for every tool: before, the shell's user menu, /account and admin's address
 * section each detected Italian on their own and the rest stayed English.
 * `catalogGaps(en, it)` is the parity check each app's test runs.
 */

export type Locale = 'en' | 'it'

export const LOCALES: readonly Locale[] = ['en', 'it']

const asLocale = (tag: string | null | undefined): Locale | null => {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0]
  return language === 'it' ? 'it' : language === 'en' ? 'en' : null
}

/**
 * The person's language: `<html lang>` when the shell has set it, else the
 * first of the browser's preferred languages the suite has, else English.
 */
export function resolveLocale(): Locale {
  if (typeof document !== 'undefined') {
    const fromDocument = asLocale(document.documentElement.getAttribute('lang'))
    if (fromDocument) return fromDocument
  }
  if (typeof navigator !== 'undefined') {
    const preferred = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const tag of preferred) {
      const locale = asLocale(tag)
      if (locale) return locale
    }
  }
  return 'en'
}

/** The catalog for the person's language, English when a catalog is missing. */
export function selectStrings<T>(catalogs: { en: T } & Partial<Record<Locale, T>>, locale = resolveLocale()): T {
  return catalogs[locale] ?? catalogs.en
}

/**
 * The key paths where `translation` does not match `reference`: missing,
 * extra, a string where a function is expected (a function translates a
 * sentence with a value in it), or an empty string. `[]` means complete.
 */
export function catalogGaps(reference: unknown, translation: unknown, path = ''): string[] {
  const here = path || '(root)'
  if (typeof reference === 'function') {
    return typeof translation === 'function' ? [] : [`${here}: expected a function`]
  }
  if (typeof reference === 'string') {
    if (typeof translation !== 'string') return [`${here}: expected a string`]
    return reference !== '' && translation.trim() === '' ? [`${here}: empty`] : []
  }
  if (reference && typeof reference === 'object') {
    if (!translation || typeof translation !== 'object') return [`${here}: missing`]
    const ref = reference as Record<string, unknown>
    const tr = translation as Record<string, unknown>
    const gaps = Object.keys(ref).flatMap((name) =>
      name in tr
        ? catalogGaps(ref[name], tr[name], path ? `${path}.${name}` : name)
        : [`${path ? `${path}.` : ''}${name}: missing`],
    )
    const extra = Object.keys(tr)
      .filter((name) => !(name in ref))
      .map((name) => `${path ? `${path}.` : ''}${name}: not in the reference`)
    return [...gaps, ...extra]
  }
  return typeof translation === typeof reference ? [] : [`${here}: expected ${typeof reference}`]
}
