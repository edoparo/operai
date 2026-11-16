/**
 * @vitest-environment jsdom
 *
 * The syntax reference in its drawer (specs/20261115-crm-offer-wizard AC-8.1; QE D17): the drawer's body scrolls and the
 * reference is plain text with nothing to focus, so a keyboard user could not scroll it (axe
 * `scrollable-region-focusable`). The reference is a named region that takes focus, as the document preview does.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Drawer } from '@operai/ui'
import { WizardMarkupReference } from './MarkupHelp'
import { strings } from '../strings'

afterEach(cleanup)

describe('WizardMarkupReference in a drawer', () => {
  it('is a named region that the keyboard reaches, so the scrolling body can be scrolled', async () => {
    const user = userEvent.setup()
    render(
      <Drawer title="Syntax" closeLabel="Close" onClose={() => undefined}>
        <WizardMarkupReference />
      </Drawer>,
    )
    const region = screen.getByRole('region', { name: strings.templates.markup.wizard.summary })
    expect(region.getAttribute('tabindex')).toBe('0')
    // focus starts on the heading; the next stops are the region and the close button
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Syntax' }))
    await user.tab()
    const reached = document.activeElement
    await user.tab()
    expect([reached, document.activeElement]).toContain(region)
  })
})
