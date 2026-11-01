import type { Decorator, Preview } from '@storybook/react-vite'
import './preview.css'

// The suite themes through `data-theme` on <html> (shell ThemeToggle), with the
// system preference as the default. The toolbar sets the same attribute.
//
// Layout per story, through `parameters.frame`:
//   'padded' (default) — a 24px gutter, like a component on a page;
//   'page'             — no gutter: a whole tool page, edge to edge like inside the shell.
// In the docs view a story is only as tall as its content; on its own canvas it
// fills the viewport, so the page background covers the frame.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as 'dark' | 'light'
  // Set while rendering (not in an effect) so the story's first paint is themed.
  document.documentElement.dataset.theme = theme
  // The suite's language is English unless the shell sets <html lang>; the
  // formatters and selectStrings read it (Foundations/Languages).
  if (!document.documentElement.lang) document.documentElement.lang = 'en'
  const page = context.parameters.frame === 'page'
  const inDocs = context.viewMode === 'docs'
  return (
    <div
      className="bg-ink text-text font-body"
      style={{ padding: page ? 0 : 24, minHeight: inDocs ? undefined : '100vh' }}
    >
      <Story />
    </div>
  )
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Operai theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'dark', title: 'Dark' },
          { value: 'light', title: 'Light' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'dark' },
  decorators: [withTheme],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true, sort: 'requiredFirst' },
    a11y: { test: 'error' },
    options: {
      storySort: {
        method: 'configure',
        order: [
          'Introduction',
          'Foundations',
          [
            'Colours',
            'Type scale',
            'Spacing and layout',
            'Themes',
            'Focus',
            'Icons',
            'Status dictionary',
            'Formatting',
            'Languages',
          ],
          'Components',
          ['Actions', 'Layout', 'Content', 'Data', 'Forms', 'Feedback', 'Dialogs'],
          'Pages',
          [
            'Tool navigation',
            'Item list',
            'Card list',
            'Item detail',
            'Create and edit form',
            'Deletion flow',
            'Quick create in a dialog',
            'Settings',
            'States gallery',
          ],
        ],
      },
    },
  },
}

export default preview
