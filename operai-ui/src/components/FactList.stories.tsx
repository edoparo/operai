import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './Badge'
import { Card } from './Card'
import { FactList } from './FactList'
import { StatusBadge } from './StatusBadge'
import { formatDate, formatMoney } from '../lib/format'

/**
 * Label/value pairs as a `<dl>` on an auto-filling grid (170px minimum per
 * column), never two wide columns. Usually the content of a detail page's
 * "Details" card. Terms are DM Mono caps; figures in values use `font-mono`.
 */
const meta = {
  title: 'Components/Content/FactList',
  component: FactList,
  tags: ['autodocs'],
  args: {
    items: [
      { id: 'code', term: 'Code', value: 'CAT-0104' },
      { id: 'category', term: 'Category', value: 'Lighting' },
      { id: 'owner', term: 'Owner', value: 'Giulia Bianchi' },
    ],
  },
} satisfies Meta<typeof FactList>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** Rich values: badges, amounts and dates in DM Mono. */
export const RichValues: Story = {
  name: 'Rich values',
  args: {
    items: [
      { id: 'status', term: 'Status', value: <StatusBadge status="active">Available</StatusBadge> },
      { id: 'price', term: 'Price', value: <span className="font-mono">{formatMoney(8900, 'EUR', 'en')}</span> },
      { id: 'currency', term: 'Currency', value: <Badge>EUR</Badge> },
      { id: 'from', term: 'Available from', value: <span className="font-mono">{formatDate('2026-11-15')}</span> },
      { id: 'updated', term: 'Updated', value: <span className="font-mono">{formatDate('2026-10-28')}</span> },
    ],
  },
}

/** Many facts wrap onto as many rows as needed; the grid fills the width. */
export const ManyFacts: Story = {
  name: 'Many facts, in a card',
  render: (args) => (
    <div className="max-w-3xl">
      <Card title="Details">
        <FactList {...args} />
      </Card>
    </div>
  ),
  args: {
    items: [
      { id: 'code', term: 'Code', value: <span className="font-mono">CAT-0104</span> },
      { id: 'category', term: 'Category', value: 'Lighting' },
      { id: 'owner', term: 'Owner', value: 'Giulia Bianchi' },
      { id: 'supplier', term: 'Supplier', value: 'Northwind Workshop' },
      { id: 'weight', term: 'Weight', value: <span className="font-mono">1.8 kg</span> },
      { id: 'size', term: 'Size', value: <span className="font-mono">32 × 18 × 45 cm</span> },
      { id: 'material', term: 'Material', value: 'Oak, brass' },
      { id: 'warranty', term: 'Warranty', value: '2 years' },
    ],
  },
}
