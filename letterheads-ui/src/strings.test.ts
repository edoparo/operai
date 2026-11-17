import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogGaps } from '@operai/ui'
import { describe, expect, it } from 'vitest'
import { en, it as italian, strings } from './strings'

const STRINGS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'strings')

// Every `strings/<namespace>.ts` module, loaded as written: each exports `<namespace> = { en, it }`.
type Catalogs = { en: Record<string, unknown>; it: Record<string, unknown> }
const modules = import.meta.glob<Record<string, Catalogs | undefined>>('./strings/*.ts', { eager: true })
const namespaces = Object.entries(modules).map(([file, module]) => {
  const name = path.basename(file, '.ts')
  return [name, module[name]] as const
})

describe('strings aggregate', () => {
  it('aggregates every file under src/strings/ (a namespace file nobody wired in would be invisible)', () => {
    const files = readdirSync(STRINGS_DIR).map((file) => path.basename(file, '.ts'))
    expect(files.length).toBeGreaterThan(0)
    expect(Object.keys(strings).sort()).toEqual([...files].sort())
  })
})

describe('strings catalogs (AC-8.8)', () => {
  it.each(namespaces)('%s exports both an English and an Italian catalog', (_name, catalogs) => {
    expect(catalogs?.en).toBeTypeOf('object')
    expect(catalogs?.it).toBeTypeOf('object')
  })

  it('the Italian catalog has every English key, with the same shape', () => {
    expect(catalogGaps(en, italian)).toEqual([])
  })

  it.each(namespaces)('%s: every English key has an Italian one (per file)', (_name, catalogs) => {
    expect(catalogGaps(catalogs?.en, catalogs?.it)).toEqual([])
  })

  it('names the tool as the design fixes it (§ Copy keys)', () => {
    expect(en.nav.heading).toBe('Letterheads')
    expect(italian.nav.heading).toBe('Carte intestate')
    expect(en.page.none).toBe('No letterhead yet')
    expect(italian.page.none).toBe('Nessuna carta intestata')
  })

  it('the Italian catalog is a translation, not a copy of the English', () => {
    expect(italian.nav.loading).not.toBe(en.nav.loading)
    expect(italian.common.permissionDenied.heading).not.toBe(en.common.permissionDenied.heading)
    expect(italian.common.retry).not.toBe(en.common.retry)
  })

  it('sentence values with a parameter render it in both languages', () => {
    expect(en.page.active(7)).toContain('7')
    expect(italian.page.active(7)).toContain('7')
  })

  it('has the save bar, refused values, conflict and leave guard in both languages (T24, design § Copy keys)', () => {
    expect(en.bar.save(4)).toBe('Save as version 4')
    expect(italian.bar.save(4)).toBe('Salva come versione 4')
    expect(italian.conflict.reload).not.toBe(en.conflict.reload)
    expect(italian.leave.switchEntity).toBe('Cambia e scarta')
    expect(italian.leave.body('wellD IT')).toContain('wellD IT')
    expect(italian.problem.summaryTitle(2)).not.toBe(en.problem.summaryTitle(2))
    // Each reason of the service's closed list that the form can cause has a sentence of its own, in both.
    const reasons = Object.keys(en.problem.reason)
    for (const reason of [
      'out_of_range',
      'not_a_number',
      'bad_colour',
      'unknown_font',
      'unknown_placeholder',
      'unbalanced_brace',
      'unbalanced_bracket',
      'segment_no_placeholder',
      'segment_nested',
      'too_many_lines',
      'language_missing',
      'body_too_small',
      'frame_overflow',
      'asset_unknown',
    ]) {
      expect(reasons).toContain(reason)
    }
    expect(Object.keys(italian.problem.reason)).toEqual(reasons)
  })

  it('tests run with an English browser, so the selected catalog is English', () => {
    expect(strings).toBe(en)
  })
})
