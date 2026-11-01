/**
 * @vitest-environment jsdom
 *
 * The suite-wide language seam: the shell writes the person's language to
 * <html lang> at startup, overriding index.html's static placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyDocumentLanguage } from './documentLanguage'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.setAttribute('lang', 'en')
})

describe('applyDocumentLanguage', () => {
  it("replaces index.html's static lang with the browser's Italian", () => {
    document.documentElement.setAttribute('lang', 'en')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['it-CH', 'en'])

    expect(applyDocumentLanguage()).toBe('it')
    expect(document.documentElement.getAttribute('lang')).toBe('it')
  })

  it('falls back to English for a language the suite does not have', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-CH', 'fr'])

    expect(applyDocumentLanguage()).toBe('en')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })
})
