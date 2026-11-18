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
import MarkupHelp, { WizardMarkupReference } from './MarkupHelp'
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

describe('the alignment syntax in the references', () => {
  it('the template syntax reference documents ->text<- and ->text-> and how to print the markers literally', () => {
    render(<WizardMarkupReference />)
    const region = screen.getByRole('region', { name: strings.templates.markup.wizard.summary })
    expect(region.textContent).toContain('->text<-')
    expect(region.textContent).toContain('Centred paragraph')
    expect(region.textContent).toContain('->text->')
    expect(region.textContent).toContain('Right-aligned paragraph')
    expect(region.textContent).toContain('\\->')
  })

  it('the formatting reference of the other text fields lists them too', () => {
    render(<MarkupHelp placeholders={false} />)
    const help = screen.getByTestId('crm-markup-help')
    expect(help.textContent).toContain('->text<-')
    expect(help.textContent).toContain('->text->')
  })
})
