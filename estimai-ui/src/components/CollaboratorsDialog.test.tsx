/**
 * @vitest-environment jsdom
 *
 * Tests for CollaboratorsDialog — owner mode (T20) and member mode (T21),
 * specs/20260807-estimate-sharing/tasks.md. The toolbar entry that opens this
 * dialog (T22) is out of scope — this dialog is rendered directly here,
 * exactly as a future call site would.
 *
 * Strategy:
 *   • `../lib/collaboratorsApi` is mocked at the module level (list/add/
 *     remove/updateLevel/leave), keeping the REAL typed error classes via
 *     importOriginal — so tests reject with `instanceof`-correct errors and
 *     the component's own `instanceof` branching is exercised for real.
 *   • `../lib/authClient` is mocked with a fixed signed-in owner
 *     (owner@welld.ch) so the client-side self-add short-circuit is testable.
 *   • Every assertion targets text/testid that would not appear if the
 *     relevant code path did not execute (non-vacuous).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { StrictMode } from 'react'
import CollaboratorsDialog from './CollaboratorsDialog'
import type { CollaboratorGrant } from '../lib/collaboratorsApi'
import type { ApiProblem, EstimateIdentity } from '../lib/estimatesApi'
import { strings } from '../strings'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../lib/collaboratorsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/collaboratorsApi')>()
  return {
    ...original,
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    updateLevel: vi.fn(),
    leave: vi.fn(),
  }
})

vi.mock('../lib/authClient', () => ({
  authClient: {
    useSession: vi.fn(() => ({
      data: { user: { id: 'owner-1', name: 'Owner Owens', email: 'owner@welld.ch', image: null } },
    })),
  },
}))

import * as collaboratorsApi from '../lib/collaboratorsApi'
import {
  AlreadyCollaboratorError,
  AuthorizationServiceUnavailableError,
  CannotShareWithSelfError,
  CollaboratorNotEligibleError,
  RateLimitedError,
} from '../lib/collaboratorsApi'

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const grantAlice: CollaboratorGrant = {
  id: 'grant-alice',
  email: 'alice@welld.ch',
  accessLevel: 'editor',
  createdAt: '2026-08-01T10:00:00.000Z',
  identity: { status: 'active', name: 'Alice' },
}

const grantBob: CollaboratorGrant = {
  id: 'grant-bob',
  email: 'bob@welld.ch',
  accessLevel: 'viewer',
  createdAt: '2026-08-02T10:00:00.000Z',
  identity: { status: 'active', name: 'Bob' },
}

const problem = (status: number, code: string, detail?: string): ApiProblem => ({
  type: `https://httpstatuses.com/${status}`,
  title: 'Error',
  status,
  code,
  detail,
})

const renderDialog = (onClose = vi.fn()) => {
  render(<CollaboratorsDialog estimateId="est-1" access="owner" onClose={onClose} />)
  return { onClose }
}

const activeOwnerIdentity: EstimateIdentity = { status: 'active', name: 'Marco Rossi' }

const renderMemberDialog = (
  access: 'viewer' | 'editor' = 'viewer',
  owner: EstimateIdentity = activeOwnerIdentity,
  onClose = vi.fn(),
) => {
  render(<CollaboratorsDialog estimateId="est-1" access={access} owner={owner} onClose={onClose} />)
  return { onClose }
}

const fillAndSubmitAdd = async (email: string) => {
  const input = screen.getByTestId('collaborators-dialog-email-input')
  fireEvent.change(input, { target: { value: email } })
  fireEvent.click(screen.getByTestId('collaborators-dialog-add-button'))
}

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'http://api.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaboratorsDialog — owner mode (T20, specs/20260807-estimate-sharing)', () => {
  describe('role/labelling', () => {
    it('renders as an accessible dialog labelled by its visible heading', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      renderDialog()

      const dialog = await screen.findByRole('dialog', { name: strings.sharing.dialog.title })
      expect(dialog.getAttribute('aria-modal')).toBe('true')
    })
  })

  describe('happy add (US-1)', () => {
    it('adds a collaborator, announces it, clears the email field, and refocuses it', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockResolvedValue({
        id: 'grant-new',
        email: 'new@welld.ch',
        accessLevel: 'viewer',
        createdAt: '2026-08-07T10:00:00.000Z',
        identity: { status: 'active', name: null },
      })
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('new@welld.ch')

      await waitFor(() =>
        expect(collaboratorsApi.add).toHaveBeenCalledWith('est-1', {
          email: 'new@welld.ch',
          accessLevel: 'viewer',
        }),
      )
      await screen.findByText('new@welld.ch')

      const input = screen.getByTestId('collaborators-dialog-email-input') as HTMLInputElement
      expect(input.value).toBe('')
      expect(document.activeElement).toBe(input)
      expect(screen.getByTestId('collaborators-dialog-live-region').textContent).toBe(
        strings.sharing.dialog.addedAnnouncement('new@welld.ch', strings.sharing.dialog.levelViewer),
      )
    })
  })

  describe('generic 422 — no cause disclosed (AC-1.2)', () => {
    it('renders the fixed notEligible copy and never the raw email or a cause word', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockRejectedValue(
        new CollaboratorNotEligibleError(problem(422, 'collaborator_not_eligible', strings.sharing.errors.notEligible)),
      )
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('nobody@example.com')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.notEligible)
      expect(errorEl.textContent).not.toContain('nobody@example.com')
      expect(errorEl.getAttribute('role')).toBe('alert')
      // Nothing was added.
      expect(screen.queryByText('nobody@example.com')).toBeNull()
    })

    it('renders the SAME message regardless of the server-side detail string (defends against cause leakage)', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockRejectedValueOnce(
        new CollaboratorNotEligibleError(problem(422, 'collaborator_not_eligible', 'no such user exists')),
      )
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')
      await fillAndSubmitAdd('cause-a@example.com')
      const firstMessage = (await screen.findByTestId('collaborators-dialog-add-error')).textContent

      vi.mocked(collaboratorsApi.add).mockRejectedValueOnce(
        new CollaboratorNotEligibleError(problem(422, 'collaborator_not_eligible', 'user lacks estimai access')),
      )
      await fillAndSubmitAdd('cause-b@example.com')
      const secondMessage = (await screen.findByTestId('collaborators-dialog-add-error')).textContent

      expect(firstMessage).toBe(strings.sharing.errors.notEligible)
      expect(secondMessage).toBe(strings.sharing.errors.notEligible)
      expect(firstMessage).toBe(secondMessage)
    })
  })

  describe('409 already a collaborator (AC-1.3)', () => {
    it('names the EXISTING level (looked up from the loaded list) and focuses that row’s select', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice])
      vi.mocked(collaboratorsApi.add).mockRejectedValue(
        new AlreadyCollaboratorError(problem(409, 'already_collaborator', 'already a collaborator')),
      )
      renderDialog()
      await screen.findByText('alice@welld.ch')

      // Case-insensitive match against the stored row, per server normalisation.
      await fillAndSubmitAdd('ALICE@welld.ch')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.alreadyCollaborator(strings.sharing.dialog.levelEditor))

      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByTestId(`collaborators-dialog-row-level-${grantAlice.id}`)),
      )
    })
  })

  describe('self-add (AC-1.4)', () => {
    it('blocks the signed-in user’s own email client-side, firing no request', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('Owner@Welld.CH')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.cannotShareWithSelf)
      expect(collaboratorsApi.add).not.toHaveBeenCalled()
    })

    it('renders the same copy for a server-side alias rejection (the round trip)', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockRejectedValue(
        new CannotShareWithSelfError(problem(422, 'cannot_share_with_self')),
      )
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('alias-of-owner@welld.ch')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.cannotShareWithSelf)
      expect(collaboratorsApi.add).toHaveBeenCalled()
    })
  })

  describe('429 rate-limited', () => {
    it('shows the rate-limited copy and disables Add for a cooldown', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockRejectedValue(new RateLimitedError(problem(429, 'rate_limited'), 5))
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('someone@welld.ch')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.rateLimited)

      await waitFor(() =>
        expect((screen.getByTestId('collaborators-dialog-add-button') as HTMLButtonElement).disabled).toBe(true),
      )
    })
  })

  describe('503 auth unavailable', () => {
    it('shows a distinct message from the generic 422', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockRejectedValue(
        new AuthorizationServiceUnavailableError(problem(503, 'authorization_service_unavailable')),
      )
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('someone@welld.ch')

      const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.authUnavailable)
      expect(errorEl.textContent).not.toBe(strings.sharing.errors.notEligible)
    })
  })

  describe('level change (AC-5.1)', () => {
    it('changes a row’s level and announces the change', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantBob])
      vi.mocked(collaboratorsApi.updateLevel).mockResolvedValue({ ...grantBob, accessLevel: 'editor' })
      renderDialog()
      await screen.findByText('bob@welld.ch')

      const select = screen.getByTestId(`collaborators-dialog-row-level-${grantBob.id}`)
      fireEvent.change(select, { target: { value: 'editor' } })

      await waitFor(() =>
        expect(collaboratorsApi.updateLevel).toHaveBeenCalledWith('est-1', grantBob.id, { accessLevel: 'editor' }),
      )
      await waitFor(() =>
        expect(screen.getByTestId('collaborators-dialog-live-region').textContent).toBe(
          strings.sharing.dialog.levelChangedAnnouncement('bob@welld.ch', strings.sharing.dialog.levelEditor),
        ),
      )
    })

    it('shows a row-scoped error on failure without affecting other rows', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice, grantBob])
      vi.mocked(collaboratorsApi.updateLevel).mockRejectedValue(new Error('network'))
      renderDialog()
      await screen.findByText('alice@welld.ch')

      fireEvent.change(screen.getByTestId(`collaborators-dialog-row-level-${grantAlice.id}`), {
        target: { value: 'viewer' },
      })

      await screen.findByText(strings.sharing.errors.genericLevelChangeFailed)
      expect(screen.getAllByText(strings.sharing.errors.genericLevelChangeFailed)).toHaveLength(1)
    })
  })

  describe('remove (AC-5.2)', () => {
    it('removes a collaborator through the generalized confirm modal and announces it', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice])
      vi.mocked(collaboratorsApi.remove).mockResolvedValue(undefined)
      renderDialog()
      await screen.findByText('alice@welld.ch')

      fireEvent.click(screen.getByTestId(`collaborators-dialog-row-remove-${grantAlice.id}`))
      expect(screen.getByTestId('confirm-delete-modal')).toBeDefined()
      expect(screen.getByText(strings.sharing.dialog.removeConfirmTitle)).toBeDefined()

      fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

      await waitFor(() => expect(collaboratorsApi.remove).toHaveBeenCalledWith('est-1', grantAlice.id))
      await waitFor(() => expect(screen.queryByText('alice@welld.ch')).toBeNull())
      expect(screen.getByTestId('collaborators-dialog-live-region').textContent).toBe(
        strings.sharing.dialog.removedAnnouncement('alice@welld.ch'),
      )
    })

    it('gives the Remove button an aria-label naming the email, never a bare glyph (INC-31: a decorative icon)', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice])
      renderDialog()
      const removeBtn = await screen.findByRole('button', { name: 'Remove alice@welld.ch' })
      expect(removeBtn.textContent).toBe('')
      expect(removeBtn.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    })
  })

  describe('owner never appears as a manageable row (AC-5.4)', () => {
    it('renders "You (owner)" exactly once, as a header line, never inside a row', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice, grantBob])
      renderDialog()
      await screen.findByTestId('collaborators-dialog-list')

      expect(screen.getAllByText(strings.sharing.dialog.ownerRowLabel)).toHaveLength(1)
      const rows = screen.getAllByRole('listitem')
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        expect(within(row).queryByText(strings.sharing.dialog.ownerRowLabel)).toBeNull()
      }
    })
  })

  describe('load error', () => {
    it('shows a load-error state with Retry while the add form stays usable, then recovers', async () => {
      vi.mocked(collaboratorsApi.list).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([])
      renderDialog()

      await screen.findByTestId('collaborators-dialog-load-error')
      expect((screen.getByTestId('collaborators-dialog-email-input') as HTMLInputElement).disabled).toBe(false)

      fireEvent.click(screen.getByText('Retry'))
      await screen.findByTestId('collaborators-dialog-empty')
    })
  })

  describe('a11y — default focus + Tab trap + Escape', () => {
    it('moves default focus to the email input on open', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      renderDialog()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('collaborators-dialog-email-input')))
    })

    it('holds the live-queried Tab trap after a row is added — wraps from the new row back to the header Close button', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      vi.mocked(collaboratorsApi.add).mockResolvedValue({
        id: 'grant-new',
        email: 'new@welld.ch',
        accessLevel: 'viewer',
        createdAt: '2026-08-07T10:00:00.000Z',
        identity: { status: 'active', name: null },
      })
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      await fillAndSubmitAdd('new@welld.ch')
      await screen.findByText('new@welld.ch')

      const removeButton = screen.getByTestId('collaborators-dialog-row-remove-grant-new')
      removeButton.focus()
      expect(document.activeElement).toBe(removeButton)

      fireEvent.keyDown(window, { key: 'Tab' })

      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' })))
    })

    it('Escape closes the dialog when no nested confirm is open', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      const { onClose } = renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('Escape closes only the nested Remove-confirm layer first, leaving the dialog open', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([grantAlice])
      const { onClose } = renderDialog()
      await screen.findByText('alice@welld.ch')

      fireEvent.click(screen.getByTestId(`collaborators-dialog-row-remove-${grantAlice.id}`))
      expect(screen.getByTestId('confirm-delete-modal')).toBeDefined()

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.queryByTestId('confirm-delete-modal')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('collaborators-dialog')).toBeDefined()
    })
  })

  describe('live region (design.md: always mounted, sr-only)', () => {
    it('is present from the start, empty, and outside the inline-alert error text', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      renderDialog()
      const region = await screen.findByTestId('collaborators-dialog-live-region')
      expect(region.getAttribute('aria-live')).toBe('polite')
      expect(region.textContent).toBe('')
    })
  })
})

describe('CollaboratorsDialog — add form, Field convention (INC-16)', () => {
  it('labels the email input through its Field, marked required', async () => {
    vi.mocked(collaboratorsApi.list).mockResolvedValue([])
    renderDialog()
    await screen.findByTestId('collaborators-dialog-empty')

    const input = screen.getByLabelText(new RegExp(strings.sharing.dialog.emailLabel))
    expect(input).toBe(screen.getByTestId('collaborators-dialog-email-input'))
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(screen.getByLabelText(strings.sharing.dialog.levelLabel)).toBe(
      screen.getByTestId('collaborators-dialog-level-select'),
    )
  })

  it('keeps Add enabled for a malformed address; submitting it shows the field error, marks the input invalid and focuses it', async () => {
    vi.mocked(collaboratorsApi.list).mockResolvedValue([])
    renderDialog()
    await screen.findByTestId('collaborators-dialog-empty')

    const input = screen.getByTestId('collaborators-dialog-email-input') as HTMLInputElement
    const addButton = screen.getByTestId('collaborators-dialog-add-button') as HTMLButtonElement
    expect(addButton.disabled).toBe(true) // nothing typed yet

    fireEvent.change(input, { target: { value: 'not-an-email' } })
    expect(addButton.disabled).toBe(false)
    screen.getByTestId('collaborators-dialog-level-select').focus()
    fireEvent.click(addButton)

    const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
    expect(errorEl.textContent).toBe(strings.sharing.errors.invalidEmail)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const describedBy = input.getAttribute('aria-describedby') ?? ''
    expect(describedBy).not.toBe('')
    expect(document.getElementById(describedBy)?.textContent).toBe(strings.sharing.errors.invalidEmail)
    expect(document.activeElement).toBe(input)
    expect(collaboratorsApi.add).not.toHaveBeenCalled()
  })

  it('validates the format on blur of a touched field, and clears it once corrected', async () => {
    vi.mocked(collaboratorsApi.list).mockResolvedValue([])
    renderDialog()
    await screen.findByTestId('collaborators-dialog-empty')

    const input = screen.getByTestId('collaborators-dialog-email-input')
    fireEvent.blur(input)
    expect(screen.queryByTestId('collaborators-dialog-add-error')).toBeNull() // untouched

    fireEvent.change(input, { target: { value: 'bad@' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('collaborators-dialog-add-error').textContent).toBe(strings.sharing.errors.invalidEmail)

    fireEvent.change(input, { target: { value: 'good@welld.ch' } })
    fireEvent.blur(input)
    expect(screen.queryByTestId('collaborators-dialog-add-error')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('shows a failure that is not about the address (503) as a form error, without marking the input invalid', async () => {
    vi.mocked(collaboratorsApi.list).mockResolvedValue([])
    vi.mocked(collaboratorsApi.add).mockRejectedValue(
      new AuthorizationServiceUnavailableError(problem(503, 'authorization_service_unavailable')),
    )
    renderDialog()
    await screen.findByTestId('collaborators-dialog-empty')

    await fillAndSubmitAdd('someone@welld.ch')

    const errorEl = await screen.findByTestId('collaborators-dialog-add-error')
    expect(errorEl.closest('.form-error')).not.toBeNull()
    expect(screen.getByTestId('collaborators-dialog-email-input').getAttribute('aria-invalid')).toBeNull()
  })

  it('shows a load failure as a warning Banner (retryable, orange)', async () => {
    vi.mocked(collaboratorsApi.list).mockRejectedValue(new Error('network'))
    renderDialog()

    const banner = await screen.findByTestId('collaborators-dialog-load-error')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.className).toContain('banner-warning')
  })
})

describe('CollaboratorsDialog — member mode: Leave confirms to the caller (INC-19)', () => {
  it('calls onLeft before onClose after a successful Leave, and not on failure', async () => {
    const calls: string[] = []
    const onLeft = vi.fn(() => calls.push('left'))
    const onClose = vi.fn(() => calls.push('close'))
    vi.mocked(collaboratorsApi.leave).mockResolvedValueOnce(undefined)
    render(
      <CollaboratorsDialog
        estimateId="est-1"
        access="viewer"
        owner={activeOwnerIdentity}
        onClose={onClose}
        onLeft={onLeft}
      />,
    )

    fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(calls).toEqual(['left', 'close'])
  })

  it('does not call onLeft when Leave fails', async () => {
    const onLeft = vi.fn()
    vi.mocked(collaboratorsApi.leave).mockRejectedValueOnce(new Error('network'))
    render(
      <CollaboratorsDialog estimateId="est-1" access="viewer" owner={activeOwnerIdentity} onClose={vi.fn()} onLeft={onLeft} />,
    )

    fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

    await screen.findByTestId('confirm-delete-error')
    expect(onLeft).not.toHaveBeenCalled()
  })
})

describe('CollaboratorsDialog — member mode (T21, specs/20260807-estimate-sharing)', () => {
  describe('spare content (AC-6.1) — no form, no list', () => {
    it('renders the dialog as accessible, labelled by its heading, with no add form and no collaborator list', () => {
      renderMemberDialog()

      const dialog = screen.getByRole('dialog', { name: strings.sharing.dialog.title })
      expect(dialog.getAttribute('aria-modal')).toBe('true')

      // Never calls the owner-only list endpoint — there is nothing to fetch.
      expect(collaboratorsApi.list).not.toHaveBeenCalled()

      expect(screen.queryByTestId('collaborators-dialog-email-input')).toBeNull()
      expect(screen.queryByTestId('collaborators-dialog-add-button')).toBeNull()
      expect(screen.queryByTestId('collaborators-dialog-list')).toBeNull()
      expect(screen.queryByRole('list')).toBeNull()
    })

    it("shows who shared it and the caller's own access level", () => {
      renderMemberDialog('editor', activeOwnerIdentity)

      expect(screen.getByTestId('collaborators-dialog-shared-by').textContent).toBe(
        strings.sharing.dialog.sharedWithYouBy('Marco Rossi'),
      )
      expect(screen.getByTestId('collaborators-dialog-your-access').textContent).toContain(
        strings.sharing.dialog.yourAccessLevel(strings.sharing.dialog.levelEditor),
      )
    })
  })

  describe('orphaned owner (AC-10.5)', () => {
    it('renders "Former wellD member" via formatIdentity when the owner is soft-deleted, and Leave still works', () => {
      renderMemberDialog('viewer', { status: 'deleted', name: null })

      expect(screen.getByTestId('collaborators-dialog-shared-by').textContent).toBe(
        strings.sharing.dialog.sharedWithYouBy(strings.sharing.identity.deleted),
      )
      expect(screen.getByTestId('collaborators-dialog-leave-button')).toBeDefined()
    })
  })

  describe('Leave (US-6, AC-6.1)', () => {
    it('confirms through the generalized ConfirmDeleteModal and calls DELETE …/collaborators/me', async () => {
      vi.mocked(collaboratorsApi.leave).mockResolvedValue(undefined)
      const { onClose } = renderMemberDialog()

      fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
      expect(screen.getByTestId('confirm-delete-modal')).toBeDefined()
      expect(screen.getByText(strings.sharing.dialog.leaveConfirmTitle)).toBeDefined()

      fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

      await waitFor(() => expect(collaboratorsApi.leave).toHaveBeenCalledWith('est-1'))
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('shows an inline error and stays open on failure, without closing the dialog', async () => {
      vi.mocked(collaboratorsApi.leave).mockRejectedValue(new Error('network'))
      const { onClose } = renderMemberDialog()

      fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
      fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

      const errorEl = await screen.findByTestId('confirm-delete-error')
      expect(errorEl.textContent).toBe(strings.sharing.errors.genericLeaveFailed)
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('confirm-delete-modal')).toBeDefined()
    })
  })

  describe('no Leave affordance for an owner (AC-6.2)', () => {
    it('renders nothing member-specific when access is "owner" — no Leave button anywhere', async () => {
      vi.mocked(collaboratorsApi.list).mockResolvedValue([])
      renderDialog()
      await screen.findByTestId('collaborators-dialog-empty')

      expect(screen.queryByTestId('collaborators-dialog-leave-button')).toBeNull()
      expect(screen.queryByTestId('collaborators-dialog-shared-by')).toBeNull()
    })
  })

  describe('a11y — default focus on the heading (no input to land on)', () => {
    it('moves default focus to the dialog heading on open', () => {
      renderMemberDialog()
      const heading = screen.getByRole('heading', { name: strings.sharing.dialog.title })
      expect(document.activeElement).toBe(heading)
      expect(heading.getAttribute('tabindex')).toBe('-1')
    })

    it('Escape closes the dialog when no nested confirm is open', () => {
      const { onClose } = renderMemberDialog()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('Escape closes only the nested Leave-confirm layer first, leaving the dialog open', () => {
      const { onClose } = renderMemberDialog()

      fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
      expect(screen.getByTestId('confirm-delete-modal')).toBeDefined()

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(screen.queryByTestId('confirm-delete-modal')).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('collaborators-dialog')).toBeDefined()
    })

    it('Tab wraps between the two focusable elements (Close, Leave)', () => {
      renderMemberDialog()
      const leaveButton = screen.getByTestId('collaborators-dialog-leave-button')
      leaveButton.focus()
      expect(document.activeElement).toBe(leaveButton)

      fireEvent.keyDown(window, { key: 'Tab' })

      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    })
  })
})

// React StrictMode mounts, unmounts and remounts every component in dev. The
// unmount cleanup flips `isMountedRef` to false; if the remount does not set it
// back, every async result is dropped and the dialog sticks on "Adding…".
describe('CollaboratorsDialog — under StrictMode', () => {
  it('owner mode: an add completes and the dialog leaves the submitting state', async () => {
    vi.mocked(collaboratorsApi.list).mockResolvedValue([])
    vi.mocked(collaboratorsApi.add).mockResolvedValue({
      id: 'grant-new',
      email: 'new@welld.ch',
      accessLevel: 'viewer',
      createdAt: '2026-08-07T10:00:00.000Z',
      identity: { status: 'active', name: null },
    })
    render(
      <StrictMode>
        <CollaboratorsDialog estimateId="est-1" access="owner" onClose={vi.fn()} />
      </StrictMode>,
    )
    await screen.findByTestId('collaborators-dialog-empty')

    await fillAndSubmitAdd('new@welld.ch')

    await screen.findByText('new@welld.ch')
    const input = screen.getByTestId('collaborators-dialog-email-input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('member mode: a failed Leave shows its inline error', async () => {
    vi.mocked(collaboratorsApi.leave).mockRejectedValue(new Error('network'))
    render(
      <StrictMode>
        <CollaboratorsDialog estimateId="est-1" access="viewer" owner={activeOwnerIdentity} onClose={vi.fn()} />
      </StrictMode>,
    )

    fireEvent.click(screen.getByTestId('collaborators-dialog-leave-button'))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

    const errorEl = await screen.findByTestId('confirm-delete-error')
    expect(errorEl.textContent).toBe(strings.sharing.errors.genericLeaveFailed)
  })
})
