/**
 * useImportOffer — encapsulates the logic for the one-time legacy localStorage
 * import offer (US-5, AC-5.1, AC-5.2, AC-5.3, AC-5.4).
 *
 * Responsibilities:
 *   • Detect legacy `estimai_project_*` keys via projects.ts `loadProjects()`.
 *   • Offer only the local estimates not yet in the account (AC-5.1): it waits
 *     for the account list and remembers, in localStorage, what it imported.
 *   • Check (and set) the session-scoped dismissal flag in sessionStorage.
 *   • Drive the 3-phase modal (offer → importing → results) through local state.
 *   • Call `estimatesApi.importEstimates` with the fully-assembled payloads.
 *   • Trigger a list refresh (`onListRefresh`) after the import resolves.
 *   • NEVER delete any localStorage key (AC-5.3, AC-5.4).
 *
 * The hook exposes a minimal surface area; the modal component receives only
 * what it needs to render.
 *
 * Note: the offer is derived from the account list during render (useMemo), not
 * set from an effect, which would violate the react-hooks/set-state-in-effect rule.
 */

import { useCallback, useMemo, useState } from 'react'
import { loadProject, loadProjects } from '../lib/projects'
import * as estimatesApi from '../lib/estimatesApi'
import type { EstimateImportResult, EstimateListItem } from '../lib/estimatesApi'
import type { ProjectMeta } from '../types'
import type { ImportPhase } from '../components/ImportOfferModal'
import { strings } from '../strings'

/** sessionStorage key used to remember "offer dismissed this session" (AC-5.3). */
export const OFFER_DISMISSED_KEY = 'import_offer_dismissed'

/**
 * localStorage key recording what this browser already imported:
 * `{ [localId]: serverIds[] }`. Never removed, like the local estimates.
 */
export const IMPORTED_KEY = 'estimai_imported'

type ImportedRecord = Record<string, string[]>

const readImported = (): ImportedRecord => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IMPORTED_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as ImportedRecord) : {}
  } catch {
    return {}
  }
}

const recordImported = (results: EstimateImportResult[]) => {
  const record = readImported()
  for (const result of results) {
    if (result.status !== 'imported' || !result.id) continue
    record[result.localId] = [...(record[result.localId] ?? []), result.id]
  }
  localStorage.setItem(IMPORTED_KEY, JSON.stringify(record))
}

/**
 * The local estimates not yet in the account (AC-5.1): one is already there
 * when a copy this browser imported is still in the list, or, for imports made
 * before that was recorded, when the account has an estimate with its name.
 */
export const pendingImports = (
  local: ProjectMeta[],
  account: EstimateListItem[],
  imported: ImportedRecord,
): ProjectMeta[] => {
  const ids = new Set(account.map((item) => item.id))
  const names = new Set(account.map((item) => item.name.trim()))
  return local.filter(
    (meta) => !(imported[meta.id] ?? []).some((id) => ids.has(id)) && !names.has(meta.name.trim()),
  )
}

export type UseImportOfferReturn = {
  /** Whether the ImportOfferModal should be rendered. */
  showOffer: boolean
  /** Local ProjectMeta list (populated when showOffer is true). */
  localEstimates: ProjectMeta[]
  /** Current phase of the import flow. */
  phase: ImportPhase
  /** Per-estimate results (non-null only after the API call returns). */
  results: EstimateImportResult[] | null
  /** Accept handler — assembles payload, calls the API, shows results. */
  handleAccept: () => Promise<void>
  /** Decline handler — sets the session flag, hides the modal. */
  handleDecline: () => void
  /** Close handler (results phase) — hides the modal. */
  handleClose: () => void
}

/**
 * @param onListRefresh — callback the hook calls after a successful (or
 *   partial) import to trigger a re-fetch of the estimates list (AC-5.2).
 */
export const useImportOffer = (
  account: EstimateListItem[] | null,
  onListRefresh: () => void,
): UseImportOfferReturn => {
  // Nothing is offered until the account list is known (null while it loads or failed).
  const candidates = useMemo(
    () => (account ? pendingImports(loadProjects(), account, readImported()) : []),
    [account],
  )
  // What "Import all" took, kept for the results while the list refreshes underneath.
  const [taken, setTaken] = useState<ProjectMeta[] | null>(null)
  const [closed, setClosed] = useState(() => sessionStorage.getItem(OFFER_DISMISSED_KEY) !== null)
  const [phase, setPhase] = useState<ImportPhase>('offer')
  const [results, setResults] = useState<EstimateImportResult[] | null>(null)

  const localEstimates = taken ?? candidates
  const showOffer = !closed && localEstimates.length > 0

  const handleDecline = useCallback(() => {
    // Remember the dismissal for the rest of the session (AC-5.3).
    sessionStorage.setItem(OFFER_DISMISSED_KEY, '1')
    setClosed(true)
  }, [])

  const handleAccept = useCallback(async () => {
    setTaken(localEstimates)
    setPhase('importing')

    // Build the import payload: for each local project, load its full data.
    const items = localEstimates.flatMap((meta) => {
      const data = loadProject(meta.id)
      if (!data) return []
      return [
        {
          localId: meta.id,
          name: data.name || strings.estimatesList.untitled,
          author: data.author || '',
          content: {
            params: data.params,
            releases: data.releases,
            acts: data.acts,
          },
        },
      ]
    })

    try {
      const { results: importResults } = await estimatesApi.importEstimates(items)
      recordImported(importResults)
      setResults(importResults)
      setPhase('results')
      // Refresh the list so imported estimates appear (AC-5.2).
      onListRefresh()
    } catch {
      // If the whole request fails (network / 400 / 401), show an empty results
      // set so the user sees the modal close path rather than a frozen spinner.
      // Individual per-element failures are returned as status:"failed" inside
      // the 200 response body (handled by the results table), not as throws.
      setResults([])
      setPhase('results')
    }
  }, [localEstimates, onListRefresh])

  const handleClose = useCallback(() => {
    setClosed(true)
  }, [])

  return {
    showOffer,
    localEstimates,
    phase,
    results,
    handleAccept,
    handleDecline,
    handleClose,
  }
}
