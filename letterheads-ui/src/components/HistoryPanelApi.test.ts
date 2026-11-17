/**
 * @vitest-environment node
 *
 * The history's reading of the service (task T25; plan § Person routes, amendment G9): the rows of
 * `GET …/versions`, the words for the names of `changedSettings`, and the reading of a restore that did not happen.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/api'
import { en, it as italian } from '../strings'
import {
  classifyRestoreFailure,
  describeChanged,
  formatSavedAt,
  HistoryShapeError,
  newestVersion,
  parseHistory,
  settingName,
} from './HistoryPanelApi'
import type { HistoryRow } from './HistoryPanelApi'

const entry = (version: number, over: Record<string, unknown> = {}) => ({
  version,
  createdBy: { sub: `sub-${version}`, name: `Person ${version}` },
  createdAt: '2026-11-10T09:30:00.000Z',
  changedSettings: ['margins'],
  restoredFrom: null,
  ...over,
})

describe('parseHistory', () => {
  it('reads the rows and puts the newest first, whatever order the service answered in', () => {
    const rows = parseHistory([entry(1), entry(3), entry(2)])
    expect(rows.map((row) => row.version)).toEqual([3, 2, 1])
    expect(rows[0]).toEqual({
      version: 3,
      savedBy: 'Person 3',
      createdAt: '2026-11-10T09:30:00.000Z',
      changedSettings: ['margins'],
      restoredFrom: null,
    })
  })

  it('names the person by the display name, and by the account id when the service had no name', () => {
    const [named, blank, missing] = parseHistory([
      entry(3),
      entry(2, { createdBy: { sub: 'sub-2', name: '  ' } }),
      entry(1, { createdBy: { sub: 'sub-1' } }),
    ])
    expect([named.savedBy, blank.savedBy, missing.savedBy]).toEqual(['Person 3', 'sub-2', 'sub-1'])
  })

  it('reads a restore, and leaves out what is not a version rather than showing it half-empty', () => {
    const rows = parseHistory([
      entry(4, { restoredFrom: 2, changedSettings: [] }),
      entry(0),
      entry(-1),
      entry(1.5),
      { nope: true },
      null,
      'text',
      entry(2, { restoredFrom: 'x', changedSettings: ['fonts', 7, null] }),
    ])
    expect(rows.map((row) => [row.version, row.restoredFrom, row.changedSettings])).toEqual([
      [4, 2, []],
      [2, null, ['fonts']],
    ])
  })

  it('refuses an answer that is not a list (a proxy page, an older service)', () => {
    expect(() => parseHistory({ versions: [] })).toThrow(HistoryShapeError)
    expect(() => parseHistory(null)).toThrow(HistoryShapeError)
    expect(parseHistory([])).toEqual([])
  })

  it('finds the active version as the highest, and none for an empty history', () => {
    expect(newestVersion(parseHistory([entry(2), entry(5), entry(3)]))).toBe(5)
    expect(newestVersion([])).toBeNull()
    expect(newestVersion(null)).toBeNull()
  })
})

describe('what changed, in words (G9)', () => {
  const row = (over: Partial<HistoryRow>): HistoryRow => ({
    version: 2,
    savedBy: 'Ada',
    createdAt: '',
    changedSettings: [],
    restoredFrom: null,
    ...over,
  })

  it('translates each name and joins them', () => {
    expect(describeChanged(row({ changedSettings: ['margins', 'variants.first.logo', 'look.bulletMarker'] }))).toBe(
      'Margins, First page logo, List marker',
    )
  })

  it('says a restore has the same settings as the version it copied, whatever names it holds', () => {
    expect(describeChanged(row({ restoredFrom: 1, changedSettings: ['margins'] }))).toBe('Same settings as version 1')
  })

  it('says so when a save changed nothing', () => {
    expect(describeChanged(row({}))).toBe('No settings changed')
  })

  it('shows a name it does not know as received, and never a property of Object', () => {
    expect(settingName('variants.middle.header')).toBe('variants.middle.header')
    expect(settingName('constructor')).toBe('constructor')
    expect(settingName('__proto__')).toBe('__proto__')
    expect(settingName('toString')).toBe('toString')
  })
})

describe('the names of changedSettings (T21 note: a copy key for each)', () => {
  // The service's closed set, read from where it is defined, so a name added there without words here fails.
  const source = fileURLToPath(new URL('../../../letterhead-api/engine/src/config/diff.rs', import.meta.url))
  const available = existsSync(source)

  it.skipIf(!available)('has an English and an Italian word for every name of SETTING_NAMES, and no other', () => {
    const text = readFileSync(source, 'utf-8')
    const block = /pub const SETTING_NAMES: \[&str; \d+\] = \[([^\]]*)\]/.exec(text)
    expect(block).not.toBeNull()
    const names = Array.from(block![1].matchAll(/"([^"]+)"/g), (match) => match[1])
    expect(names.length).toBeGreaterThanOrEqual(20)
    expect(Object.keys(en.history.setting).sort()).toEqual([...names].sort())
    expect(Object.keys(italian.history.setting).sort()).toEqual([...names].sort())
    for (const name of names) {
      expect(en.history.setting[name as keyof typeof en.history.setting]).toBeTruthy()
      expect(italian.history.setting[name as keyof typeof en.history.setting]).not.toBe(
        en.history.setting[name as keyof typeof en.history.setting],
      )
    }
  })

  it('has the twenty names the design lists (G9) even where the service source is not at hand', () => {
    const names = [
      'margins',
      'fonts',
      'look.headings',
      'look.body',
      'look.table',
      'look.bulletMarker',
      ...['default', 'first', 'last'].flatMap((v) =>
        ['header', 'footer', 'logo', 'background'].map((p) => `variants.${v}.${p}`),
      ),
      'variants.first',
      'variants.last',
    ]
    expect(names).toHaveLength(20)
    for (const name of names) expect(Object.keys(en.history.setting)).toContain(name)
  })
})

describe('formatSavedAt', () => {
  it('writes the suite’s day.month.year and time', () => {
    expect(formatSavedAt('2026-11-10T09:30:00.000Z')).toMatch(/^10\.11\.2026 \d{2}:\d{2}$/)
  })

  it('shows what it was given when that is not a date', () => {
    expect(formatSavedAt('')).toBe('')
    expect(formatSavedAt('yesterday')).toBe('yesterday')
  })
})

describe('classifyRestoreFailure', () => {
  const failure = (status: number, code?: string) => new ApiError({ status, title: 'x', code })

  it('reads a newer version (409) and a lost grant (403, either code)', () => {
    expect(classifyRestoreFailure(failure(409, 'version_conflict'), 2)).toEqual({ kind: 'conflict' })
    expect(classifyRestoreFailure(failure(403, 'forbidden'), 2)).toEqual({ kind: 'lost' })
    expect(classifyRestoreFailure(failure(403, 'out_of_scope'), 2)).toEqual({ kind: 'lost' })
  })

  it('says the layout is gone for 422 unknown_layout', () => {
    expect(classifyRestoreFailure(failure(422, 'unknown_layout'), 2)).toEqual({
      kind: 'failed',
      message: en.restore.unknownLayout,
    })
  })

  it.each([
    ['a version that is not there', failure(404, 'letterhead_version_not_found')],
    ['a busy service', failure(429, 'busy')],
    ['a server error', failure(500)],
    ['an unavailable service', failure(503)],
    ['a 409 that is not a version conflict', failure(409, 'something_else')],
    ['the network', new TypeError('Failed to fetch')],
  ])('says nothing changed and to try again for %s', (_name, error) => {
    expect(classifyRestoreFailure(error, 2)).toEqual({ kind: 'failed', message: en.restore.failed(2) })
  })
})

describe('the copy of the history, the version view and the restore (design § Copy keys)', () => {
  it('words the version banner and the restore as the design does, in both languages', () => {
    expect(en.version.title(2)).toBe('Viewing version 2')
    expect(en.version.body('Ada', '05.11.2026 08:00')).toBe(
      'Saved by Ada on 05.11.2026 08:00. This is not the active version.',
    )
    expect(en.version.back).toBe('Back to the active version')
    expect(en.version.restore).toBe('Restore this version')
    expect(en.restore.title(2)).toBe('Restore version 2?')
    expect(en.restore.body(2, 5, 4)).toBe(
      'This creates version 5 with the same settings and logos as version 2 and makes it the active one. Version 4 and the rest of the history stay as they are.',
    )
    expect(en.restore.done(5, 2)).toBe('Version 5 created from version 2')
    expect(en.restore.conflict).toBe('A newer version was saved meanwhile. Reload the history and try again.')
    expect(en.history.restoredFrom(2)).toBe('Restored from version 2')
    expect(en.history.sameAs(2)).toBe('Same settings as version 2')
    expect(en.history.open(2)).toBe('Open version 2 in the preview')
    expect(en.history.restore(2)).toBe('Restore version 2')
    expect(en.view.settings).toBe('Settings')
    expect(en.view.history).toBe('History')

    expect(italian.version.title(2)).toBe('Visualizzazione della versione 2')
    expect(italian.version.back).toBe('Torna alla versione attiva')
    expect(italian.version.restore).toBe('Ripristina questa versione')
    expect(italian.restore.title(2)).toBe('Ripristinare la versione 2?')
    expect(italian.restore.done(5, 2)).toBe('Creata la versione 5 dalla versione 2')
    expect(italian.history.restoredFrom(2)).toBe('Ripristinata dalla versione 2')
    expect(italian.history.empty).toBe('Nessuna versione')
    expect(italian.view.history).toBe('Cronologia')
  })

  it('every sentence with a number carries it in Italian too, and none is a copy of the English', () => {
    for (const text of [
      italian.restore.body(2, 5, 4),
      italian.restore.confirm(2),
      italian.restore.failed(2),
      italian.history.open(2),
    ]) {
      expect(text).toContain('2')
    }
    expect(italian.restore.body(2, 5, 4)).toContain('5')
    expect(italian.restore.body(2, 5, 4)).toContain('4')
    for (const [name, value] of Object.entries(italian.restore)) {
      if (typeof value === 'string' && name !== 'close')
        expect(value, name).not.toBe(en.restore[name as keyof typeof en.restore])
    }
    for (const [name, value] of Object.entries(italian.version)) {
      if (typeof value === 'string') expect(value, name).not.toBe(en.version[name as keyof typeof en.version])
    }
  })
})
