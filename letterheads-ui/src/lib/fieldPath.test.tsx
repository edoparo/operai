/**
 * @vitest-environment jsdom
 *
 * fieldPath (task T24; design S4, F7.3; plan G3 and its 2026-11-17 amendment): the words for a refused value,
 * the order of the page, and the control a pointer leads to.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { en, it as italian } from '../strings'
import {
  comparePointers,
  describeProblem,
  findControl,
  firstRefusedControl,
  focusControl,
  readProblems,
  whereOf,
} from './fieldPath'
import { catalogFixture, fullConfigFixture } from './formStateFixtures'
import { readCatalog } from './formStateTypes'
import type { Problem } from './formStateTypes'

const catalog = readCatalog(catalogFixture())!

const say = (path: string, reason: string, extra: Partial<Problem> = {}) =>
  describeProblem({ path, reason, ...extra }, catalog)

afterEach(() => cleanup())

describe('readProblems', () => {
  it('reads what the service sent and drops what is not a problem', () => {
    expect(
      readProblems([
        { path: '/margins/top', reason: 'out_of_range' },
        { path: '/a', reason: 'unbalanced_brace', name: '{', language: 'it' },
        { path: 1, reason: 'x' },
        'nope',
        null,
        { reason: 'missing_path' },
      ]),
    ).toEqual([
      { path: '/margins/top', reason: 'out_of_range' },
      { path: '/a', reason: 'unbalanced_brace', name: '{', language: 'it' },
    ])
    expect(readProblems('nope')).toEqual([])
    expect(readProblems(undefined)).toEqual([])
  })
})

describe('whereOf: a pointer in words', () => {
  it.each([
    ['/margins/top', 'top margin'],
    ['/margins/right', 'right margin'],
    ['/fonts/frame', 'header and footer font'],
    ['/look/headings/1/size', 'heading 2, size'],
    ['/look/headings/0/color', 'heading 1, colour'],
    ['/look/body/lineSpacing', 'body text, line spacing'],
    ['/look/table/headerFill', 'table, header row background'],
    ['/look/table/borderColor', 'table, border colour'],
    ['/look/bulletMarker', 'list marker'],
    ['/variants/first', 'first page'],
    ['/variants/default/footer', 'default page, footer'],
    ['/variants/default/header/valign', 'default page, header, alignment'],
    ['/variants/default/header/gapMm', 'default page, header, distance from the body'],
    ['/variants/last/footer/gapMm', 'last page, footer, distance from the body'],
    ['/variants/last/footer/rule/thicknessPt', 'last page, footer, rule, thickness'],
    ['/variants/default/footer/left', 'default page, footer, left zone'],
    ['/variants/first/footer/left/1/text/en', 'first page, footer, left zone, line 2, English text'],
    ['/variants/default/header/center/0/text/it', 'default page, header, centre zone, line 1, Italian text'],
    ['/variants/default/header/right/2/color', 'default page, header, right zone, line 3, colour'],
    ['/variants/default/logo/asset', 'default page, logo, file'],
    ['/variants/default/logo/heightMm', 'default page, logo, height'],
    ['/variants/last/background', 'last page, background image'],
  ])('%s is "%s"', (path, words) => {
    expect(whereOf(path)).toBe(words)
  })

  it('has no words for the whole configuration or for a path it does not know, and never throws', () => {
    for (const path of ['', '/', '/nope', '/margins/nope', '/variants/nope/footer', '/look/headings/x/size']) {
      expect(() => whereOf(path)).not.toThrow()
    }
    expect(whereOf('')).toBe('')
    expect(whereOf('/nope')).toBe('')
    expect(whereOf('/variants/nope/footer')).toBe('')
  })

  it('does not read a prototype member as a setting', () => {
    expect(whereOf('/margins/constructor')).toBe('')
    expect(whereOf('/variants/__proto__')).toBe('')
  })
})

describe('describeProblem: a sentence for each reason of the closed list of eighteen', () => {
  it('names the setting, then says what to do (out_of_range, with the bounds of the setting)', () => {
    const { marginMm, headingSizePt, bodySizePt, lineSpacing, lineSizePt, ruleThicknessPt, logoHeightMm } =
      catalog.bounds
    expect(say('/margins/top', 'out_of_range')).toBe(
      `Top margin: use a number between ${marginMm.min} and ${marginMm.max} mm.`,
    )
    expect(say('/look/headings/0/size', 'out_of_range')).toBe(
      `Heading 1, size: use a number between ${headingSizePt.min} and ${headingSizePt.max} pt.`,
    )
    expect(say('/look/body/size', 'out_of_range')).toContain(`${bodySizePt.min} and ${bodySizePt.max} pt`)
    expect(say('/look/body/lineSpacing', 'out_of_range')).toBe(
      `Body text, line spacing: use a number between ${lineSpacing.min} and ${lineSpacing.max}.`,
    )
    expect(say('/variants/default/footer/left/0/size', 'out_of_range')).toContain(
      `${lineSizePt.min} and ${lineSizePt.max} pt`,
    )
    expect(say('/variants/first/header/rule/thicknessPt', 'out_of_range')).toContain(
      `${ruleThicknessPt.min} and ${ruleThicknessPt.max} pt`,
    )
    expect(say('/variants/default/logo/heightMm', 'out_of_range')).toContain(
      `${logoHeightMm.min} and ${logoHeightMm.max} mm`,
    )
    expect(say('/variants/default/header/gapMm', 'out_of_range')).toBe(
      'Default page, header, distance from the body: use a number between 0 and 40 mm.',
    )
    expect(say('/variants/first/footer/gapMm', 'not_a_number')).toContain('footer, distance from the body')
  })

  it('falls back to the generic sentence for an out-of-range value it has no bounds for', () => {
    expect(say('/fonts/body', 'out_of_range')).toBe('Body text font: this value was refused.')
  })

  it('says each of the other reasons in words, in the place the design fixes', () => {
    expect(say('/margins/left', 'not_a_number')).toBe('Left margin: enter a number.')
    expect(say('/look/table/headerFill', 'bad_colour')).toBe(
      'Table, header row background: use six hexadecimal digits, for example e50339.',
    )
    expect(say('/fonts/body', 'unknown_font')).toBe('Body text font: choose one of the listed fonts.')
    expect(say('/variants/default/footer/left/1/text/en', 'unknown_placeholder', { name: 'foo' })).toBe(
      'Default page, footer, left zone, line 2, English text: uses {foo}, which is not a placeholder. The placeholders are listed in the help above.',
    )
    expect(say('/x', 'unknown_placeholder')).toContain('a name that is not a placeholder')
    expect(say('/variants/default/footer/left/0/text/it', 'unbalanced_brace', { name: '{' })).toContain(
      'a brace is not closed. Write {{ or }} to print a brace.',
    )
    expect(say('/variants/default/footer/left/0/text/it', 'segment_no_placeholder')).toContain(
      'a segment in square brackets must contain a placeholder.',
    )
    expect(say('/variants/default/footer/left/0/text/it', 'segment_nested')).toContain('cannot contain another one')
    expect(say('/variants/default/footer/left', 'too_many_lines')).toBe(
      `Default page, footer, left zone: a zone holds up to ${catalog.bounds.maxLinesPerZone} lines.`,
    )
    expect(say('/variants/default/header/center/0/text/en', 'language_missing', { language: 'en' })).toBe(
      'Default page, header, centre zone, line 1, English text: filled in one language but empty in English. Fill in both.',
    )
    expect(say('/margins/left', 'body_too_small', { name: 'left' })).toBe(
      `Left margin: the body area would be smaller than ${catalog.bounds.bodyMinWidthMm} × ${catalog.bounds.bodyMinHeightMm} mm. Reduce the margins.`,
    )
    expect(say('/variants/default/header', 'header_overflow')).toBe(
      `Default page, header: it does not fit the top margin, checked with every placeholder replaced by ${catalog.bounds.fitTestValueChars} characters. Raise the top margin, shorten the text, use fewer lines or reduce its distance from the body.`,
    )
    expect(say('/variants/last/footer', 'footer_overflow')).toContain('does not fit the bottom margin')
    // A header with a logo: the logo's height is named, since it is the likely cause (often the only thing there).
    const withLogo = fullConfigFixture()
    withLogo.variants.default.logo = { asset: 'a', position: 'left', heightMm: 20 }
    withLogo.variants.default.header.left = []
    expect(describeProblem({ path: '/variants/default/header', reason: 'header_overflow' }, catalog, withLogo)).toBe(
      'Default page, header: the logo (20 mm high) and the header lines do not fit the top margin. Raise the top margin, lower the logo, use fewer lines or reduce the header’s distance from the body.',
    )
    withLogo.variants.default.logo = null
    expect(
      describeProblem({ path: '/variants/default/header', reason: 'header_overflow' }, catalog, withLogo),
    ).toContain('shorten the text')
    expect(say('/variants/default/logo/asset', 'asset_unknown')).toBe(
      'Default page, logo, file: this image is no longer available. Upload it again.',
    )
  })

  it('has its own sentence for a bracket, not the brace one (amendment 2026-11-17)', () => {
    const bracket = say('/variants/default/footer/left/0/text/it', 'unbalanced_bracket', { name: '[' })
    const brace = say('/variants/default/footer/left/0/text/it', 'unbalanced_brace', { name: '{' })
    expect(bracket).toContain('square bracket')
    expect(bracket).toContain('[[ or ]]')
    expect(bracket).not.toContain('brace')
    expect(bracket).not.toBe(brace)
    // The sentence is chosen by `reason` alone: the `name` of a bracket changes nothing.
    expect(say('/a', 'unbalanced_bracket', { name: ']' })).toBe(say('/a', 'unbalanced_bracket', { name: '[' }))
  })

  it('uses the generic sentence for the three shape reasons and for a reason it does not know, never a code', () => {
    for (const reason of ['wrong_type', 'missing_member', 'unknown_member', 'from_the_future', '']) {
      const sentence = say('/margins/top', reason)
      expect(sentence).toBe('Top margin: this value was refused.')
      expect(sentence).not.toContain(reason === '' ? '\u0000' : reason)
    }
  })

  it('says the sentence alone for a value with no name of its own (the whole configuration)', () => {
    expect(say('', 'asset_unknown')).toBe('This image is no longer available. Upload it again.')
    expect(say('', 'wrong_type')).toBe('This value was refused.')
  })

  it('has every sentence in Italian too, with the same shape', () => {
    const reasons = Object.keys(en.problem.reason) as (keyof typeof en.problem.reason)[]
    expect(Object.keys(italian.problem.reason).sort()).toEqual([...reasons].sort())
    expect(italian.problem.reason.out_of_range(5, 100, 'mm')).toBe('Usa un numero tra 5 e 100 mm.')
    expect(italian.problem.reason.unbalanced_bracket).not.toBe(italian.problem.reason.unbalanced_brace)
    expect(italian.where.zone.center).toBe('zona centrale')
  })
})

describe('comparePointers: the page order', () => {
  it('puts the members of the configuration in the order the page shows them', () => {
    const shuffled = [
      '/variants/default/footer/left/0/text/en',
      '/margins/top',
      '/variants/last/background',
      '/look/headings/2/color',
      '/variants/default/footer',
      '/fonts/body',
      '/variants/default/footer/left/10/text/it',
      '/variants/default/footer/left/2/text/it',
      '/variants/first/header/valign',
      '/margins/right',
      '/look/bulletMarker',
      '/variants/default/logo/heightMm',
      '/variants/default/header/rule/color',
    ]
    expect([...shuffled].sort(comparePointers)).toEqual([
      '/margins/top',
      '/margins/right',
      '/fonts/body',
      '/look/headings/2/color',
      '/look/bulletMarker',
      '/variants/default/header/rule/color',
      '/variants/default/footer',
      '/variants/default/footer/left/0/text/en',
      '/variants/default/footer/left/2/text/it',
      '/variants/default/footer/left/10/text/it',
      '/variants/default/logo/heightMm',
      '/variants/first/header/valign',
      '/variants/last/background',
    ])
  })

  it('puts a group before what is inside it, and unknown names after the known ones', () => {
    expect(comparePointers('/variants/default/footer', '/variants/default/footer/left')).toBeLessThan(0)
    expect(comparePointers('/variants/default/footer/left', '/variants/default/footer/zzz')).toBeLessThan(0)
    expect(comparePointers('/margins/top', '/margins/top')).toBe(0)
    expect(comparePointers('', '/margins/top')).toBeLessThan(0)
  })

  it('orders the leaves of a full configuration as their controls follow one another (the page test checks it against the real form)', () => {
    const leaves: string[] = []
    const walk = (value: unknown, at: string) => {
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${at}/${index}`))
      else if (typeof value === 'object' && value !== null)
        Object.entries(value).forEach(([key, child]) => walk(child, `${at}/${key}`))
      else leaves.push(at)
    }
    walk(fullConfigFixture(), '')
    const ordered = [...leaves].sort(comparePointers)
    const at = (path: string) => ordered.indexOf(path)
    expect(at('/margins/top')).toBeLessThan(at('/margins/bottom'))
    expect(at('/margins/bottom')).toBeLessThan(at('/margins/left'))
    expect(at('/margins/left')).toBeLessThan(at('/margins/right'))
    expect(at('/margins/right')).toBeLessThan(at('/fonts/body'))
    expect(at('/fonts/frame')).toBeLessThan(at('/look/headings/0/size'))
    expect(at('/look/body/lineSpacing')).toBeLessThan(at('/look/table/headerFill'))
    expect(at('/look/bulletMarker')).toBeLessThan(at('/variants/default/header/valign'))
    // The distance sits under the alignment and above the rule, as its control does.
    expect(at('/variants/default/header/valign')).toBeLessThan(at('/variants/default/header/gapMm'))
    expect(at('/variants/default/header/gapMm')).toBeLessThan(at('/variants/default/header/rule/show'))
    expect(at('/variants/default/footer/right/0/color')).toBeLessThan(at('/variants/default/logo/asset'))
    expect(at('/variants/default/background')).toBeLessThan(at('/variants/first/header/valign'))
  })
})

describe('findControl: a pointer to a control', () => {
  const page = () =>
    render(
      <div>
        <input data-pointer="/margins/top" />
        <input data-pointer="/margins/bottom" disabled />
        <div data-frame="/variants/default/footer">
          <input type="radio" data-pointer="/variants/default/footer/valign" />
          <fieldset data-zone="/variants/default/footer/left">
            <input data-pointer="/variants/default/footer/left/0/text/it" />
            <button type="button">Add a line</button>
          </fieldset>
          <fieldset data-zone="/variants/default/footer/center">
            <button type="button">Add centre</button>
          </fieldset>
        </div>
        <input data-pointer="/variants/default/logo/asset" />
      </div>,
    ).container

  it('finds the control that carries the pointer', () => {
    const root = page()
    expect(findControl(root, '/margins/top')).toBe(root.querySelector('[data-pointer="/margins/top"]'))
    expect(findControl(root, '/variants/default/footer/left/0/text/it')).not.toBeNull()
  })

  it('goes to the first control of a frame or a zone for a refusal of the group', () => {
    const root = page()
    expect(findControl(root, '/variants/default/footer')).toBe(
      root.querySelector('[data-pointer="/variants/default/footer/valign"]'),
    )
    expect(findControl(root, '/variants/default/footer/left')).toBe(
      root.querySelector('[data-pointer="/variants/default/footer/left/0/text/it"]'),
    )
    expect(findControl(root, '/variants/default/footer/center')?.textContent).toBe('Add centre')
  })

  it('goes up to the nearest ancestor that has a control when the value itself has none, and to nothing at the top', () => {
    const root = page()
    // A rule that is off has no thickness control: the frame's first control is the way in.
    expect(findControl(root, '/variants/default/footer/rule/thicknessPt')).toBe(
      root.querySelector('[data-pointer="/variants/default/footer/valign"]'),
    )
    expect(findControl(root, '')).toBeNull()
    expect(findControl(root, '/look/headings/0/size')).toBeNull()
    expect(findControl(root, '/nowhere/at/all')).toBeNull()
  })

  it('skips a disabled control of a group, and treats the pointer as text, not as a selector', () => {
    const root = page()
    expect(findControl(root, '/margins/bottom')).toBe(root.querySelector('[data-pointer="/margins/bottom"]'))
    expect(() => findControl(root, '/a"]/[b')).not.toThrow()
  })

  it('picks the first refused control in page order, whatever order the service listed them in', () => {
    const root = page()
    const control = firstRefusedControl(root, [
      { path: '/variants/default/logo/asset', reason: 'asset_unknown' },
      { path: '/nowhere', reason: 'wrong_type' },
      { path: '/variants/default/footer/left/0/text/it', reason: 'unbalanced_brace' },
      { path: '/margins/top', reason: 'out_of_range' },
    ])
    expect(control).toBe(root.querySelector('[data-pointer="/margins/top"]'))
    expect(firstRefusedControl(root, [{ path: '/nowhere', reason: 'wrong_type' }])).toBeNull()
    expect(firstRefusedControl(root, [])).toBeNull()
  })

  it('moves focus to the control and scrolls it into view, where the browser can', () => {
    const root = page()
    const control = root.querySelector<HTMLElement>('[data-pointer="/margins/top"]')!
    let scrolled: unknown = null
    control.scrollIntoView = ((options: unknown) => {
      scrolled = options
    }) as typeof control.scrollIntoView
    focusControl(control)
    expect(document.activeElement).toBe(control)
    expect(scrolled).toEqual({ block: 'center', behavior: 'auto' })
    // jsdom has no scrollIntoView: a control without it is still focused.
    const other = root.querySelector<HTMLElement>('[data-pointer="/variants/default/logo/asset"]')!
    expect(() => focusControl(other)).not.toThrow()
    expect(document.activeElement).toBe(other)
  })
})
