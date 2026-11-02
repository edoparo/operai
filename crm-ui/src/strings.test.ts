import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogGaps } from '@operai/ui'
import { describe, expect, it } from 'vitest'
import { en, it as italian, strings } from './strings'

const STRINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'strings')

describe('strings aggregate', () => {
  it('aggregates every file under src/strings/ (a namespace file nobody wired in would be invisible)', () => {
    const namespaces = readdirSync(STRINGS_DIR).map((file) => path.basename(file, '.ts'))
    expect(namespaces.length).toBeGreaterThan(0)
    expect(Object.keys(strings).sort()).toEqual([...namespaces].sort())
  })
})

describe('strings catalogs (INC-24, INC-25)', () => {
  it('the Italian catalog has every English key, with the same shape', () => {
    expect(catalogGaps(en, italian)).toEqual([])
  })

  it('the Italian catalog is a translation, not a copy of the English', () => {
    expect(italian.nav.companies).not.toBe(en.nav.companies)
    expect(italian.badges.dealStage.won).not.toBe(en.badges.dealStage.won)
    expect(italian.contacts.eraseDialog.body).not.toBe(en.contacts.eraseDialog.body)
  })

  it('sentence values with a parameter render it in both languages', () => {
    expect(en.deals.pipeline.closedIn(2026)).toContain('2026')
    expect(italian.deals.pipeline.closedIn(2026)).toContain('2026')
  })

  it('tests run with an English browser, so the selected catalog is English', () => {
    expect(strings).toBe(en)
  })
})
