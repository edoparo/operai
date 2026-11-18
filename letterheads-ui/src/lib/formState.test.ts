/**
 * The form's reducer and its helpers (task T21): baseline and dirty, problems keyed by pointer, lines,
 * the first and last page on and off, and the numbers typed into the form (design S1, F6, S4).
 */
import { describe, expect, it } from 'vitest'
import {
  createFormState,
  deepEqual,
  formReducer,
  getAt,
  isDirty,
  limitsFromCatalog,
  numberText,
  parentOf,
  parseNumber,
  pointer,
  problemsAt,
  segmentsOf,
  setAt,
} from './formState'
import type { FormAction, FormState } from './formState'
import { catalogFixture, defaultConfigFixture, fullConfigFixture } from './formStateFixtures'
import { readCatalog } from './formStateTypes'
import type { FormConfig, Problem } from './formStateTypes'

const catalog = readCatalog(catalogFixture())!
const start = (config: FormConfig = defaultConfigFixture()) =>
  createFormState(
    config,
    limitsFromCatalog(catalog.bounds.maxLinesPerZone, catalog.bounds.lineSizePt, catalog.defaultConfig),
  )
const run = (state: FormState, ...actions: FormAction[]) => actions.reduce(formReducer, state)
const problem = (path: string, reason = 'out_of_range'): Problem => ({ path, reason })

