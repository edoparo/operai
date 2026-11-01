import { DataTable as LibraryDataTable } from '@operai/ui'
import type { DataTableColumn, DataTableProps } from '@operai/ui'

/**
 * DataTable — the one table primitive (T26, specs/015-hardware-inventory;
 * design.md § NEW components: "no table primitive exists; MileageRatesPage
 * inlines one. Six tables here need the same caption, `scope`, numeric
 * right-alignment and responsive scroll wrapper"). The assets list, rules,
 * fiscal years, year detail, the schedule and the roll-forward statement all
 * render through it.
 *
 * Contract (design.md § Accessibility "Data tables"):
 *   - an sr-only `<caption>` names the table (and the active filters — the page
 *     composes the text); it is also the scroll region's label unless
 *     `regionLabel` says otherwise;
 *   - `<th scope="col">` per column; the column flagged `rowHeader` renders its
 *     cells as `<th scope="row">` (the description or the year);
 *   - `numeric` columns are right-aligned in DM Mono with `tabular-nums`, header
 *     and cells alike; the cell text carries its own currency code (the page
 *     formats it with `formatMoney`) — this component never formats or computes;
 *   - wider than the viewport -> a `role="region"` scroll wrapper with
 *     `tabindex="0"` and an `aria-label`, so keyboard users can scroll it;
 *   - no sorting, so no `aria-sort` and no header buttons;
 *   - `focusRowKey` moves focus to that row's header cell (made focusable with
 *     `tabIndex={-1}`, never a tab stop) — T4's "after adding, focus moves to
 *     the new row's header cell".
 *
 * Empty and loading states are the page's: with no rows only the header renders.
 *
 * Now a thin adapter over @operai/ui's `DataTable` (ADR-0050), which was
 * extracted from this component: same props and test ids.
 */

export type { DataTableColumn, DataTableProps }

export default function DataTable<T>(props: DataTableProps<T>) {
  return <LibraryDataTable {...props} />
}
