import { describe, expect, it } from 'vitest'
import { catalogGaps, formatNumber, selectStrings } from '@operai/ui'
import { en, it as itCatalog, strings } from './strings'

/**
 * INC-24/INC-25: the Italian catalog is complete — every English key has an
 * Italian value of the same kind (a function where English has a sentence
 * with a value in it), none empty, none extra.
 */
describe('strings catalogs', () => {
  it('Italian has every key English has (catalogGaps)', () => {
    expect(catalogGaps(en, itCatalog)).toEqual([])
  })

  it('selects English under the test runner (English navigator) and Italian when asked', () => {
    expect(strings).toBe(en)
    expect(selectStrings({ en, it: itCatalog }, 'it').editor.tabSummary).toBe('Riepilogo')
    expect(selectStrings({ en, it: itCatalog }, 'it').parameters.heading).toBe('Parametri del modello')
  })

  it('Italian sentences take their values (functions, not concatenation)', () => {
    expect(itCatalog.estimatesList.deleteAction('Alfa')).toBe('Elimina "Alfa"')
    expect(itCatalog.importOffer.summary(2, 3)).toBe('2 di 3 importate correttamente.')
    expect(itCatalog.metrics.activitiesSub(1, 2)).toBe('1 rilascio · 2 profili')
  })

  it('figures follow the locale through formatNumber (INC-27)', () => {
    expect(formatNumber(1234.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, 'en')).toBe('1,234.5')
    expect(formatNumber(12345.5, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, 'it')).toBe('12.345,5')
  })
})
