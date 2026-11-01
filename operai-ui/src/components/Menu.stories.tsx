import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Icon } from './Icon'
import { Menu, MenuItem } from './Menu'

/**
 * A button that opens a short list of actions or links — the header's logo
 * and user menus. Opening moves focus to the first item; ↑/↓ move (wrapping),
 * Home/End jump to the ends, Escape closes and returns focus to the trigger,
 * Tab or a click outside closes it, and choosing an item closes it. An action
 * is a `MenuItem`; a link is the router's `<Link role="menuitem"
 * className="menu-item">`. Not for choosing a value (that is a `select` or
 * Combobox) or for page navigation (TabNav).
 */
const meta = {
  title: 'Components/Actions/Menu',
  component: Menu,
  tags: ['autodocs'],
  parameters: { controls: { disable: true }, docs: { story: { inline: false, iframeHeight: 260 } } },
} satisfies Meta<typeof Menu>
export default meta

type Story = StoryObj

const onSelect = fn()

/** An avatar trigger lined up with the right edge, with who is signed in above the items. */
export const UserMenu: Story = {
  name: 'Account menu',
  render: () => (
    <div className="flex justify-end">
      <Menu
        triggerShape="round"
        triggerTitle="Alex Rivera"
        align="end"
        trigger={
          <span
            aria-label="Alex Rivera"
            className="w-7 h-7 rounded-full bg-acc/20 text-acc text-2xs font-bold font-mono flex items-center justify-center border border-acc/30"
          >
            A
          </span>
        }
        header={
          <>
            <div>Alex Rivera</div>
            <div className="menu-header-secondary">alex@example.com</div>
          </>
        }
      >
        <a href="#profile" role="menuitem" className="menu-item">
          My profile
        </a>
        <MenuItem onClick={onSelect}>Sign out</MenuItem>
      </Menu>
    </div>
  ),
}

/** An icon trigger with a single action. */
export const AppMenu: Story = {
  name: 'Icon trigger',
  render: () => (
    <Menu triggerLabel="Catalogue menu" trigger={<Icon name="more" />}>
      <MenuItem onClick={onSelect}>About the catalogue</MenuItem>
      <MenuItem onClick={onSelect}>Keyboard shortcuts</MenuItem>
    </Menu>
  ),
}
