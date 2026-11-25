/**
 * googlePlaces — admin-ui's door to the library's Google Places client (`@operai/ui`, moved there on 2026-11-25 so
 * every tool shares one client and one `AddressAutocomplete` field; specs/20260803-employee-address, ADR
 * 20260804-google-places-browser-direct-referrer-restricted-key).
 *
 * The one thing admin-ui adds is its key: `VITE_GOOGLE_MAPS_API_KEY`, a public, referrer-restricted, build-time
 * variable of this app. `AddressSection` hands `createAddressSuggester` to the field, which keeps this module the seam
 * its tests mock.
 */

import { createAddressSuggester as createLibrarySuggester } from '@operai/ui'
import type { AddressSuggester, AddressSuggesterOptions } from '@operai/ui'

export type {
  AddressComponents,
  AddressLocale,
  AddressSuggester,
  AddressSuggesterOptions,
  PlaceDetails,
  PlaceSuggestion,
} from '@operai/ui'

/** The library's suggester with admin-ui's key; street addresses only (no business, no POI). */
export const createAddressSuggester = (options: AddressSuggesterOptions): AddressSuggester =>
  createLibrarySuggester({
    ...options,
    places: 'addresses',
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined,
  })
