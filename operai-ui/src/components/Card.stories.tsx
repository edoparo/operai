import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button } from './Button'
import { Card } from './Card'
import { FactList } from './FactList'

/**
 * One titled group of related content: a section of a detail page, a filter
 * bar, a composer. A detail page is a column of cards, one per subject. The
 * title is an h3 by default (tool h1 → page h2 → card h3) and names the card's
 * region. The card's own action (a `secondary`, `sm` button) sits right of the
 * title. Never nest cards.
 */
const meta = {
  title: 'Components/Content/Card',
  component: Card,
  tags: ['autodocs'],
  args: {
    title: 'Notes',
    headingLevel: 3,
    children: <p className="text-sm text-soft">Supplier confirmed a new batch for mid-November.</p>,
  },
  argTypes: {
    title: { control: 'text' },
    headingLevel: { control: 'inline-radio', options: [2, 3, 4] },
    children: { control: false },
    action: { control: false },
  },
} satisfies Meta<typeof Card>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const WithAction: Story = {
  name: 'With an action',
  args: {
    title: 'Details',
    action: (
      <Button size="sm" onClick={fn()}>
        Edit details
      </Button>
    ),
    children: (
      <FactList
        items={[
          { id: 'code', term: 'Code', value: <span className="font-mono">CAT-0104</span> },
          { id: 'category', term: 'Category', value: 'Lighting' },
          { id: 'owner', term: 'Owner', value: 'Giulia Bianchi' },
        ]}
      />
    ),
  },
}

/** Without a title the card is a plain panel, e.g. a filter bar. */
export const WithoutTitle: Story = {
  name: 'Without a title',
  args: {
    title: undefined,
    'aria-label': 'Filters',
    children: (
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-soft">
          Search
          <input type="search" placeholder="Name or code" />
        </label>
        <Button size="sm" variant="ghost">
          Clear filters
        </Button>
      </div>
    ),
  },
}

/** A detail page: a column of cards, 16px apart, one per subject. */
export const ColumnOfCards: Story = {
  name: 'A column of cards',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card title="Details">
        <FactList
          items={[
            { id: 'category', term: 'Category', value: 'Lighting' },
            { id: 'price', term: 'Price', value: <span className="font-mono">EUR 89.00</span> },
          ]}
        />
      </Card>
      <Card
        title="Notes"
        action={
          <Button size="sm" onClick={fn()}>
            Add note
          </Button>
        }
      >
        <p className="text-sm text-soft">No notes yet.</p>
      </Card>
    </div>
  ),
}
