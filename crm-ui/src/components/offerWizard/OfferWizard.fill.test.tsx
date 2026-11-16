/**
 * @vitest-environment jsdom
 *
 * Owner D20 (specs/20261115-crm-offer-wizard): at >= 1280 px the wizard fills the height of the shell's scroller, so the
 * page never scrolls; the form column and the preview pane each scroll inside themselves, while the tabs and the action
 * bar stay in view. jsdom has no layout, so this is the CLASS CONTRACT that makes the browser do it (the run in the
 * browser is the orchestrator's), plus the behaviours that must survive it: a jump to a field still focuses it and
 * asks for it to be scrolled into view, and the pane's pagination reads width alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import OfferWizard from './OfferWizard'
import { focusWizardTarget } from './focusTarget'
import { initialAnswers, sampleContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'

const context = { ...sampleContext('en'), estimate: null }
const { ast } = parseTemplate(
  ['@@salutation S', '', '## UNO', '@@step scope', 'Testo [X].', '', '@@field X', 'label: X'].join('\n'),
)

function mediaQuery(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

function mount(props: { fill?: boolean } = {}) {
  return render(
    <OfferWizard
      mode="sample"
      ast={ast}
      answers={initialAnswers(ast, context)}
      onAnswersChange={() => undefined}
      context={context}
      renderStep={() => <input data-wizard-field="X" aria-label="X field" />}
      {...props}
    />,
  )
}

const classesOf = (id: string) => screen.getByTestId(id).className.split(' ')

beforeEach(() => mediaQuery(true))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a wizard that fills its scroller (wide)', () => {
  it('is a flex column that may shrink to its box, with a grid of one bounded row under the tabs', () => {
    mount({ fill: true })
    expect(classesOf('offer-wizard')).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0', 'flex-1']))
    expect(classesOf('offer-wizard-body')).toEqual(
      expect.arrayContaining(['grid', 'min-h-0', 'flex-1', 'grid-cols-2', 'grid-rows-[minmax(0,1fr)]']),
    )
  })

  it('scrolls the form column on its own and keeps the wheel to it', () => {
    mount({ fill: true })
    expect(classesOf('offer-wizard-form')).toEqual(
      expect.arrayContaining(['min-h-0', 'overflow-y-auto', 'overscroll-contain']),
    )
  })

  // QE D21: every scroller of the layout is the containing block of what is absolutely positioned inside it (the
  // visually-hidden legends and inputs of the form), or that text escapes the clip to the shell frame and lengthens <main>
  it('makes every scroller of the layout positioned (D21)', () => {
    mount({ fill: true })
    for (const id of ['offer-wizard-form']) expect(classesOf(id)).toContain('relative')
    expect(classesOf('offer-wizard-form')).toContain('overflow-y-auto')
    // the preview region is the other scroller; its own test pins it
    expect(screen.getByTestId('crm-wizard-preview').className.split(' ')).toContain('relative')
  })

  it('gives the preview pane a box of its own, not a sticky one, and the region scrolls inside it', () => {
    mount({ fill: true })
    const pane = classesOf('offer-wizard-pane')
    expect(pane).toEqual(expect.arrayContaining(['flex', 'min-h-0', 'flex-col']))
    expect(pane).not.toContain('sticky')
    const region = screen.getByTestId('crm-wizard-preview')
    expect(region.className.split(' ')).toEqual(
      expect.arrayContaining(['overflow-auto', 'overscroll-contain', 'min-h-0', 'flex-1']),
    )
    expect(region.className).not.toContain('max-h-[80vh]')
    // nothing measures: no height is written on it
    expect(region.getAttribute('style')).toBeNull()
  })

  it('keeps the action bar from shrinking away', () => {
    mount({ fill: true })
    expect(classesOf('offer-wizard-action-bar')).toEqual(expect.arrayContaining(['sticky', 'bottom-0', 'shrink-0']))
  })

  it('still lands a jump on the field and asks for it to be scrolled into view inside the form column', () => {
    mount({ fill: true })
    const field = screen.getByLabelText('X field')
    field.scrollIntoView = vi.fn()
    expect(focusWizardTarget(field)).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(field.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
    // the field is inside the column that scrolls, so the browser scrolls that column and not the page
    expect(screen.getByTestId('offer-wizard-form').contains(field)).toBe(true)
  })
})

describe('a wizard that does not fill (the template editor’s Try view)', () => {
  it('keeps the page scrolling and the pane sticky beside the form', () => {
    mount()
    expect(classesOf('offer-wizard')).not.toContain('min-h-0')
    expect(classesOf('offer-wizard-body')).toEqual(expect.arrayContaining(['grid', 'items-start']))
    expect(classesOf('offer-wizard-form')).not.toContain('overflow-y-auto')
    expect(classesOf('offer-wizard-pane')).toContain('sticky')
  })
})

describe('below xl (the Drawer path, and 200 % zoom)', () => {
  it('ignores `fill`: no grid, no inner scrolling, no inline pane', () => {
    mediaQuery(false)
    mount({ fill: true })
    expect(classesOf('offer-wizard')).not.toContain('min-h-0')
    expect(screen.getByTestId('offer-wizard-body').className).toBe('')
    expect(classesOf('offer-wizard-form')).not.toContain('overflow-y-auto')
    expect(screen.queryByTestId('offer-wizard-pane')).toBeNull()
  })
})
