---
"@operai/refund-ui": minor
"@operai/refund-api": minor
"@operai/admin-ui": patch
---

A mileage expense states where the trip starts and ends: two required fields, From and To, with Google address suggestions (the library's `AddressAutocomplete`, which also suggests companies and towns; when suggestions are unavailable the fields stay plain text). The line shows its route, the request PDF prints it and the register extract fills From and To. refund-api requires both for a mileage line on create and edit, and a draft mileage line written before must get them before it is submitted. admin-ui's employee address uses the same shared field. Needs `VITE_GOOGLE_MAPS_API_KEY` on the refund-ui Vercel project (infra/README.md).
