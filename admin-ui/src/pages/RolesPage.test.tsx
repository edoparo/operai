/**
 * @vitest-environment jsdom
 *
 * Component tests for RolesPage — Screen A1 + Modal M1 (T17,
 * specs/004-auth-roles-permissions).
 *
 * Covers:
 *   (A) Loading: adminApi.listRoles is pending → SkeletonListRows is visible.
 *   (B) Populated: renders the table (Name/Description/System/Rules columns)
 *       with both a system role (SystemBadge + aria-disabled Delete + title)
 *       and a custom role (no badge, Delete enabled).
 *   (C) Empty: listRoles resolves [] → "No roles yet" (the header keeps "New role")
 *       (never a dead end).
 *   (D) Error: listRoles rejects (non-403 ApiError) → ErrorBanner + Retry
 *       re-fetches.
 *   (E) Forbidden: listRoles rejects with 403 → PermissionDenied renders
 *       in place of the table, no "New role" button.
 *   (F) Create (M1): "New role" → fill name/description → submit →
 *       createRole called, then navigate to the new role's editor.
 *   (G) Create 409: createRole rejects with 409 → inline field error, modal
 *       stays open.
 *   (H) Delete: a custom role's Delete → ConfirmDeleteModal → confirm →
 *       deleteRole called → list re-fetches.
 *   (I) System role Delete does nothing (guardrail): clicking a system
 *       role's Delete never opens ConfirmDeleteModal.
 *
 * Strategy mirrors AuditPage.test.tsx (T21) / EstimatesPage.test.tsx: mock
 * `../lib/adminApi` at the module level (keeping the real `ApiError` via
 * importOriginal) and mock `useNavigate` from `@tanstack/react-router`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RolesPage from './RolesPage'
import { clearFlash, peekFlash, setFlash } from '../lib/flash'
import type { Role } from '../lib/adminApi'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the mocked modules.
// ---------------------------------------------------------------------------

vi.mock('../lib/adminApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/adminApi')>()
  return {
    ...original,
    listRoles: vi.fn(),
    createRole: vi.fn(),
    deleteRole: vi.fn(),
  }
})

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    useNavigate: () => navigateMock,
  }
})

import * as adminApi from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const systemRole: Role = {
  id: 'role-employee',
  name: 'employee',
  description: 'Baseline role for every user.',
  isSystem: true,
  ruleCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const customRole: Role = {
  id: 'role-accounting-lead',
  name: 'Accounting Lead',
  description: null,
  isSystem: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

/** Returns a promise that never resolves — keeps listRoles "pending" (loading). */
function pendingPromise<T>(): Promise<T> {
  return new Promise(() => {})
}

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RolesPage — list states', () => {
  it('renders SkeletonListRows while listRoles is in-flight', () => {
    vi.mocked(adminApi.listRoles).mockReturnValue(pendingPromise())

    render(<RolesPage />)

    expect(screen.getByTestId('skeleton-list-rows')).not.toBeNull()
    expect(screen.queryByTestId('roles-table')).toBeNull()
  })

  it('renders the roles table with both a system and a custom role', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([systemRole, customRole])

    render(<RolesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('roles-table')).not.toBeNull()
    })

    // System role: badge + rule count + aria-disabled Delete with a title.
    expect(screen.getByText('employee')).not.toBeNull()
    expect(screen.getByTestId('system-badge')).not.toBeNull()
    const systemDelete = screen.getByTestId(`role-delete-${systemRole.id}`)
    expect(systemDelete.getAttribute('aria-disabled')).toBe('true')
    expect(systemDelete.getAttribute('title')).toBe("System roles can't be deleted")

    // Custom role: no badge, Delete not aria-disabled.
    expect(screen.getByText('Accounting Lead')).not.toBeNull()
    const customDelete = screen.getByTestId(`role-delete-${customRole.id}`)
    expect(customDelete.getAttribute('aria-disabled')).toBe('false')

    expect(screen.queryByTestId('skeleton-list-rows')).toBeNull()
  })

  it('renders "No roles yet" when the list is empty (the page header keeps the one "New role" action)', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([])

    render(<RolesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('roles-empty-state')).not.toBeNull()
    })
    expect(screen.getByText('No roles yet')).not.toBeNull()
    // INC-22: an empty state is a StatePanel — a title (h3 under the page's h2) and a body.
    expect(screen.getByRole('heading', { level: 3, name: 'No roles yet' })).not.toBeNull()
    expect(screen.queryByTestId('roles-table')).toBeNull()
  })

  it('renders an ErrorBanner and retries on click', async () => {
    vi.mocked(adminApi.listRoles)
      .mockRejectedValueOnce(
        new ApiError({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Boom.' }),
      )
      .mockResolvedValueOnce([customRole])

    render(<RolesPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull()
    })
    expect(screen.getByRole('alert').textContent).toContain('Boom.')

    fireEvent.click(screen.getByTestId('error-banner-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('roles-table')).not.toBeNull()
    })
    expect(adminApi.listRoles).toHaveBeenCalledTimes(2)
  })

  it('renders PermissionDenied (not the table or "New role") on a 403', async () => {
    vi.mocked(adminApi.listRoles).mockRejectedValue(
      new ApiError({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Not an admin.' }),
    )

    render(<RolesPage />)

    await waitFor(() => {
      expect(screen.getByTestId('permission-denied')).not.toBeNull()
    })
    expect(screen.queryByTestId('roles-table')).toBeNull()
    expect(screen.queryByTestId('roles-new-button')).toBeNull()
  })
})

describe('RolesPage — create (Modal M1)', () => {
  it('creates a role and navigates to its editor', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([customRole])
    vi.mocked(adminApi.createRole).mockResolvedValue({
      id: 'role-new',
      name: 'Support',
      description: 'Handles tickets.',
      isSystem: false,
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    })

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId('roles-new-button'))
    expect(screen.getByTestId('create-role-modal')).not.toBeNull()

    fireEvent.change(screen.getByTestId('create-role-name'), { target: { value: 'Support' } })
    fireEvent.change(screen.getByTestId('create-role-description'), { target: { value: 'Handles tickets.' } })
    fireEvent.click(screen.getByTestId('create-role-submit'))

    await waitFor(() => {
      expect(adminApi.createRole).toHaveBeenCalledWith({ name: 'Support', description: 'Handles tickets.' })
    })
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/roles/$id', params: { id: 'role-new' } })
    })
    expect(screen.queryByTestId('create-role-modal')).toBeNull()
    // INC-19: the editor it navigates to confirms the creation.
    expect(peekFlash('role:role-new')).toBe('Role "Support" created')
    clearFlash('role:role-new')
  })

  it('shows an inline field error on a 409 duplicate name, and keeps the modal open', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([customRole])
    vi.mocked(adminApi.createRole).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: 'A role named "Accounting Lead" already exists.',
      }),
    )

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId('roles-new-button'))
    fireEvent.change(screen.getByTestId('create-role-name'), { target: { value: 'Accounting Lead' } })
    fireEvent.click(screen.getByTestId('create-role-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('create-role-name-error').textContent).toBe(
        'A role named "Accounting Lead" already exists.',
      )
    })
    expect(screen.getByTestId('create-role-modal')).not.toBeNull()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('cancels without calling createRole', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([customRole])

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId('roles-new-button'))
    fireEvent.click(screen.getByTestId('create-role-cancel'))

    expect(screen.queryByTestId('create-role-modal')).toBeNull()
    expect(adminApi.createRole).not.toHaveBeenCalled()
  })
})

