/**
 * @vitest-environment jsdom
 *
 * ZoneEditor (task T21): up to four lines, add and remove with the focus rules, the names of the controls,
 * and the numbers that follow the line under them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeViolations } from '../lib/formStateAxe'
import { FormHarness } from '../lib/formStateHarness'
import { getAt } from '../lib/formState'
import type { FormState } from '../lib/formState'
import type { FormLine, Problem } from '../lib/formStateTypes'
import { ZoneEditor } from './ZoneEditor'

afterEach(() => cleanup())

const ZONE = '/variants/default/footer/left'
let latest: FormState

function renderZone({ problems, announce }: { problems?: Problem[]; announce?: (text: string) => void } = {}) {
  return render(
    <FormHarness problems={problems} announce={announce}>
      {(state) => {
        latest = state
        return (
          <ZoneEditor
            pointer={ZONE}
            zoneLabel="Left zone"
            variantLabel="Default page"
            frameLabel="Footer"
            lines={getAt(state.config, ZONE) as FormLine[]}
          />
        )
      }}
    </FormHarness>,
  )
}

const lines = () => latest.config.variants.default.footer.left
const addButton = () => screen.getByRole('button', { name: 'Add a line' })
const removeButton = (n: number) =>
  screen.getByRole('button', { name: `Remove default page, footer, left zone, line ${n}` })
const firstInput = (n: number) =>
  within(screen.getByRole('group', { name: `Line ${n}` })).getByRole('textbox', { name: 'Text, Italian' })

describe('ZoneEditor: what is shown', () => {
  it('is a group named by the zone, with a group per line named by its number', () => {
    renderZone()
    expect(screen.getByRole('group', { name: 'Left zone' })).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Line 1' })).not.toBeNull()
    expect(screen.getByRole('group', { name: 'Line 2' })).not.toBeNull()
    expect(screen.queryByRole('group', { name: 'Line 3' })).toBeNull()
  })

  it('gives every line the labelled controls of the model: both texts, size, bold, colour', () => {
    renderZone()
    const line = within(screen.getByRole('group', { name: 'Line 2' }))
    expect((line.getByRole('textbox', { name: 'Text, Italian' }) as HTMLInputElement).value).toBe('{address}')
    expect((line.getByRole('textbox', { name: 'Text, English' }) as HTMLInputElement).value).toBe('{address}')
    expect((line.getByRole('textbox', { name: 'Size (pt)' }) as HTMLInputElement).value).toBe('8')
    expect((line.getByRole('checkbox', { name: 'Bold' }) as HTMLInputElement).checked).toBe(false)
    expect((line.getByRole('textbox', { name: 'Colour' }) as HTMLInputElement).value).toBe('595c69')
  })

  it('shows a zone with no line as just the Add button', () => {
    // the default configuration has no line in its header
    render(
      <FormHarness>
        {(state) => (
          <ZoneEditor
            pointer="/variants/default/header/left"
            zoneLabel="Left zone"
            variantLabel="Default page"
            frameLabel="Header"
            lines={getAt(state.config, '/variants/default/header/left') as FormLine[]}
          />
        )}
      </FormHarness>,
    )
    expect(screen.queryByRole('group', { name: 'Line 1' })).toBeNull()
    expect(addButton()).not.toBeNull()
  })
})

describe('ZoneEditor: editing', () => {
  it('typing in a text changes that line and no other', async () => {
    renderZone()
    await userEvent.type(firstInput(2), '!')
    expect(lines()[1].text.it).toBe('{address}!')
    expect(lines()[0].text.it).toBe('{legal_name}')
    expect(lines()[1].text.en).toBe('{address}')
  })

  it('a size keeps the text as typed while it is the value, and a text that is not a number is kept for the service to refuse', async () => {
    renderZone()
    const size = within(screen.getByRole('group', { name: 'Line 2' })).getByRole('textbox', {
      name: 'Size (pt)',
    }) as HTMLInputElement
    await userEvent.clear(size)
    await userEvent.type(size, '9,5')
    expect(size.value).toBe('9,5')
    expect(lines()[1].size).toBe(9.5)
    await userEvent.type(size, 'x')
    expect(lines()[1].size).toBe('9,5x')
    expect(size.value).toBe('9,5x')
  })

  it('a bold checkbox and a colour change that line', async () => {
    renderZone()
    const line = within(screen.getByRole('group', { name: 'Line 2' }))
    await userEvent.click(line.getByRole('checkbox', { name: 'Bold' }))
    expect(lines()[1].bold).toBe(true)
    await userEvent.clear(line.getByRole('textbox', { name: 'Colour' }))
    await userEvent.type(line.getByRole('textbox', { name: 'Colour' }), '#112233')
    expect(lines()[1].color).toBe('112233')
  })

  it('shows the refusal of a value next to its control and not next to its neighbours', () => {
    renderZone({ problems: [{ path: `${ZONE}/1/text/en`, reason: 'unknown_placeholder' }] })
    const line = within(screen.getByRole('group', { name: 'Line 2' }))
    const english = line.getByRole('textbox', { name: 'Text, English' })
    expect(english.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(english.getAttribute('aria-describedby')!)?.textContent).toBe('refused')
    expect(line.getByRole('textbox', { name: 'Text, Italian' }).getAttribute('aria-invalid')).toBeNull()
  })

  it('shows the refusal of the zone itself under its name, and the zone is described by it', () => {
    renderZone({ problems: [{ path: ZONE, reason: 'too_many_lines' }] })
    const zone = screen.getByRole('group', { name: 'Left zone' })
    expect(document.getElementById(zone.getAttribute('aria-describedby')!)?.textContent).toBe('refused')
  })
})

describe('ZoneEditor: add a line', () => {
  it('appends an empty line with the look of the last one and moves focus to its first input', async () => {
    renderZone()
    await userEvent.click(addButton())
    expect(lines()).toHaveLength(3)
    expect(lines()[2]).toEqual({ text: { it: '', en: '' }, size: 8, bold: false, color: '595c69' })
    expect(document.activeElement).toBe(firstInput(3))
  })

  it('works from the keyboard alone: Tab to the button, Enter, then type in the new line', async () => {
    renderZone()
    addButton().focus()
    await userEvent.keyboard('{Enter}')
    expect(document.activeElement).toBe(firstInput(3))
    await userEvent.keyboard('Ciao')
    expect(lines()[2].text.it).toBe('Ciao')
  })

  it('at the limit the button is aria-disabled and described by the reason, and does nothing', async () => {
    renderZone()
    await userEvent.click(addButton())
    await userEvent.click(addButton())
    expect(lines()).toHaveLength(4)
    const button = addButton()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
      'A zone holds up to 4 lines.',
    )
    button.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(button)
    expect(lines()).toHaveLength(4)
    expect(document.activeElement).toBe(button)
  })

  it('before the limit the button is not disabled and has no reason', () => {
    renderZone()
    expect(addButton().getAttribute('aria-disabled')).toBeNull()
    expect(addButton().getAttribute('aria-describedby')).toBeNull()
  })
})

describe('ZoneEditor: remove a line', () => {
  const grow = async () => {
    await userEvent.click(addButton())
    await userEvent.click(addButton())
    await userEvent.type(firstInput(3), 'three')
    await userEvent.click(addButton())
    await userEvent.type(firstInput(4), 'four')
  }

  it('names each remove button by the page, the frame, the zone and the line', () => {
    renderZone()
    expect(removeButton(1)).not.toBeNull()
    expect(removeButton(2)).not.toBeNull()
  })

  it('focus goes to the next line’s first input, announcing "Line removed"', async () => {
    const announce = vi.fn()
    renderZone({ announce })
    await grow()
    await userEvent.click(removeButton(2))
    expect(lines().map((l) => l.text.it)).toEqual(['{legal_name}', 'three', 'four'])
    expect(document.activeElement).toBe(firstInput(2))
    expect((document.activeElement as HTMLInputElement).value).toBe('three')
    expect(announce).toHaveBeenCalledWith('Line removed')
  })

  it('removing the last line sends focus to the previous one', async () => {
    renderZone()
    await grow()
    await userEvent.click(removeButton(4))
    expect(lines()).toHaveLength(3)
    expect(document.activeElement).toBe(firstInput(3))
    expect((document.activeElement as HTMLInputElement).value).toBe('three')
  })

  it('removing the only line sends focus to the Add button', async () => {
    renderZone()
    await userEvent.click(removeButton(2))
    await userEvent.click(removeButton(1))
    expect(lines()).toEqual([])
    expect(document.activeElement).toBe(addButton())
  })

  it('works from the keyboard alone', async () => {
    renderZone()
    removeButton(1).focus()
    await userEvent.keyboard('{Enter}')
    expect(lines().map((l) => l.text.it)).toEqual(['{address}'])
    expect(document.activeElement).toBe(firstInput(1))
  })

  it('removing at the limit makes Add usable again', async () => {
    renderZone()
    await grow()
    expect(addButton().getAttribute('aria-disabled')).toBe('true')
    await userEvent.click(removeButton(3))
    expect(addButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('the size shown by the line that moved up is its own, not the removed line’s', async () => {
    renderZone()
    const size = (n: number) =>
      within(screen.getByRole('group', { name: `Line ${n}` })).getByRole('textbox', {
        name: 'Size (pt)',
      }) as HTMLInputElement
    await userEvent.clear(size(1))
    await userEvent.type(size(1), '12.50')
    expect(size(1).value).toBe('12.50')
    await userEvent.click(removeButton(1))
    expect(size(1).value).toBe('8')
  })

  it('a refusal on a later line does not follow the line that moved up', async () => {
    renderZone({ problems: [{ path: `${ZONE}/1/text/en`, reason: 'unknown_placeholder' }] })
    await userEvent.click(removeButton(1))
    const line = within(screen.getByRole('group', { name: 'Line 1' }))
    expect(line.getByRole('textbox', { name: 'Text, English' }).getAttribute('aria-invalid')).toBeNull()
  })
})

describe('ZoneEditor: accessibility', () => {
  it('has no axe violations, with a refusal shown and at the limit', async () => {
    const { container } = renderZone({ problems: [{ path: `${ZONE}/0/text/it`, reason: 'language_missing' }] })
    await userEvent.click(addButton())
    await userEvent.click(addButton())
    expect(await axeViolations(container)).toEqual([])
  })
})
