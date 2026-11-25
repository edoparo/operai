---
"@operai/ui": minor
"@operai/shell": patch
"@operai/refund-api": minor
---

The Google Places client and an `AddressAutocomplete` field move into the component library, shared by every tool through the shell: the app passes its key and its texts, and chooses addresses only or any place (a company, a town). refund-api accepts and returns a mileage trip's start and end (`fromAddress`, `toAddress`, migration `20261125160000_mileage_trip_addresses`), prints the route in the request PDF and fills From and To in the register extract (format 4). The tools start using the field in the next release, once this shell is live (ADR 20261114, deploy rule).
