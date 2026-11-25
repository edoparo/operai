/**
 * places — refund-ui's door to the library's Google Places client (`@operai/ui`): the From and To of a mileage trip.
 * It adds this app's key (`VITE_GOOGLE_MAPS_API_KEY`, public and referrer-restricted, set on the refund-ui Vercel
 * project) and asks for any place, since a trip may start or end at a company or in a town, not only at a street
 * address. Without a key the fields stay plain text inputs (the library's silent degradation). The seam tests mock.
 */

import { createAddressSuggester } from '@operai/ui'
import type { AddressSuggester, AddressSuggesterOptions } from '@operai/ui'

export const createTripSuggester = (options: AddressSuggesterOptions): AddressSuggester =>
  createAddressSuggester({
    ...options,
    places: 'any',
    apiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  })
