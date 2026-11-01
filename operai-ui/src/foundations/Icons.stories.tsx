import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button'
import { ICON_NAMES, Icon } from '../components/Icon'
import { STATUS } from '../components/StatusBadge'

/**
 * The suite's icon set: inline SVG on a 24px grid with 2px rounded strokes in
 * `currentColor`, so an icon takes the colour and size of the text around it.
 * Each icon has ONE meaning suite-wide; the ones marked _status_ belong to the
 * status dictionary and are not reused for anything else. Add a shape to
 * `Icon.tsx` rather than reaching for a Unicode glyph, an emoji or an icon
 * package.
 */
const meta: Meta = {
  title: 'Foundations/Icons',
  parameters: { controls: { disable: true } },
}
export default meta

const STATUS_ICONS = new Map<string, string>(Object.entries(STATUS).map(([meaning, entry]) => [entry.icon, meaning]))

export const Gallery: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-soft">
        {ICON_NAMES.length} icons. Use <code className="font-mono">{'<Icon name="…" />'}</code>; it is decorative
        (aria-hidden) unless you pass a <code className="font-mono">label</code>.
      </p>
      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-0">
        {ICON_NAMES.map((name) => (
          <li key={name} className="flex flex-col items-center gap-2 rounded-md border border-rule bg-ink-soft p-4">
            <Icon name={name} size={24} />
            <code className="font-mono text-xs">{name}</code>
            {STATUS_ICONS.has(name) && (
              <span className="font-mono text-2xs text-soft">status: {STATUS_ICONS.get(name)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  ),
}

export const SizesAndColour: StoryObj = {
  name: 'Sizes and colour',
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-soft">By default an icon is 1em: it follows the font size and the text colour.</p>
      <div className="flex flex-wrap items-end gap-6">
        {(['text-xs', 'text-sm', 'text-lg', 'text-2xl'] as const).map((size) => (
          <span key={size} className={`flex items-center gap-2 ${size}`}>
            <Icon name="calendar" />
            <span className="font-mono text-2xs text-soft">{size}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <span className="flex items-center gap-2 text-text">
          <Icon name="info" /> text
        </span>
        <span className="flex items-center gap-2 text-soft">
          <Icon name="info" /> soft
        </span>
        <span className="flex items-center gap-2 text-acc-text">
          <Icon name="info" /> acc-text
        </span>
        <span className="flex items-center gap-2 text-grn-text">
          <Icon name="check" /> grn-text
        </span>
        <span className="flex items-center gap-2 text-red-text">
          <Icon name="alert" /> red-text
        </span>
      </div>
    </div>
  ),
}

export const InControls: StoryObj = {
  name: 'In controls',
  render: () => (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm text-soft">
        An icon-only button carries the name on the button (<code className="font-mono">aria-label</code>); the icon
        stays decorative. A standalone icon that means something on its own gets a{' '}
        <code className="font-mono">label</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button iconOnly aria-label="Edit item">
          <Icon name="pencil" />
        </Button>
        <Button iconOnly variant="ghost" aria-label="Download">
          <Icon name="download" />
        </Button>
        <Button iconOnly variant="danger" aria-label="Delete item">
          <Icon name="trash" />
        </Button>
        <span className="flex items-center gap-2 text-sm text-soft">
          <Icon name="lock" label="Locked" /> (a labelled, meaningful icon)
        </span>
      </div>
    </div>
  ),
}
