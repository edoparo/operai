import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Banner } from '../Banner'
import { PagePreview } from './PagePreview'
import type { PagePreviewLabels, PagePreviewState, PreviewPage } from './PagePreview'

afterEach(cleanup)

const labels: PagePreviewLabels = {
  region: 'Preview of the sample document',
  loading: 'Preparing the preview…',
  updating: 'Updating the preview…',
  failed: 'Could not update',
  pageCount: (n) => `${n} ${n === 1 ? 'page' : 'pages'}`,
  pageAlt: (n, m) => `Page ${n} of ${m}`,
}

const pages: PreviewPage[] = [
  { image: 'AAAA', text: 'Offer 2026/1\nDear customer,' },
  { image: 'BBBB', text: 'Terms and conditions' },
  { image: 'CCCC', text: 'Signature' },
]

const view = (state: PagePreviewState, shown: readonly PreviewPage[] = pages, notice?: React.ReactNode) => (
  <PagePreview pages={shown} state={state} labels={labels} lang="en">
    {notice}
  </PagePreview>
)

describe('PagePreview', () => {
  it('draws each page as a figure with the "Page N of M" alt and its text as a figcaption (AC-8.6, AC-10.5)', () => {
    render(view('ready'))
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(3)
    figures.forEach((figure, i) => {
      const img = within(figure).getByRole('img', { name: `Page ${i + 1} of 3` })
      expect(img).toHaveAttribute('src', `data:image/png;base64,${pages[i].image}`)
      expect(img).toHaveAttribute('draggable', 'false')
      const caption = figure.querySelector('figcaption')
      expect(caption).toHaveTextContent(pages[i].text, { normalizeWhitespace: false })
      expect(caption).toHaveClass('visually-hidden')
      expect(caption).toHaveAttribute('lang', 'en')
      expect(caption).toHaveStyle({ whiteSpace: 'pre-line' })
    })
    // The caption is in the accessibility tree (not display:none / aria-hidden): a screen reader reads it.
    expect(screen.getByText('Terms and conditions')).toBeVisible()
    expect(screen.getByText('Terms and conditions').closest('[aria-hidden="true"]')).toBeNull()
  })

  it('is one named region and the single tab stop, busy only while loading or updating', () => {
    const { rerender } = render(view('ready'))
    const region = screen.getByRole('region', { name: 'Preview of the sample document' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveAttribute('aria-busy', 'false')
    expect(document.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(1)
    rerender(view('updating'))
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')
    rerender(view('loading', []))
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')
    rerender(view('failed'))
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false')
  })

  it('has no live region and no alert, in any state', () => {
    for (const state of ['loading', 'ready', 'updating', 'failed', 'blocked'] as const) {
      const { container, unmount } = render(view(state, state === 'loading' ? [] : pages))
      expect(container.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"]')).toBeNull()
      unmount()
    }
  })

  it('keeps the previous pages while updating, with the status row, and shows the count', () => {
    const { rerender } = render(view('ready'))
    rerender(view('updating'))
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    expect(screen.getByTestId('page-preview-status')).toHaveTextContent('Updating the preview…')
    expect(screen.getByText('3 pages')).toBeInTheDocument()
  })

  it('keeps an unchanged page image in the same DOM node, even when pages are added before it', () => {
    const { rerender } = render(view('ready'))
    const [a, b, c] = screen.getAllByRole('img')
    rerender(view('updating', pages))
    expect(screen.getAllByRole('img')).toEqual([a, b, c])

    const inserted: PreviewPage[] = [{ image: 'ZZZZ', text: 'New cover' }, ...pages]
    rerender(view('ready', inserted))
    const after = screen.getAllByRole('img')
    expect(after).toHaveLength(4)
    expect(after.slice(1)).toEqual([a, b, c])
    expect(after[1]).toHaveAttribute('alt', 'Page 2 of 4')

    // One page changes: only that node is replaced.
    rerender(view('ready', [inserted[0], { image: 'YYYY', text: 'Terms v2' }, inserted[2], inserted[3]]))
    const last = screen.getAllByRole('img')
    expect(last[1]).not.toBe(after[1])
    expect([last[0], last[2], last[3]]).toEqual([after[0], after[2], after[3]])
  })

  it('tells two identical pages apart', () => {
    render(view('ready', [pages[0], pages[0]]))
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['Page 1 of 2', 'Page 2 of 2'])
  })

  it('shows the A4 placeholder, never an empty region, while loading, failed or blocked without pages', () => {
    for (const state of ['loading', 'failed', 'blocked'] as const) {
      const { unmount } = render(view(state, []))
      expect(screen.getByTestId('page-preview-placeholder')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.queryByRole('figure')).toBeNull()
      unmount()
    }
    render(view('loading', []))
    expect(screen.getByTestId('page-preview-status')).toHaveTextContent('Preparing the preview…')
  })

  it('shows the previous pages with the notice slot when failed or blocked', () => {
    const { rerender } = render(view('failed', pages, <Banner tone="warning" live="polite">The preview failed.</Banner>))
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    expect(screen.getByTestId('page-preview-status')).toHaveTextContent('Could not update')
    expect(screen.getByRole('status')).toHaveTextContent('The preview failed.') // the consumer's own politeness
    rerender(view('blocked', pages, <Banner tone="warning" live="polite">Not configured.</Banner>))
    expect(screen.getAllByRole('figure')).toHaveLength(3)
    expect(screen.getByRole('status')).toHaveTextContent('Not configured.')
  })

  it('uses the given media type and does not make the pictures selectable', () => {
    render(<PagePreview pages={[{ image: 'AAAA', text: '' }]} state="ready" labels={labels} mediaType="image/webp" />)
    const img = screen.getByRole('img', { name: 'Page 1 of 1' })
    expect(img.getAttribute('src')).toBe('data:image/webp;base64,AAAA')
    expect(img).toHaveClass('select-none')
    expect(screen.getByText('1 page')).toBeInTheDocument()
  })
})

/**
 * axe-core is not a dependency of @operai/ui yet (ENV-FAULT, see the task report): the test loads it when it
 * can be resolved and is skipped, with this reason, when it cannot.
 */
const axeModule = process.env.AXE_CORE_PATH ?? 'axe-core'
type Axe = { run: (node: Element) => Promise<{ violations: { id: string; help: string }[] }> }
const axe: Axe | null = await import(/* @vite-ignore */ axeModule).then(
  (m: { default?: Axe } & Axe) => m.default ?? m,
  () => null,
)

describe.skipIf(!axe)('PagePreview accessibility (axe)', () => {
  it.each(['loading', 'ready', 'updating', 'failed', 'blocked'] as const)('reports no violations when %s', async (state) => {
    const { container } = render(
      view(
        state,
        state === 'loading' ? [] : pages,
        state === 'failed' ? <Banner tone="warning" live="polite">The preview failed.</Banner> : undefined,
      ),
    )
    const { violations } = await axe!.run(container)
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
