import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon } from './Icon'
import { fn } from 'storybook/test'
import { Button } from './Button'
import { StatePanel } from './StatePanel'

/**
 * What a page shows in place of its content: an empty list, permission
 * denied, not found. A centred heading and body, with at most one way
 * forward. A denial the person did not expect is `role="alert"` and takes
 * focus (`focusOnMount`); an ordinary empty state is neither. Not for errors:
 * a failed load is a warning `Banner` with Retry.
 */
const meta = {
  title: 'Components/Feedback/StatePanel',
  component: StatePanel,
  tags: ['autodocs'],
  args: {
    title: 'No items match these filters',
    children: 'Clear the search or choose another category.',
    headingLevel: 3,
  },
  argTypes: {
    title: { control: 'text' },
    children: { control: 'text' },
    role: { control: 'inline-radio', options: ['status', 'alert'] },
    headingLevel: { control: 'inline-radio', options: [1, 2, 3] },
    action: { control: false },
  },
} satisfies Meta<typeof StatePanel>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Empty: Story = {
  parameters: { controls: { disable: true } },
}

/** First use: one way forward, unless the page header already offers it. */
export const WithAction: Story = {
  name: 'Empty, with an action',
  args: {
    title: 'No items yet',
    children: 'Items you add appear here, with their status and price.',
    action: (
      <Button variant="primary" onClick={fn()}>
        Add the first item
      </Button>
    ),
  },
}

/** Replaces the whole page: an h2 (the page title it stands in for), `role="alert"`, focus on mount. */
export const PermissionDenied: Story = {
  name: 'Permission denied',
  args: {
    title: 'You do not have access to this catalogue',
    children: 'Ask the catalogue owner to give you access, then reload the page.',
    role: 'alert',
    headingLevel: 2,
    focusOnMount: true,
  },
}

export const NotFound: Story = {
  name: 'Not found',
  args: {
    title: 'This item does not exist',
    children: 'It may have been deleted, or the link is wrong.',
    headingLevel: 2,
    focusOnMount: true,
    action: (
      <a href="#items" className="link">
        <Icon name="arrow-left" /> Back to items
      </a>
    ),
  },
}
