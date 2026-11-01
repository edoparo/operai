/**
 * The Italian catalog is complete (INC-24/INC-25): same keys as English, a
 * function wherever English has one (a sentence with a value in it), and no
 * empty string. `catalogGaps` is @operai/ui's check; `[]` means complete.
 */

import { catalogGaps } from '@operai/ui'
import { describe, expect, it } from 'vitest'
import { catalogs, strings } from './strings'

describe('strings catalogs', () => {
  it('the Italian catalog has every English key, and nothing else', () => {
    expect(catalogGaps(catalogs.en, catalogs.it)).toEqual([])
  })

  it('is really translated, not a copy of the English one', () => {
    expect(catalogs.it.appTitle).toBe('Rimborsi')
    expect(catalogs.it.pages.myRequests.heading).not.toBe(catalogs.en.pages.myRequests.heading)
    expect(catalogs.it.pages.reviewDetail.decide.approveButton).toBe('Approva')
  })

  it('selects English for an English browser (the test environment)', () => {
    expect(strings).toBe(catalogs.en)
  })

  it('keeps the canonical entity names in both languages (they are proper names)', () => {
    expect(catalogs.it.badges.entity).toEqual(catalogs.en.badges.entity)
  })
})
