/**
 * @vitest-environment jsdom
 *
 * Owner D19 (specs/20261115-crm-offer-wizard): at >= 1280 px the preview pane is fully visible without scrolling the
 * page, scrolls inside itself, and keeps its wheel and keys to itself. jsdom has no layout, so this is the CLASS CONTRACT
 * (what makes the browser behave so) and the arithmetic of the height with the geometry faked; the browser run is in
 * the QE report. The shell's `<main>` is the scroller, with the action bar `sticky bottom-0` inside it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'
import { initialAnswers, type WizardContext } from '../../lib/offerEngine/answers'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import answerVectors from '../../lib/offerEngine/vectors/answers.json'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const context = answerVectors.context as unknown as WizardContext
const { ast } = parseTemplate(['@@salutation S', '@@acceptance C', '', '## UNO', '@@step scope', 'Testo.'].join('\n'))
const answers = initialAnswers(ast, context)

const region = () => screen.getByTestId('crm-wizard-preview')

describe('the preview region keeps its scrolling to itself', () => {
  it('scrolls inside itself, contains its overscroll and positions its own screen-reader text', () => {
    render(<DocumentPreview ast={ast} answers={answers} context={context} fit />)
    const classes = region().className.split(' ')
    // `relative` holds the paper's absolutely positioned screen-reader text inside the region: without it the shell's
    // <main> scrolled 2 000 px past the end of the wizard
    expect(classes).toEqual(expect.arrayContaining(['overflow-auto', 'overscroll-contain', 'relative']))
    expect(classes).not.toContain('max-h-[80vh]')
    expect(region().getAttribute('tabindex')).toBe('0')
    expect(region().getAttribute('role')).toBe('region')
  })

  it('without `fit` (the Drawer) it keeps its own CSS bound and sets no height', () => {
    render(<DocumentPreview ast={ast} answers={answers} context={context} heading={false} />)
    expect(region().className).toContain('max-h-[80vh]')
    expect(region().className).toContain('overscroll-contain')
    expect(region().getAttribute('style')).toBeNull()
  })
})

describe('the fitted region ends exactly above the action bar', () => {
  /** A scroller (the shell's main) holding the grid, the sticky pane and the action bar, with faked geometry. */
  function mount(geometry: { gridTop: number }) {
    // read on every call, so a test moves the page by changing `geometry`
    const view = render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <div data-testid="grid">
          <aside data-testid="pane" style={{ position: 'sticky', top: '16px' }}>
            <DocumentPreview ast={ast} answers={answers} context={context} fit />
          </aside>
        </div>
        <div data-wizard-action-bar="" data-testid="bar" />
      </div>,
    )
    const rect = (top: number, height: number) => ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const id = this.getAttribute('data-testid')
      if (id === 'scroller') return rect(50, 650) // viewport 50..700
      if (id === 'bar') return rect(640, 60)
      if (id === 'grid') return rect(geometry.gridTop, 2000)
      // the pane sticks: its top is the pinned place, or the flow place while the page is scrolled above it
      const pane = Math.max(geometry.gridTop, 50 + 16)
      if (id === 'pane') return rect(pane, 600)
      if (id === 'crm-wizard-preview') return rect(pane + 80, 400) // 80 px of heading and note above the region
      return rect(0, 0)
    })
    return view
  }
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

  it('is as tall as the room from its top to the bar (and the gap), at the top of the page', async () => {
    mount({ gridTop: 300 })
    fireEvent.scroll(screen.getByTestId('scroller'))
    await settle()
    // limit 700 (scroller bottom) - bar 60 - gap 16 - region top (300 + 80)
    expect(region().style.height).toBe('244px')
  })

  it('grows as the page scrolls and stops once the pane is pinned, never following the clamped end', async () => {
    const geometry = { gridTop: 300 }
    mount(geometry)
    const scroller = screen.getByTestId('scroller')
    fireEvent.scroll(scroller)
    await settle()
    expect(region().style.height).toBe('244px')
    geometry.gridTop = 150
    fireEvent.scroll(scroller)
    await settle()
    expect(region().style.height).toBe('394px') // 700 - 60 - 16 - (150 + 80)
    geometry.gridTop = -300 // pinned at the scroller's top + 16: 50 + 16 + 80 = 146 -> 478
    fireEvent.scroll(scroller)
    await settle()
    expect(region().style.height).toBe('478px')
    geometry.gridTop = -900 // scrolled further (the pane clamped at its container's end): the same height
    fireEvent.scroll(scroller)
    await settle()
    expect(region().style.height).toBe('478px')
  })

  it('never gets shorter than 160px: a viewport too short for more scrolls the page', async () => {
    mount({ gridTop: 650 })
    fireEvent.scroll(screen.getByTestId('scroller'))
    await settle()
    expect(region().style.height).toBe('160px')
  })
})
