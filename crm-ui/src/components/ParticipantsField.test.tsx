/**
 * @vitest-environment jsdom
 *
 * ParticipantsField (specs/20261110-activities design.md § Accessibility): removing a participant chip returns focus to the
 * picker input, not to <body>.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ParticipantsField from './ParticipantsField'
import type { PersonChoice } from './PersonPicker'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const Harness = () => {
  const [value, setValue] = useState<PersonChoice[]>([
    { id: 'u-dan', label: 'Dan Dev' },
    { id: 'u-eve', label: 'Eve Ops' },
  ])
  return <ParticipantsField value={value} onChange={setValue} testId="p" />
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ParticipantsField focus', () => {
  it('after a chip is removed, focus returns to the picker input (also for the last chip)', () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ users: [] }), { status: 200 }))
    render(<Harness />)
    const input = screen.getByTestId('p-picker-input')

    const first = screen.getByRole('button', { name: /Dan Dev/ })
    first.focus()
    fireEvent.click(first)
    expect(screen.queryByText('Dan Dev')).toBeNull()
    expect(document.activeElement).toBe(input)

    const last = screen.getByRole('button', { name: /Eve Ops/ })
    last.focus()
    fireEvent.click(last)
    expect(screen.queryByRole('list')).toBeNull()
    expect(document.activeElement).toBe(input)
  })
})
