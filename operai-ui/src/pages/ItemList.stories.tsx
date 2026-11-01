import type { Meta, StoryObj } from '@storybook/react-vite'
import { CatalogueApp } from './CatalogueApp'
import type { ListState } from './CatalogueApp'

/**
 * A list page with comparable columns: `PageHeader` with the page's one
 * primary action, a filter `Card`, a `DataTable` whose row header links to
 * the record, and `Pagination`. The page shows exactly one state at a time —
 * pick it with the **state** control:
 *
 * - `loaded`: the content (filter it, page through it, open an item);
 * - `loading`: `SkeletonRows` plus a polite "Loading items…";
 * - `error`: a warning `Banner` with Retry (Retry loads for 1.2s, then succeeds);
 * - `empty`: the first-run `StatePanel` (the header already has "New item");
 * - `forbidden`: `StatePanel role="alert"` as the page's h2, focused on mount.
 *
 * Every link works: open an item, delete it, edit it, create one.
 */
const meta = {
  title: 'Pages/Item list',
  component: CatalogueApp,
  parameters: { frame: 'page' },
  args: { listState: 'loaded' },
  argTypes: {
    listState: {
      name: 'state',
      control: 'inline-radio',
      options: ['loaded', 'loading', 'error', 'empty', 'forbidden'] satisfies ListState[],
    },
    initialRoute: { table: { disable: true } },
    saveOutcome: { table: { disable: true } },
  },
  render: (args) => <CatalogueApp key={args.listState} listState={args.listState} />,
} satisfies Meta<typeof CatalogueApp>
export default meta

type Story = StoryObj<typeof meta>

export const Loaded: Story = {}

export const Loading: Story = { args: { listState: 'loading' } }

export const LoadError: Story = { name: 'Load error', args: { listState: 'error' } }

export const Empty: Story = { name: 'Empty (first run)', args: { listState: 'empty' } }

export const Forbidden: Story = { args: { listState: 'forbidden' } }
