import { useEffect, useId, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { buttonClassName } from '../components/Button'
import { ListRows, listRowClassName, listRowMetaClassName } from '../components/ListRows'
import { LoadMore } from '../components/LoadMore'
import { PageHeader } from '../components/PageHeader'
import { SkeletonRows } from '../components/Skeleton'
import { VisuallyHidden } from '../components/VisuallyHidden'
import { formatDate } from '../lib/format'
import { CatalogueFrame, ItemStatusBadge, itemPrice, t, useLatency } from './catalogue'
import { ITEMS } from './fixtures'

/**
 * The card-style variant of a list: `ListRows`, where each row is a whole-row
 * link showing a status, a meta line and a figure — for lists with no more
 * than about three comparable columns. It pages with `LoadMore`, the control
 * for a CURSOR endpoint (no total): each load takes 0.9s and is announced
 * politely. With **failSecondLoad** the second load fails once; the same
 * button retries.
 */
type Args = { failSecondLoad: boolean }

const meta: Meta<Args> = {
  title: 'Pages/Card list',
  parameters: { frame: 'page' },
  args: { failSecondLoad: false },
  argTypes: { failSecondLoad: { control: 'boolean' } },
}
export default meta

type Story = StoryObj<Args>

const PAGE = 6

function CardListPage({ failSecondLoad }: Args) {
  const titleId = useId()
  const later = useLatency()
  const [initialLoading, setInitialLoading] = useState(true)
  const [count, setCount] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [attempts, setAttempts] = useState(0)
  useEffect(() => {
    later(700, () => setInitialLoading(false))
  }, [later])

  const loadMore = () => {
    const attempt = attempts + 1
    setAttempts(attempt)
    setLoading(true)
    setError(null)
    later(900, () => {
      setLoading(false)
      if (failSecondLoad && attempt === 2) {
        setError(t.list.loadMoreError)
        return
      }
      const added = Math.min(PAGE, ITEMS.length - count)
      setCount(count + added)
      setAnnouncement(t.list.loadedMore(added))
    })
  }

  return (
    <CatalogueFrame active="items">
      <section aria-labelledby={titleId}>
        <PageHeader
          title={t.list.heading}
          titleId={titleId}
          description={t.list.description}
          actions={
            <a href="#new" className={buttonClassName({ variant: 'primary' })}>
              {t.list.newItem}
            </a>
          }
        />
        {initialLoading ? (
          <>
            <VisuallyHidden live>{t.list.loading}</VisuallyHidden>
            <SkeletonRows rows={4} actions={1} />
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <ListRows label={t.list.caption}>
              {ITEMS.slice(0, count).map((item) => (
                <a key={item.id} href={`#${item.id}`} className={listRowClassName}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium">{item.name}</span>
                      <ItemStatusBadge status={item.status} />
                    </span>
                    <span className={listRowMetaClassName}>
                      <span className="font-mono">{item.code}</span> · {item.category} ·{' '}
                      {t.list.updated(formatDate(item.updated))}
                    </span>
                  </span>
                  <span className="font-mono text-sm">{itemPrice(item)}</span>
                </a>
              ))}
            </ListRows>
            <LoadMore
              hasMore={count < ITEMS.length}
              loading={loading}
              error={error}
              announcement={announcement}
              label={t.list.loadMore}
              loadingLabel={t.list.loadingMore}
              onLoadMore={loadMore}
            />
          </div>
        )}
      </section>
    </CatalogueFrame>
  )
}

export const Default: Story = {
  render: (args) => <CardListPage key={String(args.failSecondLoad)} {...args} />,
}

export const SecondLoadFails: Story = {
  name: 'Second load fails',
  args: { failSecondLoad: true },
  render: (args) => <CardListPage key={String(args.failSecondLoad)} {...args} />,
}
