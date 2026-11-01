import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogGaps } from '@operai/ui'
import { describe, expect, it } from 'vitest'
import { en, it as italian, strings } from './strings'

const STRINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'strings')

/**
 * T24's promise to later tasks: strings.ts aggregates one file per namespace,
 * so nobody edits it again. These namespaces are the ones design.md § Strings
 * and numbers and the later tasks' `touch:` lists name.
 */
const NAMED_BY_LATER_TASKS = [
  'common',
  'errors',
  'badges',
  'nav',
  'assets',
  'register',
  'assetDetail',
  'actions',
  'ledger',
  'invoice',
  'history',
  'rules',
  'years',
  'myDevices',
  'dialogs',
  'empty',
  'categories',
  'disposalReasons',
  'yearDetail',
]

describe('strings aggregate', () => {
  it.each(NAMED_BY_LATER_TASKS)('exposes the %s namespace', (namespace) => {
    expect(strings).toHaveProperty(namespace)
  })

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
    expect(italian.nav.assets).not.toBe(en.nav.assets)
    expect(italian.badges.assetStatus.in_stock).not.toBe(en.badges.assetStatus.in_stock)
  })

  it('tests run with an English browser, so the selected catalog is English', () => {
    expect(strings).toBe(en)
  })
})
