import { catalogGaps } from '@operai/ui'
import { describe, expect, it } from 'vitest'
import { catalogs } from './strings'

describe('shell strings', () => {
  it('has a complete Italian catalog (INC-25 parity)', () => {
    expect(catalogGaps(catalogs.en, catalogs.it)).toEqual([])
  })
})
