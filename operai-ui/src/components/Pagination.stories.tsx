import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Pagination } from './Pagination'
import type { PaginationStatus } from './Pagination'

/**
 * Previous / Next over an OFFSET endpoint that reports a total, with a polite
 * status line ("Page 2 of 5 — showing 26–50 of 112"). At the first and last
 * page the button stays focusable but inert (`aria-disabled`), so keyboard
 * users keep their place. For a cursor endpoint (no total) use `LoadMore`.
 */
const status = ({ page, totalPages, rangeStart, rangeEnd, total }: PaginationStatus) =>
  `Page ${page} of ${totalPages} — showing ${rangeStart}–${rangeEnd} of ${total}`

const meta = {
  title: 'Components/Data/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  args: {
    page: 2,
    pageSize: 25,
    total: 112,
    label: 'Item pages',
    previousLabel: 'Previous',
    nextLabel: 'Next',
    status,
    onPageChange: fn(),
  },
  argTypes: { status: { control: false } },
} satisfies Meta<typeof Pagination>
export default meta

type Story = StoryObj<typeof meta>

function Stateful(props: Parameters<typeof Pagination>[0]) {
  const [page, setPage] = useState(props.page)
  return (
    <Pagination
      {...props}
      page={page}
      onPageChange={(next) => {
        props.onPageChange(next)
        setPage(next)
      }}
    />
  )
}

/** Live: Previous and Next change the page. */
export const Playground: Story = {
  render: (args) => <Stateful key={`${args.page}-${args.pageSize}-${args.total}`} {...args} />,
}

export const FirstPage: Story = {
  name: 'First page',
  args: { page: 1 },
}

export const LastPage: Story = {
  name: 'Last page',
  args: { page: 5 },
}

export const SinglePage: Story = {
  name: 'A single page',
  args: { page: 1, total: 7 },
}
