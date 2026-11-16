/**
 * @vitest-environment jsdom
 *
 * The preview on the letterhead (specs/20261115-crm-offer-wizard T65, reworked by T74; AC-11.1 to AC-11.6, AC-11.8,
 * AC-3.2, AC-12.12; DD-56, DD-58, DD-71, DD-72; design D-22 to D-42): the page layer with the letterhead on EVERY page,
 * the one band above the region that tells the letterhead's state, the address notice from the SETTLED resolution, and
 * the same in the Drawer from the page's one attempt. jsdom has no layout and no image decoding: the pages come from an
 * injected layout (`PaginationEnv`: a width and a collector of 100 lines = 3 pages); the rendering is in the browser run.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import DocumentPreview from './DocumentPreview'
import OfferWizard from './OfferWizard'
import type { Letterhead } from './useLetterhead'
import { initialAnswers, sampleContext, type WizardContext } from '../../lib/offerEngine/answers'
import { FlowBuilder } from './paper/flowBuilder'
import { PaginationEnv, type PaginationEnvValue } from './paper/usePagination'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { it as italian, strings } from '../../strings'
import { offerWizard } from '../../strings/offerWizard'

const t = strings.offerWizard

const withAddress = parseTemplate(
  [
    '@@salutation Spettabile',
    '@@acceptance Il Cliente',
    '',
    'Tra [EMITTENTE] e il Cliente.',
    '',
    '## UNO',
    '@@step scope',
    'Testo.',
    '',
    '{{?SEDE::Sede: [SEDE].}}',
    '',
    '@@field EMITTENTE',
    'label: Emittente',
    'source: issuer',
    '',
    '@@field SEDE',
    'label: Sede',
    'source: issuerAddress',
  ].join('\n'),
).ast
const without = parseTemplate(
  ['@@salutation S', '@@acceptance C', '', '## UNO', '@@step scope', 'Testo.'].join('\n'),
).ast

const context: WizardContext = { ...sampleContext('en'), estimate: null }
const noAddress: WizardContext = { ...context, issuerAddressLines: ['', '  '] }

const paper = () => screen.getByRole('region', { name: t.preview.title }).querySelector('article')!
const pages = () => screen.getAllByTestId('crm-wizard-page')
const images = () => screen.queryAllByTestId('crm-wizard-letterhead')

/** 100 lines of 13.5 px on a 488 px pane: three pages. */
const THREE: PaginationEnvValue = {
  width: 488,
  rootFontPx: 16,
  collect: () => {
    const flow = new FlowBuilder(13.5)
    flow.text(100)
    return { items: flow.items, keys: new Map(), painted: [] }
  },
}
const inThree = (node: ReactNode) => <PaginationEnv.Provider value={THREE}>{node}</PaginationEnv.Provider>
const band = () => screen.getByTestId('crm-wizard-letterhead-band')
const notice = () => screen.queryByTestId('crm-wizard-address-notice')
const entity = context.issuerLegalName

function matchMedia(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}
beforeEach(() => matchMedia(false))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const attempt = (state: Letterhead['state'], request: () => void = () => undefined): Letterhead =>
  state === 'shown' ? { state, src: 'blob:test/page', request } : { state, request }

const preview = (
  letterhead: Letterhead | undefined,
  over: Partial<{ ctx: WizardContext; tree: typeof without }> = {},
) => (
  <DocumentPreview
    ast={over.tree ?? without}
    answers={initialAnswers(over.tree ?? without, over.ctx ?? context)}
    context={over.ctx ?? context}
    letterhead={letterhead}
  />
)

describe('the band copy is the spec’s, word for word (AC-11.2 to AC-11.4, delegated M-4)', () => {
  const entity = 'wellD CH'
  it('en', () => {
    expect(t.preview.letterheadShown).toBe(
      'The letterhead is shown on every page. Page breaks are approximate: the PDF is the authority.',
    )
    expect(t.preview.note).toBe('Page breaks are approximate: the PDF is the authority.')
    expect(t.preview.letterhead(entity)).toBe('The letterhead of wellD CH is added in the PDF.')
  })
  it('it', () => {
    const it = offerWizard.it.preview
    expect(it.letterheadShown).toBe(
      'La carta intestata è mostrata su ogni pagina. Le interruzioni di pagina sono approssimative: fa fede il PDF.',
    )
    expect(it.note).toBe('Le interruzioni di pagina sono approssimative: fa fede il PDF.')
    expect(`${italian.offers.errors.letterheadUnusable('X')} ${it.letterheadUnusableTail}`).toBe(
      'La carta intestata di X non può più essere usata. Caricala di nuovo nelle Impostazioni CRM. Non si possono generare offerte per questa entità finché non lo fai.',
    )
  })
})