describe('JSON Pointer helpers', () => {
  it('builds, splits and escapes a pointer', () => {
    expect(pointer('variants', 'first', 'footer', 'left', 1)).toBe('/variants/first/footer/left/1')
    expect(pointer()).toBe('')
    expect(segmentsOf('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
    expect(segmentsOf('')).toEqual([])
    expect(pointer('a/b', 'c~d')).toBe('/a~1b/c~0d')
    expect(parentOf('/variants/default/footer/left')).toBe('/variants/default/footer')
  })

  it('reads a value, and nothing for a path that does not exist (not even through the prototype)', () => {
    const config = defaultConfigFixture()
    expect(getAt(config, '/margins/top')).toBe(25)
    expect(getAt(config, '/variants/default/footer/left/1/text/it')).toBe('{address}')
    expect(getAt(config, '/margins/nope')).toBeUndefined()
    expect(getAt(config, '/margins/top/x')).toBeUndefined()
    expect(getAt(config, '/__proto__/constructor')).toBeUndefined()
    expect(getAt(config, '/margins/toString')).toBeUndefined()
  })

  it('sets a value in a copy and shares what it did not touch', () => {
    const config = defaultConfigFixture()
    const next = setAt(config, '/variants/default/footer/left/1/size', 9)
    expect(getAt(next, '/variants/default/footer/left/1/size')).toBe(9)
    expect(getAt(config, '/variants/default/footer/left/1/size')).toBe(8)
    expect(next.margins).toBe(config.margins)
    expect(next.variants.default.header).toBe(config.variants.default.header)
    expect(next.variants.default.footer.left[0]).toBe(config.variants.default.footer.left[0])
    expect(Array.isArray(next.variants.default.footer.left)).toBe(true)
  })

  it('does not create a path, and an unchanged value returns the same object', () => {
    const config = defaultConfigFixture()
    expect(setAt(config, '/margins/nope', 1)).toBe(config)
    expect(setAt(config, '/margins/top/deeper', 1)).toBe(config)
    expect(setAt(config, '/variants/default/footer/left/7/size', 1)).toBe(config)
    expect(setAt(config, '/margins/top', 25)).toBe(config)
    expect(setAt(config, '/__proto__/polluted', 1)).toBe(config)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('compares by value, whatever the key order', () => {
    expect(deepEqual(defaultConfigFixture(), defaultConfigFixture())).toBe(true)
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(deepEqual([1], { 0: 1 })).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
    expect(deepEqual(1, '1')).toBe(false)
  })
})

describe('parseNumber: what a person types into a number field', () => {
  it.each([
    ['25', 25],
    ['25.4', 25.4],
    ['25,4', 25.4],
    [' 8 ', 8],
    ['0.1', 0.1],
    ['-5', -5],
    ['10.5', 10.5],
    ['1299.999999', 1299.999999],
  ])('%s is the number %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected)
  })

  it.each(['', 'abc', '12,', '1e3', '1.2.3', '--1', '+5', '12 mm', '0.1234567'])(
    '%j is not a number: it stays as typed, for the service to refuse',
    (text) => {
      expect(parseNumber(text)).toBe(text)
    },
  )

  it('shows a number as its digits and a text as itself', () => {
    expect(numberText(25.4)).toBe('25.4')
    expect(numberText('abc')).toBe('abc')
  })
})

describe('formReducer: baseline and dirty', () => {
  it('starts clean, becomes dirty on an edit and clean again when the value is typed back', () => {
    const initial = start()
    expect(isDirty(initial)).toBe(false)
    const edited = run(initial, { type: 'set', pointer: '/margins/top', value: 30 })
    expect(edited.config.margins.top).toBe(30)
    expect(edited.baseline.margins.top).toBe(25)
    expect(isDirty(edited)).toBe(true)
    expect(isDirty(run(edited, { type: 'set', pointer: '/margins/top', value: 25 }))).toBe(false)
  })

  it('a number typed with a different spelling but the same value is not a change', () => {
    expect(isDirty(run(start(), { type: 'set', pointer: '/margins/top', value: parseNumber('25.0') }))).toBe(false)
  })

  it('keeps the text of a number that is not one, so it is sent as typed', () => {
    const state = run(start(), { type: 'set', pointer: '/margins/top', value: parseNumber('abc') })
    expect(state.config.margins.top).toBe('abc')
    expect(isDirty(state)).toBe(true)
  })

  it('an edit to a value that does not change returns the same state', () => {
    const initial = start()
    expect(formReducer(initial, { type: 'set', pointer: '/margins/top', value: 25 })).toBe(initial)
    expect(formReducer(initial, { type: 'set', pointer: '/nope', value: 1 })).toBe(initial)
  })

  it('loaded replaces the config and the baseline, and forgets the problems and the kept pages', () => {
    let state = run(
      start(),
      { type: 'variantToggled', variant: 'first', on: true },
      { type: 'variantToggled', variant: 'first', on: false },
    )
    state = run(
      state,
      { type: 'problemsSet', problems: [problem('/margins/top')] },
      { type: 'set', pointer: '/margins/left', value: 9 },
    )
    expect(state.kept.first).not.toBeNull()
    const loaded = run(state, { type: 'loaded', config: fullConfigFixture() })
    expect(loaded.config).toBe(loaded.baseline)
    expect(loaded.config.variants.first).not.toBeNull()
    expect(loaded.kept).toEqual({ first: null, last: null })
    expect(loaded.problems).toEqual({})
    expect(isDirty(loaded)).toBe(false)
  })

  it('a version stored without the distance from the body opens with the catalog’s 3 mm, and is not dirty for it', () => {
    const stored = fullConfigFixture() as unknown as {
      variants: Record<'default' | 'first' | 'last', Record<'header' | 'footer', Record<string, unknown>>>
    }
    for (const name of ['default', 'first', 'last'] as const) {
      delete stored.variants[name].header.gapMm
      delete stored.variants[name].footer.gapMm
    }
    const state = start(stored as unknown as FormConfig)
    for (const name of ['default', 'first', 'last'] as const) {
      expect(state.config.variants[name]?.header.gapMm).toBe(3)
      expect(state.config.variants[name]?.footer.gapMm).toBe(3)
    }
    expect(isDirty(state)).toBe(false)
    // The control's pointer now exists, so a change lands.
    const changed = run(state, { type: 'set', pointer: '/variants/first/header/gapMm', value: 7 })
    expect(changed.config.variants.first?.header.gapMm).toBe(7)
    expect(isDirty(changed)).toBe(true)
    // A stored value is kept, and so is an absent first or last page.
    const kept = fullConfigFixture()
    kept.variants.default.header.gapMm = 11
    kept.variants.last = null
    const again = start(kept)
    expect(again.config.variants.default.header.gapMm).toBe(11)
    expect(again.config.variants.last).toBeNull()
    // Loading a version does the same.
    const loaded = run(start(), { type: 'loaded', config: stored as unknown as FormConfig })
    expect(loaded.config.variants.default.footer.gapMm).toBe(3)
    expect(isDirty(loaded)).toBe(false)
  })

  it('a typed distance is held as typed, so the service, not the form, refuses it', () => {
    const state = run(
      start(),
      { type: 'set', pointer: '/variants/default/header/gapMm', value: parseNumber('4,5') },
      { type: 'set', pointer: '/variants/default/footer/gapMm', value: parseNumber('far') },
    )
    expect(state.config.variants.default.header.gapMm).toBe(4.5)
    expect(state.config.variants.default.footer.gapMm).toBe('far')
  })

  it('refuses a catalog that has no bound for the distance (an older service)', () => {
    const old = catalogFixture() as unknown as { bounds: Record<string, unknown> }
    delete old.bounds.gapMm
    expect(readCatalog(old as unknown as ReturnType<typeof catalogFixture>)).toBeNull()
  })

  it('saved makes the form clean without touching what is shown', () => {
    const edited = run(start(), { type: 'set', pointer: '/margins/top', value: 30 })
    const saved = run(edited, { type: 'saved', config: edited.config })
    expect(saved.config).toBe(edited.config)
    expect(isDirty(saved)).toBe(false)
  })
})

describe('formReducer: problems by pointer', () => {
  const problems = [
    problem('/margins/top', 'out_of_range'),
    problem('/margins/top', 'not_a_number'),
    problem('/margins', 'body_too_small'),
    problem('/variants/default/footer', 'footer_overflow'),
    problem('/variants/default/footer/left/1/text/en', 'unknown_placeholder'),
    problem('/variants/default/footer/right/0/color', 'bad_colour'),
  ]

  it('groups the problems of an answer by the pointer they name, several to one pointer', () => {
    const state = run(start(), { type: 'problemsSet', problems })
    expect(problemsAt(state, '/margins/top').map((p) => p.reason)).toEqual(['out_of_range', 'not_a_number'])
    expect(problemsAt(state, '/variants/default/footer/left/1/text/en')).toHaveLength(1)
    expect(problemsAt(state, '/margins/left')).toEqual([])
  })

  it('a new answer replaces every earlier problem, and an empty one clears them', () => {
    const state = run(
      start(),
      { type: 'problemsSet', problems },
      { type: 'problemsSet', problems: [problem('/fonts/body')] },
    )
    expect(Object.keys(state.problems)).toEqual(['/fonts/body'])
    expect(run(state, { type: 'problemsSet', problems: [] }).problems).toEqual({})
  })

  it('editing a value clears its own problems and the problem of the group it is in, not its neighbours', () => {
    let state = run(start(), { type: 'problemsSet', problems })
    state = run(state, { type: 'set', pointer: '/margins/top', value: 40 })
    expect(Object.keys(state.problems).sort()).toEqual([
      '/variants/default/footer',
      '/variants/default/footer/left/1/text/en',
      '/variants/default/footer/right/0/color',
    ])
  })

  it('editing a line of a frame clears the problem of the frame (it does not fit), and its own, but not a sibling line', () => {
    let state = run(start(), { type: 'problemsSet', problems })
    state = run(state, { type: 'set', pointer: '/variants/default/footer/left/1/text/en', value: 'short' })
    expect(Object.keys(state.problems).sort()).toEqual([
      '/margins',
      '/margins/top',
      '/variants/default/footer/right/0/color',
    ])
  })

  it('a problem that is not related to the edit stays', () => {
    const state = run(
      start(),
      { type: 'problemsSet', problems: [problem('/fonts/body')] },
      { type: 'set', pointer: '/margins/top', value: 40 },
    )
    expect(Object.keys(state.problems)).toEqual(['/fonts/body'])
  })
})

describe('formReducer: the lines of a zone', () => {
  const zone = '/variants/default/footer/left'

  it('adds an empty line that copies the look of the zone’s last line', () => {
    const state = run(start(), { type: 'lineAdded', zone })
    const lines = state.config.variants.default.footer.left
    expect(lines).toHaveLength(3)
    expect(lines[2]).toEqual({ text: { it: '', en: '' }, size: 8, bold: false, color: '595c69' })
    expect(isDirty(state)).toBe(true)
  })

  it('an empty zone starts from the look of another zone of the same frame', () => {
    const state = run(start(), { type: 'lineAdded', zone: '/variants/default/footer/center' })
    expect(state.config.variants.default.footer.center).toEqual([
      { text: { it: '', en: '' }, size: 8, bold: false, color: '595c69' },
    ])
  })

  it('a frame with no line at all starts from a line of the page, then of the catalog', () => {
    const header = run(start(), { type: 'lineAdded', zone: '/variants/default/header/left' })
    expect(header.config.variants.default.header.left[0]).toMatchObject({ size: 8, bold: false, color: '595c69' })
    const bare = defaultConfigFixture()
    bare.variants.default.footer = { ...bare.variants.default.footer, left: [], right: [] }
    const nothingToCopy = createFormState(bare, {
      maxLines: 4,
      defaultGapMm: 3,
      fallbackLook: { size: 6, bold: false, color: '000000' },
    })
    const state = run(nothingToCopy, { type: 'lineAdded', zone: '/variants/default/header/left' })
    expect(state.config.variants.default.header.left[0]).toMatchObject({ size: 6, bold: false, color: '000000' })
  })

  it('adds up to the catalog’s limit and no further', () => {
    let state = start()
    for (let n = 0; n < 6; n += 1) state = run(state, { type: 'lineAdded', zone })
    expect(state.config.variants.default.footer.left).toHaveLength(4)
    const before = state
    expect(formReducer(state, { type: 'lineAdded', zone })).toBe(before)
  })

  it('removes the line at an index, and forgets the problems of that zone (the later lines moved up)', () => {
    let state = run(
      start(),
      { type: 'problemsSet', problems: [problem(`${zone}/1/text/en`, 'unknown_placeholder'), problem('/margins/top')] },
      { type: 'lineRemoved', zone, index: 0 },
    )
    expect(state.config.variants.default.footer.left.map((l) => l.text.it)).toEqual(['{address}'])
    expect(Object.keys(state.problems)).toEqual(['/margins/top'])
    state = run(state, { type: 'lineRemoved', zone, index: 0 })
    expect(state.config.variants.default.footer.left).toEqual([])
  })

  it('ignores a remove that names no line, and a zone that does not exist', () => {
    const initial = start()
    expect(formReducer(initial, { type: 'lineRemoved', zone, index: 5 })).toBe(initial)
    expect(formReducer(initial, { type: 'lineRemoved', zone, index: -1 })).toBe(initial)
    expect(formReducer(initial, { type: 'lineRemoved', zone: '/nope', index: 0 })).toBe(initial)
    expect(formReducer(initial, { type: 'lineAdded', zone: '/margins' })).toBe(initial)
  })

  it('adding then removing the line is clean again', () => {
    expect(isDirty(run(start(), { type: 'lineAdded', zone }, { type: 'lineRemoved', zone, index: 2 }))).toBe(false)
  })
})

describe('formReducer: the first and last page (design F6)', () => {
  it('switched on for the first time, a page is a copy of the default page, independent of it', () => {
    let state = run(start(), { type: 'variantToggled', variant: 'first', on: true })
    expect(state.config.variants.first).toEqual(state.config.variants.default)
    expect(state.config.variants.first).not.toBe(state.config.variants.default)
    state = run(state, { type: 'set', pointer: '/variants/first/footer/left/0/text/it', value: 'Prima' })
    expect(state.config.variants.default.footer.left[0].text.it).toBe('{legal_name}')
    state = run(state, { type: 'set', pointer: '/variants/default/footer/left/0/size', value: 11 })
    expect(state.config.variants.first!.footer.left[0].size).toBe(9)
  })

  it('switched off it is null in the config (what is saved) and its settings are kept; on again, they come back as typed', () => {
    let state = run(
      start(),
      { type: 'variantToggled', variant: 'last', on: true },
      { type: 'set', pointer: '/variants/last/footer/left/0/text/it', value: 'Ultima' },
      { type: 'variantToggled', variant: 'last', on: false },
    )
    expect(state.config.variants.last).toBeNull()
    expect(state.kept.last?.footer.left[0].text.it).toBe('Ultima')
    state = run(state, { type: 'variantToggled', variant: 'last', on: true })
    expect(state.config.variants.last?.footer.left[0].text.it).toBe('Ultima')
    expect(state.kept.last).toBeNull()
  })

  it('on and off again with no edit is clean; on is a change', () => {
    const on = run(start(), { type: 'variantToggled', variant: 'first', on: true })
    expect(isDirty(on)).toBe(true)
    expect(isDirty(run(on, { type: 'variantToggled', variant: 'first', on: false }))).toBe(false)
  })

  it('a page the loaded version has can be switched off and on again as it was', () => {
    let state = start(fullConfigFixture())
    const first = state.config.variants.first
    state = run(state, { type: 'variantToggled', variant: 'first', on: false })
    expect(isDirty(state)).toBe(true)
    state = run(state, { type: 'variantToggled', variant: 'first', on: true })
    expect(state.config.variants.first).toEqual(first)
    expect(isDirty(state)).toBe(false)
  })

  it('switching to the state it is already in changes nothing; switching clears the problems under that page', () => {
    const initial = start()
    expect(formReducer(initial, { type: 'variantToggled', variant: 'first', on: false })).toBe(initial)
    const state = run(
      start(fullConfigFixture()),
      { type: 'problemsSet', problems: [problem('/variants/first/footer'), problem('/variants/last/footer')] },
      { type: 'variantToggled', variant: 'first', on: false },
    )
    expect(Object.keys(state.problems)).toEqual(['/variants/last/footer'])
  })
})

describe('readCatalog', () => {
  it('narrows the answer of the service', () => {
    expect(catalog.fonts).toEqual(['DM Sans', 'DM Mono', 'Syne', 'Ubuntu', 'Noto Serif', 'Inter'])
    expect(catalog.bounds.maxLinesPerZone).toBe(4)
    expect(catalog.defaultConfig.variants.default.footer.left).toHaveLength(2)
  })

  it.each(['fonts', 'bounds', 'placeholders', 'escapes', 'defaultConfig', 'layoutVersion'])(
    'is null without %s',
    (member) => {
      const raw: Record<string, unknown> = { ...catalogFixture() }
      delete raw[member]
      expect(readCatalog(raw)).toBeNull()
    },
  )

  it('is null when a bound is missing or not a number, or the answer is the old placeholder', () => {
    const raw = catalogFixture() as Record<string, Record<string, unknown>>
    expect(readCatalog({ ...raw, bounds: { ...raw.bounds, marginMm: { min: 5 } } })).toBeNull()
    expect(readCatalog({ ...raw, bounds: { ...raw.bounds, maxLinesPerZone: '4' } })).toBeNull()
    expect(readCatalog({ fonts: [], placeholders: [] })).toBeNull()
  })
})
