import { useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from '../components/Banner'
import { Button, buttonClassName } from '../components/Button'
import { PageHeader } from '../components/PageHeader'
import { SkeletonRows } from '../components/Skeleton'
import { StatePanel } from '../components/StatePanel'
import { VisuallyHidden } from '../components/VisuallyHidden'
import { BackLink, CatalogueFrame, ItemsTable, t, useLatency } from './catalogue'
import { ITEMS } from './fixtures'

/**
 * The states a page shows in place of its content, each inside the tool
 * frame. A page shows exactly one at a time: forbidden → loading → failed →
 * empty → loaded. Denials and not-found replace the page and take focus;
 * an empty first run offers one way forward; a failed load is a warning
 * `Banner` with Retry, never a StatePanel.
 */
const meta = {
  title: 'Pages/States gallery',
  parameters: { frame: 'page', controls: { disable: true } },
} satisfies Meta
export default meta

type Story = StoryObj

/** A detail route whose record does not exist: back link, then the StatePanel as the page's h2, focused. */
export const NotFound: Story = {
  name: 'Not found',
  render: () => (
    <CatalogueFrame active="items">
      <div className="flex flex-col gap-2">
        <div>
          <BackLink>{t.detail.back}</BackLink>
        </div>
        <StatePanel title={t.detail.notFoundTitle} headingLevel={2} focusOnMount>
          {t.detail.notFoundBody}
        </StatePanel>
      </div>
    </CatalogueFrame>
  ),
}

/** The person may not see this page: `role="alert"`, the page's h2, focused on mount. */
export const PermissionDenied: Story = {
  name: 'Permission denied',
  render: () => (
    <CatalogueFrame active="items">
      <StatePanel title={t.list.forbiddenTitle} role="alert" headingLevel={2} focusOnMount>
        {t.list.forbiddenBody}
      </StatePanel>
    </CatalogueFrame>
  ),
}

function FirstRunPage() {
  const titleId = useId()
  return (
    <CatalogueFrame active="items">
      <section aria-labelledby={titleId}>
        <PageHeader title={t.list.heading} titleId={titleId} description={t.list.description} />
        <StatePanel
          title={t.list.firstRunTitle}
          action={
            <a href="#new" className={buttonClassName({ variant: 'primary' })}>
              {t.list.firstRunAction}
            </a>
          }
        >
          {t.list.firstRunBody}
        </StatePanel>
      </section>
    </CatalogueFrame>
  )
}

/**
 * Nothing yet: the StatePanel offers the one way forward. (When the page
 * header already has the same action, the panel has none.)
 */
export const FirstRun: Story = {
  name: 'Empty, first run',
  render: () => <FirstRunPage />,
}

function LoadErrorPage() {
  const titleId = useId()
  const later = useLatency()
  const [state, setState] = useState<'error' | 'loading' | 'loaded'>('error')
  const [attempts, setAttempts] = useState(0)
  return (
    <CatalogueFrame active="items">
      <section aria-labelledby={titleId}>
        <PageHeader title={t.list.heading} titleId={titleId} description={t.list.description} />
        {state === 'error' && (
          <Banner
            tone="warning"
            title={t.list.loadErrorTitle}
            onRetry={() => {
              const attempt = attempts + 1
              setAttempts(attempt)
              setState('loading')
              // The first retry fails again; the second succeeds.
              later(1200, () => setState(attempt === 1 ? 'error' : 'loaded'))
            }}
            retryLabel={t.list.retry}
          >
            {t.list.loadError}
          </Banner>
        )}
        {state === 'loading' && (
          <>
            <VisuallyHidden live>{t.list.loading}</VisuallyHidden>
            <SkeletonRows rows={4} actions={0} />
          </>
        )}
        {state === 'loaded' && (
          <div className="flex flex-col gap-3">
            <ItemsTable items={ITEMS.slice(0, 5)} />
            <div>
              <Button size="sm" variant="ghost" onClick={() => {
                  setState('error')
                  setAttempts(0)
                }}>
                Show the error again
              </Button>
            </div>
          </div>
        )}
      </section>
    </CatalogueFrame>
  )
}

/** A failed load: warning Banner with Retry. The first retry fails again, the second loads. */
export const LoadError: Story = {
  name: 'Load error',
  render: () => <LoadErrorPage />,
}
