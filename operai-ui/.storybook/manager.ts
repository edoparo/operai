import { addons } from 'storybook/manager-api'
import { create } from 'storybook/theming'

// The Storybook UI around the stories: dark like the suite's default theme,
// branded with the library's name. Colours of the stories themselves come
// only from tokens.css (Theme toolbar).
addons.setConfig({
  theme: create({
    base: 'dark',
    brandTitle: 'Operai UI',
    fontBase: '"DM Sans", system-ui, sans-serif',
    fontCode: '"DM Mono", ui-monospace, monospace',
  }),
  sidebar: { showRoots: true },
})