describe('RolesPage — delete (Dialog D1)', () => {
  it('Create role: a name typed then cleared is explained on blur; the field is aria-required (INC-16)', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([customRole])

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId('roles-new-button'))
    const input = screen.getByTestId('create-role-name')
    expect(input.getAttribute('aria-required')).toBe('true')

    fireEvent.blur(input) // nothing typed yet: no error, submit simply disabled
    expect(screen.queryByTestId('create-role-name-error')).toBeNull()

    fireEvent.change(input, { target: { value: 'S' } })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(screen.getByTestId('create-role-name-error').textContent).toBe('Name is required.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  it('deletes a custom role via ConfirmDeleteModal and refreshes the list', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValueOnce([systemRole, customRole]).mockResolvedValueOnce([systemRole])
    vi.mocked(adminApi.deleteRole).mockResolvedValue(undefined)

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId(`role-delete-${customRole.id}`))
    expect(screen.getByTestId('confirm-delete-modal')).not.toBeNull()

    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

    await waitFor(() => {
      expect(adminApi.deleteRole).toHaveBeenCalledWith(customRole.id)
    })
    await waitFor(() => {
      expect(screen.queryByText('Accounting Lead')).toBeNull()
    })
    expect(adminApi.listRoles).toHaveBeenCalledTimes(2)
    // INC-19: the delete is confirmed above the list.
    expect(screen.getByTestId('roles-success').textContent).toBe('Role "Accounting Lead" deleted')
  })

  it('shows the confirmation of a delete made in the role editor (flash)', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([systemRole])
    setFlash('roles', 'Role "Support" deleted')

    render(<RolesPage />)

    expect(screen.getByTestId('roles-success').textContent).toBe('Role "Support" deleted')
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())
  })

  it('never opens ConfirmDeleteModal for a system role (guardrail)', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([systemRole])

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId(`role-delete-${systemRole.id}`))

    expect(screen.queryByTestId('confirm-delete-modal')).toBeNull()
    expect(adminApi.deleteRole).not.toHaveBeenCalled()
  })

  it('shows an inline error in ConfirmDeleteModal when deleteRole fails', async () => {
    vi.mocked(adminApi.listRoles).mockResolvedValue([customRole])
    vi.mocked(adminApi.deleteRole).mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Internal Server Error',
        status: 500,
        detail: 'Delete failed. Try again.',
      }),
    )

    render(<RolesPage />)
    await waitFor(() => expect(screen.getByTestId('roles-table')).not.toBeNull())

    fireEvent.click(screen.getByTestId(`role-delete-${customRole.id}`))
    fireEvent.click(screen.getByTestId('confirm-delete-confirm'))

    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete-error').textContent).toBe('Delete failed. Try again.')
    })
    expect(screen.getByTestId('confirm-delete-modal')).not.toBeNull()
  })
})
