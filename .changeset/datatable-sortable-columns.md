---
"@operai/ui": minor
---

`DataTable` supports sortable columns. A column marked `sortable`, on a table given `sort` and `onSortChange`, gets a header button and an `aria-sort` state. A first click sorts ascending (`firstSortDirection: 'desc'` for dates and amounts) and a second click reverses the order. The table still never sorts rows itself: the page does, on the server for a paginated list.
