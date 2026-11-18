/**
 * @vitest-environment jsdom
 *
 * Page tests for OfficesPage (`/offices`). `officesApi`, `getScope` and
 * `usePermissions` are mocked at their seams; the form and confirm dialogs are real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Permission } from 'shell/session'
import { ApiError } from '../lib/api'
import type { Office } from '../lib/types'

const { usePermissions, listOffices, createOffice, updateOffice, getScope } = vi.hoisted(() => ({
  usePermissions: vi.fn(),
  listOffices: vi.fn(),
  createOffice: vi.fn(),
  updateOffice: vi.fn(),
  getScope: vi.fn(),
}))
vi.mock('shell/session', () => ({ usePermissions }))
vi.mock('../lib/officesApi', () => ({ listOffices, createOffice, updateOffice }))
vi.mock('../lib/scopeApi', () => ({ getScope }))

import OfficesPage from './OfficesPage'

const ASSETS: Permission = { resource: 'asset', action: 'manage' }
const LEDGER: Permission = { resource: 'ledger', action: 'manage' }

const AGNO: Office = { id: 'o1', name: 'CH - Agno', entity: 'welld_ch', archived: false, assetCount: 3 }
const MILANO: Office = { id: 'o2', name: 'YoRoom - Milano', entity: 'welld_it', archived: true, assetCount: 0 }

beforeEach(() => {
  usePermissions.mockReturnValue({ epoch: 0, apps: ['inventory'], roles: [], departments: [], permissions: [ASSETS] })
  getScope.mockResolvedValue({ asset: ['welld_ch', 'welld_it'], ledger: [] })
  listOffices.mockResolvedValue({ items: [AGNO, MILANO] })
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderPage = async () => {
  render(<OfficesPage />)
  return await screen.findByRole('table')
}

describe('OfficesPage', () => {
  it('without asset:manage shows permission denied and calls nothing', () => {
    usePermissions.mockReturnValue({ epoch: 0, apps: [], roles: [], departments: [], permissions: [LEDGER] })
    render(<OfficesPage />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(listOffices).not.toHaveBeenCalled()
  })

  it('lists name, entity, assets held and status, archived included', async () => {
    const table = await renderPage()
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[1].textContent).toContain('CH - Agno')
    expect(rows[1].textContent).toContain('WellD CH')
    expect(rows[1].textContent).toContain('3')
    expect(rows[1].textContent).toContain('Active')
    expect(rows[2].textContent).toContain('Archived')
    expect(within(rows[2]).getByRole('button', { name: 'Restore YoRoom - Milano' })).not.toBeNull()
  })

  it('adds an office with name and entity, then reloads', async () => {
    createOffice.mockResolvedValue({ ...AGNO, id: 'o3', name: 'CH - Lugano' })
    await renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add office' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: ' CH - Lugano ' } })
    fireEvent.change(within(dialog).getByLabelText(/^Entity/), { target: { value: 'welld_ch' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add office' }))

    await waitFor(() => expect(createOffice).toHaveBeenCalledWith({ name: 'CH - Lugano', entity: 'welld_ch' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listOffices).toHaveBeenCalledTimes(2))
  })

  it('office_name_taken shows under the name and keeps the dialog open', async () => {
    createOffice.mockRejectedValue(new ApiError({ status: 409, title: 'Conflict', code: 'office_name_taken' }))
    await renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add office' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'CH - Agno' } })
    fireEvent.change(within(dialog).getByLabelText(/^Entity/), { target: { value: 'welld_ch' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add office' }))

    expect(await within(dialog).findByText('An office with this name already exists.')).not.toBeNull()
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('renames an office, sending only what changed', async () => {
    updateOffice.mockResolvedValue({ ...AGNO, name: 'CH - Agno 2' })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Edit CH - Agno' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'CH - Agno 2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateOffice).toHaveBeenCalledWith('o1', { name: 'CH - Agno 2' }))
  })

  it('archives after confirmation', async () => {
    updateOffice.mockResolvedValue({ ...AGNO, archived: true })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Archive CH - Agno' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(updateOffice).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(updateOffice).toHaveBeenCalledWith('o1', { archived: true }))
    await waitFor(() => expect(listOffices).toHaveBeenCalledTimes(2))
  })

  it('restores an archived office', async () => {
    updateOffice.mockResolvedValue({ ...MILANO, archived: false })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Restore YoRoom - Milano' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(updateOffice).toHaveBeenCalledWith('o2', { archived: false }))
  })

  it('office_in_use keeps the confirmation open with the message', async () => {
    updateOffice.mockRejectedValue(new ApiError({ status: 409, title: 'Conflict', code: 'office_in_use' }))
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Archive CH - Agno' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }))

    expect(await within(dialog).findByText('This office still holds assets: return or move them first.')).not.toBeNull()
    expect(screen.getByRole('alertdialog')).not.toBeNull()
  })

  it('shows an empty state when there are no offices', async () => {
    listOffices.mockResolvedValue({ items: [] })
    render(<OfficesPage />)
    expect(await screen.findByTestId('offices-empty')).not.toBeNull()
  })
})
