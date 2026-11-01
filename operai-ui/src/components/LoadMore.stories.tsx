import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { ListRows, listRowClassName, listRowMetaClassName } from './ListRows'
import { LoadMore } from './LoadMore'
import { ITEMS } from '../pages/fixtures'
import { ItemStatusBadge } from '../pages/catalogue'

/**
 * Appends the next page of a CURSOR endpoint (no total, no jumping). While a
 * page is in flight the button is busy and inert; when it arrives a polite
 * announcement says how many were added. A failed load is recoverable — the
 * same button retries — so its message uses the warning tone. With no next
 * cursor the button disappears.
 */
const meta = {
  title: 'Components/Data/LoadMore',
  component: LoadMore,
  tags: ['autodocs'],
  args: {
    hasMore: true,
    loading: false,
    label: 'Load more items',
    loadingLabel: 'Loading more…',
    announcement: '',
    error: null,
    onLoadMore: fn(),
  },
} satisfies Meta<typeof LoadMore>
export default meta

type Story = StoryObj<typeof meta>

export const Idle: Story = {}

export const Loading: Story = { args: { loading: true } }

export const LoadError: Story = {
  name: 'Load failed',
  args: { error: 'The next items could not be loaded. Try again.' },
}

/** No next cursor: nothing to show (the announcement region stays for the last message). */
export const NoMore: Story = {
  name: 'Nothing more',
  args: { hasMore: false, announcement: '5 more items loaded' },
}

const PAGE = 4

function LiveDemo() {
  const [count, setCount] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const attempts = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const total = 14
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <ListRows label="Items">
        {ITEMS.slice(0, count).map((item) => (
          <a key={item.id} href={`#${item.id}`} className={listRowClassName}>
            <span className="text-sm">{item.name}</span>
            <span className="flex items-center gap-3">
              <span className={listRowMetaClassName}>{item.code}</span>
              <ItemStatusBadge status={item.status} />
            </span>
          </a>
        ))}
      </ListRows>
      <LoadMore
        hasMore={count < total}
        loading={loading}
        error={error}
        announcement={announcement}
        label="Load more items"
        loadingLabel="Loading more…"
        onLoadMore={() => {
          setLoading(true)
          setError(null)
          attempts.current += 1
          timer.current = window.setTimeout(() => {
            setLoading(false)
            // The second attempt fails, to show the retry.
            if (attempts.current === 2) {
              setError('The next items could not be loaded. Try again.')
              return
            }
            const added = Math.min(PAGE, total - count)
            setCount(count + added)
            setAnnouncement(`${added} more items loaded`)
          }, 900)
        }}
      />
    </div>
  )
}

/** Live, with latency: the second load fails once, then the same button retries. */
export const Live: Story = {
  name: 'Live (with a failure)',
  parameters: { controls: { disable: true } },
  render: () => <LiveDemo />,
}
