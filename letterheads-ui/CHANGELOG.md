# @operai/letterheads-ui

## 0.2.1

### Patch Changes

- 5ddbb9a: A refused preview lists each refused value with a link to its control, and a header that does not fit because of its logo says so — in the summary, under the Header heading and under the logo's height. The logo height hint says the logo must fit the top margin with the header lines.

## 0.2.0

### Minor Changes

- 4b6e43e: Add letterheads-ui (specs/20261116-letterhead-service): the Letterheads tool as a federated remote at `/letterheads`, gated by `letterheads:access`. It has the configurator form for the letterhead of an entity (variants, zones, colours, texts and their placeholders, a refused-values error summary), logo and background upload, a live preview of the sample document through `PagePreview`, save with refused values, conflict handling and a leave guard, and the history with version view and restore, with read-only modes for a holder of access without `letterhead:manage` on the entity. It also has the 403, 503 and failure states, English and Italian copy with parity and no-hard-coded-strings tests, and the API client for letterhead-api.