describe('the unusable letterhead (security M-4, AC-11.4 paragraph)', () => {
  it('says that it can no longer be used and that offers cannot be generated, and never "still added in the PDF"', () => {
    render(preview(attempt('unusable')))
    expect(band().getAttribute('data-state')).toBe('unusable')
    expect(band().textContent).toBe(
      `The letterhead of ${entity} can no longer be used. Upload it again in CRM Settings. Offers for this entity cannot be generated until then.`,
    )
    expect(band().textContent).not.toContain('still added')
    // the pages keep their frame and carry no image; nothing is raised
    expect(pages().length).toBeGreaterThan(0)
    expect(images()).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('the band, one paragraph above the paper, by the attempt state (AC-11.2 to AC-11.4; DD-56)', () => {
  it.each([
    ['pending', `${t.preview.letterhead(entity)} ${t.preview.note}`],
    ['shown', t.preview.letterheadShown],
    ['none', `${t.preview.letterheadNone(entity)} ${t.preview.note}`],
    ['failed', `${t.preview.letterheadFailed(entity)} ${t.preview.note}`],
  ] as const)('%s says its own sentence', (state, text) => {
    render(preview(attempt(state)))
    expect(band().getAttribute('data-state')).toBe(state)
    expect(band().textContent).toBe(text)
  })

  it('is plain text: no alert, no live region, no banner, and outside the scrolling region and the paper', () => {
    render(preview(attempt('failed')))
    expect(band().tagName).toBe('P')
    expect(band().getAttribute('role')).toBeNull()
    expect(band().getAttribute('aria-live')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTestId('crm-wizard-preview').contains(band())).toBe(false)
    // a sibling of the region, so the fit hook measures the region from below it (D19)
    expect(band().parentElement).toBe(screen.getByTestId('crm-wizard-preview').parentElement)
    expect(paper().contains(band())).toBe(false)
  })

  it('reserves three lines so the states do not change its height (D-42)', () => {
    render(preview(attempt('pending')))
    expect(band().className).toContain('min-h-14')
    expect(band().className).toContain('text-soft')
  })

  it('uses the entity label the page gives when the legal name is blank (AC-12.7)', () => {
    render(
      <DocumentPreview
        ast={without}
        answers={initialAnswers(without, context)}
        context={{ ...context, issuerLegalName: '' }}
        letterhead={attempt('none')}
        issuerLabel="wellD CH"
      />,
    )
    expect(band().textContent).toContain('No letterhead is set for wellD CH:')
  })

  it('without an attempt (a view that has none yet) keeps the old sentence and note', () => {
    render(preview(undefined))
    expect(band().getAttribute('data-state')).toBe('pending')
    expect(band().textContent).toContain(t.preview.letterhead(entity))
    expect(band().textContent).toContain(t.preview.note)
  })

  it('the old in-paper band is gone: the paper holds only the document', () => {
    render(preview(attempt('pending')))
    expect(paper().textContent).not.toContain(t.preview.letterhead(entity))
    expect(paper().textContent).not.toContain(t.preview.note)
  })
})

describe('the page layer: the letterhead on every page (AC-11.1, AC-11.2, AC-11.5, AC-11.8; DD-71)', () => {
  it('shown: every one of the 3 pages holds one decorative image, the SAME src, none carries a filter, opacity or dark class', () => {
    render(inThree(preview(attempt('shown'))))
    expect(pages()).toHaveLength(3)
    expect(images()).toHaveLength(3)
    for (const page of pages()) {
      const inPage = page.querySelectorAll('img')
      expect(inPage).toHaveLength(1)
      const image = inPage[0]!
      expect(image.getAttribute('src')).toBe('blob:test/page')
      expect(image.getAttribute('alt')).toBe('')
      expect(image.getAttribute('aria-hidden')).toBe('true')
      expect(image.getAttribute('draggable')).toBe('false')
      expect(image.getAttribute('decoding')).toBe('sync')
      for (const name of ['select-none', 'pointer-events-none', 'w-full', 'h-full']) {
        expect(image.className.split(' ')).toContain(name)
      }
      expect(image.className).not.toMatch(/filter|opacity|dark:|blend|invert|brightness|grayscale/)
      expect(page.className).not.toMatch(/filter|opacity|dark:|blend|invert|brightness/)
      expect(page.className).toContain('bg-paper')
      expect(page.className).toContain('border-muted')
    }
  })

  it('the page number: every page, every letterhead state, "N/M" inside the aria-hidden inert layer (D-2)', () => {
    for (const state of ['shown', 'pending', 'failed', 'unusable', 'none'] as const) {
      const view = render(inThree(preview(attempt(state))))
      const numbers = screen.getAllByTestId('crm-wizard-page-number')
      expect(numbers.map((n) => n.textContent)).toEqual(['1/3', '2/3', '3/3'])
      const layer = screen.getByTestId('crm-wizard-pages')
      for (const [index, number] of numbers.entries()) {
        expect(pages()[index]!.contains(number)).toBe(true)
        expect(layer.contains(number)).toBe(true)
        expect(number.className).toContain('text-paper-soft')
        expect(number.className).not.toMatch(/#|\[/)
        expect(parseFloat(number.style.fontSize)).toBeGreaterThan(0)
      }
      // decorative: not exposed to assistive technology, not found by role or accessible text
      expect(layer.getAttribute('aria-hidden')).toBe('true')
      view.unmount()
    }
  })

  it("the letterhead's own number is covered in white, as the PDF paints it, only while the image is shown, one per page", () => {
    const shown = render(inThree(preview(attempt('shown'))))
    const covers = screen.getAllByTestId('crm-wizard-page-number-cover')
    expect(covers).toHaveLength(3)
    for (const [index, cover] of covers.entries()) {
      expect(pages()[index]!.contains(cover)).toBe(true)
      expect(cover.className).toContain('bg-white')
      expect(cover.className).not.toMatch(/#|\[/)
      expect(cover.getAttribute('style')).toContain('left')
      // the cover comes after the image and before the number: it hides the letterhead's, never ours
      const order = Array.from(pages()[index]!.children).map((child) => child.getAttribute('data-testid'))
      expect(order).toEqual(['crm-wizard-letterhead', 'crm-wizard-page-number-cover', 'crm-wizard-page-number'])
    }
    shown.unmount()
    for (const state of ['pending', 'failed', 'unusable', 'none'] as const) {
      const view = render(inThree(preview(attempt(state))))
      expect(screen.queryAllByTestId('crm-wizard-page-number-cover')).toHaveLength(0)
      view.unmount()
    }
  })

  it('the layer is hidden from assistive technology and inert, behind the flow, on a stage that follows the theme', () => {
    render(inThree(preview(attempt('shown'))))
    const layer = screen.getByTestId('crm-wizard-pages')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.hasAttribute('inert')).toBe(true)
    expect(layer.compareDocumentPosition(paper()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('crm-wizard-stage').className).toContain('bg-ink-mid')
    // the pages are light in both themes: paper tokens only
    expect(screen.getByTestId('crm-wizard-stage').outerHTML).not.toMatch(/dark:|invert|brightness|opacity-|mix-blend/)
  })

  it.each(['pending', 'failed', 'unusable', 'none'] as const)(
    '%s: the same 3 pages with their frame, no image',
    (state) => {
      render(inThree(preview(attempt(state))))
      expect(pages()).toHaveLength(3)
      expect(images()).toHaveLength(0)
      expect(screen.getByTestId('crm-wizard-preview').querySelector('img')).toBeNull()
    },
  )

  it('A4 at the page width, a 16 px gap, in every letterhead state (AC-11.2)', () => {
    render(inThree(preview(attempt('shown'))))
    const boxes = pages().map((page) => ({
      top: parseFloat(page.style.top),
      width: parseFloat(page.style.width),
      height: parseFloat(page.style.height),
    }))
    for (const box of boxes) expect(box.height / box.width).toBeCloseTo(297 / 210, 3)
    expect(boxes[1]!.top - (boxes[0]!.top + boxes[0]!.height)).toBeGreaterThanOrEqual(16)
    expect(boxes[2]!.top - (boxes[1]!.top + boxes[1]!.height)).toBeGreaterThanOrEqual(16)
  })

  it('the pages, the flow and the layout are identical whatever the letterhead does (AC-11.4: nothing moves)', () => {
    const shape = (state: Letterhead['state']) => {
      const view = render(inThree(preview(attempt(state))))
      const value = {
        pages: pages().map((page) => page.getAttribute('style')),
        flow: paper().innerHTML,
        stage: screen.getByTestId('crm-wizard-stage').getAttribute('style'),
        layout: screen.getByTestId('crm-wizard-stage').getAttribute('data-layout'),
      }
      view.unmount()
      return value
    }
    const pending = shape('pending')
    expect(shape('shown')).toEqual(pending)
    expect(shape('failed')).toEqual(pending)
    expect(shape('none')).toEqual(pending)
  })

  it('the letterhead arriving does not lay the pages out again; a settled change does (AC-11.4, AC-11.8)', () => {
    vi.useFakeTimers()
    const view = render(inThree(preview(attempt('pending'))))
    const layout = () => screen.getByTestId('crm-wizard-stage').getAttribute('data-layout')
    const before = layout()
    expect(Number(before)).toBeGreaterThan(0)
    view.rerender(inThree(preview(attempt('shown'))))
    expect(layout()).toBe(before)
    view.rerender(inThree(preview(attempt('failed'))))
    expect(layout()).toBe(before)
    view.rerender(inThree(preview(attempt('shown'), { ctx: { ...context, issuerLegalName: 'Other' } })))
    expect(layout()).toBe(before)
    act(() => void vi.advanceTimersByTime(250))
    expect(Number(layout())).toBeGreaterThan(Number(before))
  })

  it('a page that appears or goes keeps the one image: 1 -> 3 -> 2 pages, always the same src on every page', () => {
    const lines = { current: 5 }
    const env: PaginationEnvValue = {
      width: 488,
      rootFontPx: 16,
      collect: () => {
        const flow = new FlowBuilder(13.5)
        flow.text(lines.current)
        return { items: flow.items, keys: new Map(), painted: [] }
      },
    }
    const tree = (letterheadState: Letterhead['state']) => (
      <PaginationEnv.Provider value={env}>{preview(attempt(letterheadState))}</PaginationEnv.Provider>
    )
    vi.useFakeTimers()
    const view = render(tree('shown'))
    expect(pages()).toHaveLength(1)
    const srcs = () => new Set(images().map((image) => image.getAttribute('src')))
    expect(srcs()).toEqual(new Set(['blob:test/page']))
    for (const [count, expected] of [
      [100, 3],
      [60, 2],
    ] as const) {
      lines.current = count
      view.rerender(
        <PaginationEnv.Provider value={env}>
          {preview(attempt('shown'), { ctx: { ...context, issuerLegalName: `N${count}` } })}
        </PaginationEnv.Provider>,
      )
      act(() => void vi.advanceTimersByTime(250))
      expect(pages()).toHaveLength(expected)
      expect(images()).toHaveLength(expected)
      expect(srcs()).toEqual(new Set(['blob:test/page']))
    }
  })

  it('adds no tab stop: the region stays the only focusable element of the preview', () => {
    render(inThree(preview(attempt('shown'))))
    const focusable = screen
      .getByTestId('crm-wizard-preview')
      .parentElement!.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')
    expect(Array.from(focusable)).toEqual([screen.getByTestId('crm-wizard-preview')])
  })

  it('the text stays real text in the document, found whatever the letterhead does', () => {
    render(preview(attempt('shown')))
    expect(paper().textContent).toContain('Testo.')
  })
})

describe('asking for the letterhead (AC-11.8; D-32)', () => {
  it('a mounted preview asks once, on mount, and never again on re-render', () => {
    const request = vi.fn()
    const view = render(preview(attempt('pending', request)))
    expect(request).toHaveBeenCalledTimes(1)
    view.rerender(preview(attempt('pending', request)))
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('the address notice (AC-12.12; DD-58; G16)', () => {
  it('appears when the printed text reads the address and the profile has none', () => {
    render(preview(attempt('shown'), { ctx: noAddress, tree: withAddress }))
    const banner = notice()!
    expect(banner.textContent).toBe(t.preview.addressNotice(entity))
    expect(banner.getAttribute('role')).toBe('note')
    expect(banner.getAttribute('aria-live')).toBeNull()
    expect(banner.getAttribute('aria-label')).toBe(t.preview.addressNoticeLabel)
    expect(banner.querySelector('button')).toBeNull()
    expect(banner.className).toContain('banner-warning')
    expect(banner.className).toContain('banner-compact')
    // under the band, above the region, outside both
    const region = screen.getByTestId('crm-wizard-preview')
    expect(banner.parentElement).toBe(region.parentElement)
    expect(band().compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(banner.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is absent when the profile has an address', () => {
    render(preview(attempt('shown'), { ctx: context, tree: withAddress }))
    expect(notice()).toBeNull()
  })

  it('is absent when the template does not print the address, even with none set', () => {
    render(preview(attempt('shown'), { ctx: noAddress, tree: without }))
    expect(notice()).toBeNull()
  })

  it('is absent when no address line is given at all and the text does not read it, and says nothing about a blank name', () => {
    render(preview(attempt('shown'), { ctx: { ...noAddress, issuerLegalName: '' }, tree: without }))
    expect(notice()).toBeNull()
  })

  it('follows the settled text: it appears and goes with the document, 250 ms after the change', () => {
    vi.useFakeTimers()
    const view = render(preview(attempt('shown'), { ctx: context, tree: withAddress }))
    expect(notice()).toBeNull()
    view.rerender(preview(attempt('shown'), { ctx: noAddress, tree: withAddress }))
    // the paper has not caught up, so neither has the notice
    expect(notice()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(notice()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(notice()).not.toBeNull()
  })

  it('names the entity by the label the page gives when the legal name is blank', () => {
    render(
      <DocumentPreview
        ast={withAddress}
        answers={initialAnswers(withAddress, noAddress)}
        context={{ ...noAddress, issuerLegalName: '' }}
        letterhead={attempt('shown')}
        issuerLabel="wellD CH"
      />,
    )
    expect(notice()!.textContent).toBe(t.preview.addressNotice('wellD CH'))
  })

  it('the offer stays editable: the notice is not a missing field', () => {
    render(preview(attempt('shown'), { ctx: noAddress, tree: withAddress }))
    expect(screen.queryByText(t.preview.missingBadge(1))).toBeNull()
  })
})

describe('in the wizard, with the Drawer (AC-11.6; D-32)', () => {
  function Wizard({ wide, letterhead }: { wide: boolean; letterhead: Letterhead }) {
    matchMedia(wide)
    const tree = useMemo(() => withAddress, [])
    const [answers, setAnswers] = useState(() => initialAnswers(tree, noAddress))
    return (
      <OfferWizard
        mode="sample"
        ast={tree}
        answers={answers}
        onAnswersChange={setAnswers}
        context={noAddress}
        step="scope"
        onStepChange={() => undefined}
        letterhead={letterhead}
      />
    )
  }

  it('the inline pane shows the letterhead, the band and the notice', () => {
    render(<Wizard wide letterhead={attempt('shown')} />)
    expect(images().length).toBeGreaterThan(0)
    expect(band().getAttribute('data-state')).toBe('shown')
    expect(notice()).not.toBeNull()
  })

  it('the Drawer shows the same paper, band and notice from the same attempt, and asks only through it', () => {
    const request = vi.fn()
    render(<Wizard wide={false} letterhead={attempt('shown', request)} />)
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: t.bar.preview }))
    const drawer = screen.getByRole('dialog', { name: t.preview.drawerTitle })
    expect(within(drawer).getAllByTestId('crm-wizard-letterhead')[0]!.tagName).toBe('IMG')
    expect(within(drawer).getByTestId('crm-wizard-letterhead-band').getAttribute('data-state')).toBe('shown')
    expect(within(drawer).getByTestId('crm-wizard-address-notice')).not.toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('a failed attempt reads the same in the Drawer', () => {
    render(<Wizard wide={false} letterhead={attempt('failed')} />)
    fireEvent.click(screen.getByRole('button', { name: t.bar.preview }))
    const drawer = screen.getByRole('dialog', { name: t.preview.drawerTitle })
    expect(within(drawer).getByTestId('crm-wizard-letterhead-band').textContent).toContain(
      t.preview.letterheadFailed(noAddress.issuerLegalName),
    )
    expect(within(drawer).queryAllByTestId('crm-wizard-letterhead')).toHaveLength(0)
    expect(within(drawer).getAllByTestId('crm-wizard-page').length).toBeGreaterThan(0)
  })
})
