/**
 * strings.badges — the labels of the status chips (T26, specs/20261006-hardware-
 * inventory; design.md § NEW components: AssetStatusBadge). The entity and
 * currency chips' labels live in `strings.common` (T25).
 */
const en = {
  /** `AssetStatusBadge`'s label per `AssetStatus` — verbatim the six wire values. */
  assetStatus: {
    ordered: 'Ordered',
    in_stock: 'In stock',
    assigned: 'Assigned',
    in_repair: 'In repair',
    lost: 'Lost',
    disposed: 'Disposed',
  },
}

const it: typeof en = {
  assetStatus: {
    ordered: 'Ordinato',
    in_stock: 'In magazzino',
    assigned: 'Assegnato',
    in_repair: 'In riparazione',
    lost: 'Smarrito',
    disposed: 'Dismesso',
  },
}

export const badges = { en, it }
