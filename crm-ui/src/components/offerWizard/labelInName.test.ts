import { describe, expect, it } from 'vitest'
import { offerWizard } from '../../strings/offerWizard'

/**
 * WCAG 2.5.3 (label in name), QE D22: a control with an aria-label that also shows text must have that text in its name,
 * or a person who speaks the visible words to a voice-control tool is not understood. Each pair is a name builder and
 * the words the same button shows, in both languages; a new labelled control with visible text joins this list.
 */
describe.each(['en', 'it'] as const)('the offer wizard names its text buttons with their visible text (%s)', (lang) => {
  const t = offerWizard[lang]
  const pairs: [string, string, string][] = [
    ['Sections: edit text', t.sections.edit('H'), t.sections.editShort],
    ['Sections: restore wizard text', t.sections.restore('H'), t.edit.restore],
    ['Changed template: copy the text written for a section', t.sections.orphanCopy('H'), t.changed.dialog.copy],
    ['Template step: use template', t.template.useOf('N'), t.template.use],
    ['Template step: use classic form', t.template.classic.useOf('N'), t.template.classic.use],
  ]
  it.each(pairs)('%s', (_what, name, visible) => {
    expect(name.toLowerCase()).toContain(visible.toLowerCase())
  })
})
