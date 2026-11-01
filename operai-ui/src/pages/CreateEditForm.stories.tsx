import type { Meta, StoryObj } from '@storybook/react-vite'
import { CatalogueApp } from './CatalogueApp'

/**
 * A long form is a page with `Card` sections; every control is in a `Field`
 * (`MoneyInput` for the price, `DateInput` for the date, `RadioGroupField` for
 * the visibility). A touched field is validated on blur; Save validates
 * everything and moves focus to the first invalid field
 * (`focusFirstInvalid`). Save is busy for 1.2s, then the item's page opens
 * with a compact success `Banner` that dismisses itself. Cancel (`ghost`) is
 * left of Save.
 *
 * Try: press Save on the empty form; fill the fields; type `12,345` as the
 * price (three decimals are refused, never rounded).
 */
const meta = {
  title: 'Pages/Create and edit form',
  component: CatalogueApp,
  parameters: { frame: 'page' },
  args: { saveOutcome: 'success' },
  argTypes: {
    saveOutcome: { control: 'inline-radio', options: ['success', 'failure'] },
    initialRoute: { table: { disable: true } },
    listState: { table: { disable: true } },
  },
  render: (args) => (
    <CatalogueApp
      key={`${JSON.stringify(args.initialRoute)}-${args.saveOutcome}`}
      initialRoute={args.initialRoute}
      saveOutcome={args.saveOutcome}
    />
  ),
} satisfies Meta<typeof CatalogueApp>
export default meta

type Story = StoryObj<typeof meta>

export const Create: Story = {
  args: { initialRoute: { name: 'new' } },
}

export const Edit: Story = {
  args: { initialRoute: { name: 'edit', id: 'item-1' } },
}

/** The save request fails: the error is shown above the buttons (role="alert") and every value is kept. */
export const SaveFails: Story = {
  name: 'Save fails',
  args: { initialRoute: { name: 'edit', id: 'item-1' }, saveOutcome: 'failure' },
}
