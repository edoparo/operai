import { createContext, useContext } from 'react'
import type { Entity, Scope } from '../lib/types'

/**
 * The caller's CRM scope (`GET /scope`), loaded once by `CrmShell` and read by
 * every page: which entities `deal:manage` covers, whether the caller may
 * erase a contact, whether they see money (`deal:financials`, specs/018 US-1)
 * and whether they manage deals of every entity (the admin). UX only — the
 * server's 403 is the gate (ADR-0014). A missing flag counts as false, so an
 * older server never leaks a figure.
 */
export const ScopeContext = createContext<Scope>({ deal: [], canErase: false })

export type CrmCapabilities = {
  /** Entities the caller manages deals for; empty = read-only on deals. */
  dealEntities: readonly Entity[]
  canManageDeals: boolean
  canManageDealsOf: (entity: Entity) => boolean
  canErase: boolean
  /** The caller sees amounts, weighted values, totals, notes and offers. */
  financials: boolean
  /** `deal:manage` over every entity: may act for others (e.g. delete anyone's offer). */
  managesAll: boolean
}

export function useCrmCapabilities(): CrmCapabilities {
  const scope = useContext(ScopeContext)
  return {
    dealEntities: scope.deal,
    canManageDeals: scope.deal.length > 0,
    canManageDealsOf: (entity) => scope.deal.includes(entity),
    canErase: scope.canErase,
    financials: scope.financials === true,
    managesAll: scope.managesAll === true,
  }
}
