import type { Meta, StoryObj } from '@storybook/react-vite'
import { CatalogueApp } from './CatalogueApp'

/**
 * A detail page: the back link (a `.link` with an aria-hidden arrow), the
 * title with its `StatusBadge`, the record's actions (Edit is secondary,
 * Delete danger — no primary competes), and `Tabs` for in-page views: the
 * overview is a column of `Card`s (a `FactList` of details, notes with their
 * own card action), the history a `DataTable` in a card. The heading takes
 * focus on arrival. Delete asks for confirmation, is busy for 1.2s, then
 * returns to the list, which confirms the deletion.
 */
const meta = {
  title: 'Pages/Item detail',
  component: CatalogueApp,
  parameters: { frame: 'page', controls: { disable: true } },
} satisfies Meta<typeof CatalogueApp>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { initialRoute: { name: 'detail', id: 'item-1' } },
}

/** An item that needs attention, priced in another currency. */
export const AnotherItem: Story = {
  name: 'Another item',
  args: { initialRoute: { name: 'detail', id: 'item-6' } },
}

/** The record does not exist: the back link stays, the not-found StatePanel is the page's h2 and takes focus. */
export const NotFound: Story = {
  name: 'Not found',
  args: { initialRoute: { name: 'detail', id: 'missing' } },
}
