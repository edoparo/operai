import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { Button, buttonClassName } from './Button'
import { Icon } from './Icon'

/**
 * Every button is `.btn` plus exactly one variant, chosen by meaning:
 * `primary` for the one main action of a view, `secondary` for any other,
 * `ghost` for cancel/close and low-emphasis actions, `danger` for anything
 * destructive or irreversible. Labels are sentence case, verb first, with no
 * glyph prefix. `buttonClassName()` gives the same look to a router link that
 * is an action entry point.
 */
const meta = {
  title: 'Components/Actions/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save item', variant: 'secondary', size: 'md', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['md', 'sm'] },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Button>
export default meta

type Story = StoryObj<typeof meta>

export const Playground: Story = {}

const row = 'flex flex-wrap items-center gap-2'

export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className={row}>
      <Button variant="primary">Save item</Button>
      <Button variant="secondary">Edit</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete item</Button>
    </div>
  ),
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className={row}>
        <Button variant="primary">Default size</Button>
        <Button>Default size</Button>
      </div>
      <div className={row}>
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button size="sm">Small</Button>
        <Button size="sm" variant="ghost">
          Small ghost
        </Button>
      </div>
    </div>
  ),
}

/** 28px square; the button carries the accessible name, the icon stays decorative. */
export const IconOnly: Story = {
  name: 'Icon only',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className={row}>
      <Button iconOnly aria-label="Edit item">
        <Icon name="pencil" />
      </Button>
      <Button iconOnly variant="ghost" aria-label="Close">
        <Icon name="close" />
      </Button>
      <Button iconOnly variant="danger" aria-label="Delete item">
        <Icon name="trash" />
      </Button>
      <Button iconOnly variant="primary" aria-label="Add item">
        <Icon name="plus" />
      </Button>
    </div>
  ),
}

function BusyDemo() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col items-start gap-3">
      <div className={row}>
        <Button
          variant="primary"
          busy={busy}
          onClick={() => {
            setBusy(true)
            window.setTimeout(() => setBusy(false), 1500)
          }}
        >
          {busy ? 'Saving…' : 'Save item'}
        </Button>
        <Button busy>Loading…</Button>
        <Button variant="danger" busy>
          Deleting…
        </Button>
      </div>
      <p className="text-xs text-soft">
        Click the first button: for 1.5s it is busy (aria-busy, spinner, clicks ignored) and its label says what is
        happening.
      </p>
    </div>
  )
}

export const Busy: Story = {
  parameters: { controls: { disable: true } },
  render: () => <BusyDemo />,
}

/**
 * Both look the same. `disabled` takes the button out of the tab order;
 * `aria-disabled="true"` keeps it reachable so the person can learn why it is
 * unavailable (the handler ignores the click). Tab through to compare.
 */
export const DisabledVsAriaDisabled: Story = {
  name: 'Disabled vs aria-disabled',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className={row}>
        <Button variant="primary" disabled>
          Save item
        </Button>
        <Button disabled>Edit</Button>
        <span className="text-xs text-soft">disabled: skipped by Tab</span>
      </div>
      <div className={row}>
        <Button variant="primary" aria-disabled="true" aria-describedby="button-story-why">
          Save item
        </Button>
        <Button aria-disabled="true">Edit</Button>
        <span id="button-story-why" className="text-xs text-soft">
          aria-disabled: focusable; explain why next to it (“Fill in the name first”)
        </span>
      </div>
    </div>
  ),
}

/** `buttonClassName` on a link that is an action entry point. Inline navigation stays a `.link`. */
export const AsLink: Story = {
  name: 'As a link (buttonClassName)',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <div className={row}>
        <a href="#new-item" className={buttonClassName({ variant: 'primary' })}>
          New item
        </a>
        <a href="#import" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
          Import items
        </a>
      </div>
      <p className="text-sm">
        Navigation inside text is a text link:{' '}
        <a href="#items" className="link">
          <Icon name="arrow-left" /> Back to items
        </a>
      </p>
    </div>
  ),
}

/** One primary per view: when two actions compete, the second is secondary. */
export const OnePrimaryPerView: Story = {
  name: 'One primary per view',
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-rule bg-ink-soft p-3">
      <Button variant="ghost">Cancel</Button>
      <Button>Save as draft</Button>
      <Button variant="primary">Publish item</Button>
    </div>
  ),
}
