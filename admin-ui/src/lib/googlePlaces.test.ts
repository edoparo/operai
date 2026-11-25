/**
 * admin-ui's wrapper of the library's Places client: it adds this app's key and asks for street addresses only.
 * The client itself (debounce, supersession, session token, degradation) is tested where it lives:
 * `operai-ui/src/lib/googlePlaces.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@operai/ui', async (importOriginal) => {
  const original = await importOriginal<typeof import('@operai/ui')>()
  return { ...original, createAddressSuggester: vi.fn(() => ({ search: vi.fn(), selectSuggestion: vi.fn(), reset: vi.fn(), dispose: vi.fn() })) }
})

import { createAddressSuggester as createLibrarySuggester } from '@operai/ui'
import { createAddressSuggester } from './googlePlaces'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createAddressSuggester (admin-ui)', () => {
  it('passes the caller’s options through, with admin-ui’s key and street addresses only', () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'admin-key')
    const onResults = vi.fn()
    createAddressSuggester({ onResults, language: 'it', places: 'any' })
    expect(createLibrarySuggester).toHaveBeenCalledWith(
      expect.objectContaining({ onResults, language: 'it', places: 'addresses', apiKey: 'admin-key' }),
    )
  })
})
