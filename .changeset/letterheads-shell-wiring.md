---
'@operai/shell': minor
---

Register the Letterheads tool (specs/20261116-letterhead-service): a sidebar entry for holders of `letterheads:access`, the gated `/letterheads` route, the federated remote entry (build-time and runtime config) with its version in the About modal, the CSP origins for letterheads and letterhead-api in `vercel.json`, and `VITE_LETTERHEADS_API_URL` as a trusted origin, exposed to the remote as `getLetterheadsApiBaseUrl`. Playwright now serves letterheads-ui and runs the Letterheads e2e (configurator, access, versions, browser contract) and the CRM offer wizard e2e on the letterhead service.
