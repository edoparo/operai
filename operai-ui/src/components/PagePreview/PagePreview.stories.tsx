import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../Banner'
import { Button } from '../Button'
import { PagePreview } from './PagePreview'
import type { PagePreviewLabels, PreviewPage } from './PagePreview'

/**
 * A stack of page pictures (A4 PNG) for a preview made by a service: the
 * letterhead configurator and the CRM offer wizard. Pair it with
 * `useLatestResult`, which asks for the next preview and keeps the previous
 * one.
 *
 * - **One tab stop.** The region scrolls, is named and carries `aria-busy`
 *   while `loading` or `updating`. It is **not** a live region: the preview
 *   would chatter on every keystroke. Notices go in `children` and choose
 *   their own `Banner live`.
 * - **Page text.** Each page is a `figure`: `img alt="Page N of M"` and a
 *   visually hidden `figcaption` with the page's text as the service returned
 *   it. Pictures cannot be selected or copied.
 * - **Never empty.** `updating`, `failed` and `blocked` keep the pages you
 *   pass (pass the previous ones, not `[]`); with none, an A4 placeholder.
 *   An unchanged page keeps its DOM node, so nothing flickers.
 * - **Paper stays light** in both themes: no filter, opacity or blend.
 * - **Copy** is the app's: every string comes in through `labels`.
 */
const meta = {
  title: 'Components/Feedback/PagePreview',
  component: PagePreview,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PagePreview>
export default meta

type Story = StoryObj<typeof meta>

const labels: PagePreviewLabels = {
  region: 'Preview of the sample document',
  loading: 'Preparing the preview…',
  updating: 'Updating the preview…',
  failed: 'Could not update',
  pageCount: (n) => `${n} ${n === 1 ? 'page' : 'pages'}`,
  pageAlt: (n, m) => `Page ${n} of ${m}`,
}

/** A drawn A4 page, as an SVG data string: stands in for the service's PNG. */
function samplePage(title: string, n: number, m: number): PreviewPage {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 893 1263"><rect width="893" height="1263" fill="#fff"/>` +
    `<rect x="70" y="70" width="240" height="40" fill="#1f2937"/>` +
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="70" y="${220 + i * 36}" width="${700 - (i % 3) * 90}" height="14" fill="#9ca3af"/>`).join('') +
    `<text x="70" y="1200" font-size="22" fill="#374151" font-family="sans-serif">${title} - ${n}/${m}</text></svg>`
  return { image: btoa(svg), text: `${title}\nSample entity S.r.l.\nPage ${n}/${m}` }
}
const SAMPLE: PreviewPage[] = [1, 2, 3].map((n) => samplePage('Offer 2026/001', n, 3))
const wrap = (node: React.ReactNode) => <div className="max-w-[860px]">{node}</div>

export const Ready: Story = {
  args: { pages: SAMPLE, state: 'ready', labels, lang: 'en', className: 'max-h-[70vh]' },
  render: (args) => wrap(<PagePreview {...args} />),
}

export const Loading: Story = {
  args: { pages: [], state: 'loading', labels },
  render: (args) => wrap(<PagePreview {...args} />),
}

/** The previous pages stay; the status row says so. Not announced. */
export const Updating: Story = {
  args: { pages: SAMPLE, state: 'updating', labels, className: 'max-h-[70vh]' },
  render: (args) => wrap(<PagePreview {...args} />),
}

/** The notice is the consumer's `Banner`, polite and non-modal. */
export const Failed: Story = {
  args: { pages: SAMPLE, state: 'failed', labels, className: 'max-h-[70vh]' },
  render: (args) =>
    wrap(
      <PagePreview {...args}>
        <Banner tone="warning" live="polite" onRetry={() => {}} retryLabel="Try again">
          The preview could not be updated. You can keep editing; saving is not affected.
        </Banner>
      </PagePreview>,
    ),
}

/** No pages yet and the service refused: the A4 placeholder stands in. */
export const BlockedWithoutPages: Story = {
  name: 'Blocked, no pages',
  args: { pages: [], state: 'blocked', labels },
  render: (args) =>
    wrap(
      <PagePreview {...args}>
        <Banner tone="warning" live="polite">
          No letterhead is configured for this company.
        </Banner>
      </PagePreview>,
    ),
}

/** Updates keep the scroll position and the DOM node of every unchanged page. */
export const Interactive: Story = {
  parameters: { controls: { disable: true } },
  args: { pages: SAMPLE, state: 'ready', labels },
  render: () => {
    const [pages, setPages] = useState(SAMPLE)
    const [state, setState] = useState<'ready' | 'updating'>('ready')
    const change = () => {
      setState('updating')
      setTimeout(() => {
        setPages([SAMPLE[0], samplePage('Offer 2026/001 (edited)', 2, 3), SAMPLE[2]])
        setState('ready')
      }, 800)
    }
    return wrap(
      <div className="flex flex-col gap-3">
        <Button variant="secondary" onClick={change}>
          Edit page 2
        </Button>
        <PagePreview pages={pages} state={state} labels={labels} className="max-h-[60vh]" />
      </div>,
    )
  },
}
