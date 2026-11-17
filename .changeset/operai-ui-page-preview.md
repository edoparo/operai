---
'@operai/ui': minor
---

Add `PagePreview` and `useLatestResult` (specs/20261116-letterhead-service): `PagePreview` shows a document's rendered pages (states loading, ready, updating, failed and blocked; one `figure` per page with `img alt="Page N of M"` and a visually hidden `figcaption` holding the page text; a single tab stop with `aria-busy`; previous pages kept and unchanged images keep their DOM node), and `useLatestResult` keeps the answer to the latest input, and when the service answers busy (`LatestResultBusyError`, with `parseRetryAfter` for a `Retry-After` header) waits and asks again while the previous result stays on screen. `axe-core` joins the dev dependencies so the component's axe checks run in `pnpm test`.
