/**
 * @vitest-environment jsdom
 *
 * The letterhead notice (specs/20261116-letterhead-service T32; design F13, S9; AC-10.7, AC-10.8): the link to Letterheads
 * only for a holder of access to it, the frame named for an overflow, polite in the pane and assertive on a refused Generate.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../../strings'
import LetterheadNotice from './LetterheadNotice'

const session = vi.hoisted(() => ({ apps: [] as string[] }))
vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: session.apps, roles: [], departments: [], permissions: [] }),
}))

const t = strings.offerWizard.letterhead

afterEach(() => {
  cleanup()
  session.apps = []
})

describe('LetterheadNotice — no letterhead is set (AC-10.8)', () => {
  it('names the entity and what needs one, and links to its configurator for a holder of access', () => {
    session.apps = ['crm', 'letterheads']
    render(<LetterheadNotice entity="welld_ch" problem="notConfigured" where="preview" />)
    const notice = screen.getByTestId('crm-wizard-letterhead-not-configured')
    expect(notice.textContent).toContain(t.notConfigured.title('wellD CH'))
    expect(notice.textContent).toContain(t.notConfigured.preview)
    const link = screen.getByRole('link', { name: t.open })
    expect(link.getAttribute('href')).toBe('/letterheads?entity=welld_ch')
    expect(notice.textContent).not.toContain(t.askAdmin)
  })

  it('sends everyone else to an administrator and shows no link at all', () => {
    session.apps = ['crm']
    render(<LetterheadNotice entity="welld_it" problem="notConfigured" where="preview" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('crm-wizard-letterhead-not-configured').textContent).toContain(t.askAdmin)
  })

  it('is a polite status in the pane: announced once, not an alert, not a dialog (AC-10.7)', () => {
    session.apps = ['letterheads']
    render(<LetterheadNotice entity="welld_it" problem="notConfigured" where="preview" />)
    expect(screen.getByRole('status')).toBe(screen.getByTestId('crm-wizard-letterhead-not-configured'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says that no offer was created when it is the answer to Generate, as an alert, with the same link rule', () => {
    session.apps = []
    const { unmount } = render(<LetterheadNotice entity="welld_it" problem="notConfigured" where="generate" />)
    const notice = screen.getByRole('alert')
    expect(notice.textContent).toContain(t.notConfigured.title('wellD IT'))
    expect(notice.textContent).toContain(t.notConfigured.generate)
    expect(notice.textContent).not.toContain(t.notConfigured.preview)
    expect(screen.queryByRole('link')).toBeNull()
    unmount()

    session.apps = ['letterheads']
    render(<LetterheadNotice entity="welld_it" problem="notConfigured" where="generate" />)
    expect(screen.getByRole('link', { name: t.open }).getAttribute('href')).toBe('/letterheads?entity=welld_it')
  })
})

describe('LetterheadNotice — a profile value does not fit the letterhead (T27, AC-5.3)', () => {
  it.each([['header' as const], ['footer' as const]])('names the %s and the entity', (frame) => {
    session.apps = ['letterheads']
    render(<LetterheadNotice entity="welld_ch" problem="overflow" frame={frame} />)
    const notice = screen.getByTestId('crm-wizard-letterhead-overflow')
    expect(notice.textContent).toContain(t.overflow.title('wellD CH', t.overflow[frame]))
    expect(notice.textContent).toContain(t.overflow.body)
    expect(screen.getByRole('link', { name: t.open }).getAttribute('href')).toBe('/letterheads?entity=welld_ch')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('points a person without access to an administrator, with no link', () => {
    session.apps = []
    render(<LetterheadNotice entity="welld_it" problem="overflow" frame="footer" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('crm-wizard-letterhead-overflow').textContent).toContain(t.overflow.bodyAskAdmin)
  })
})
