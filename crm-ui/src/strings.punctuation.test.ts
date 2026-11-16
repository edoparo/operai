import { describe, expect, it } from 'vitest'
import { en, it as italian } from './strings'

/**
 * A string that wraps another sentence ends once (QE D16: "…could not be saved: Some answers are not valid, so the
 * draft was not saved.."). The wizard has one such string — `save.rejected(reason)`, given a server reason that is a
 * sentence of its own — and the reasons the page hands it are the `offers.errors` sentences.
 */
describe('the rejected-save banner', () => {
  it.each([
    ['en', en],
    ['it', italian],
  ] as const)('%s: says the reason once, whatever the reason', (_language, catalog) => {
    for (const reason of Object.values(catalog.offers.errors)) {
      if (typeof reason !== 'string') continue
      const banner = catalog.offerWizard.save.rejected(reason)
      expect(banner).not.toMatch(/[.!?]{2}/)
      expect(banner.endsWith(reason)).toBe(true)
    }
  })
})
