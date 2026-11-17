import { Outlet } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ToolLayout } from '@operai/ui'
import { LetterheadsContext } from '../hooks/useLetterheads'
import type { LetterheadsContextValue } from '../hooks/useLetterheads'
import { useResource } from '../hooks/useResource'
import { getCatalog, getLetterheads } from '../lib/letterheadsApi'
import type { Entity, LetterheadList } from '../lib/types'
import { strings } from '../strings'
import { LoadFailure, Loading } from './LoadState'

/**
 * LetterheadsShell — letterheads-ui's root layout: the tool title (h1) and the routed page
 * (ToolLayout `wide`, design § Component inventory). No suite chrome and no auth guard: the shell
 * owns both and mounts this remote only for `letterheads:access` holders (AC-8.1, design F1,
 * ADR 20260709-suite-frontend-module-federation). Inside the remote nothing re-checks the grant.
 *
 * It loads `GET /v1/catalog` and `GET /v1/letterheads` once, together, and hands both to the page
 * through `LetterheadsContext`. Until they answer the page area shows the loading state; a failure
 * shows the retry banner (the 503 "authorization service unavailable" variant for a fail-closed
 * `auth`, ADR 20260716-refund-api-authorization-enforcing-resource-server) or PermissionDenied on a 403. The title stays on screen
 * in every state.
 */
const loadFrame = async (signal: AbortSignal): Promise<LetterheadsContextValue> => {
  const [catalog, letterheads] = await Promise.all([getCatalog({ signal }), getLetterheads({ signal })])
  return { catalog, letterheads }
}

export default function LetterheadsShell() {
  const frame = useResource(loadFrame)
  // The list as a write left it (T24), for the frame it was refreshed on: a reload of the frame starts over.
  const [fresh, setFresh] = useState<{ base: LetterheadsContextValue; list: LetterheadList } | null>(null)
  const base = frame.data
  const refresh = useCallback(
    async (known?: { entity: Entity; activeVersion: number }) => {
      if (base === null) return
      if (known !== undefined) {
        setFresh((current) => {
          const list = current?.base === base ? current.list : base.letterheads
          return {
            base,
            list: { ...list, [known.entity]: { ...list[known.entity], activeVersion: known.activeVersion } },
          }
        })
      }
      try {
        const list = await getLetterheads()
        setFresh({ base, list })
      } catch {
        // The list stays as it is (and as `known` made it): a failed refresh is not the person's problem.
      }
    },
    [base],
  )
  const value = useMemo<LetterheadsContextValue | null>(
    () =>
      base === null ? null : { ...base, letterheads: fresh?.base === base ? fresh.list : base.letterheads, refresh },
    [base, fresh, refresh],
  )

  let content: ReactNode
  if (frame.status === 'loading') content = <Loading label={strings.nav.loading} />
  else if (frame.status === 'error') content = <LoadFailure error={frame.error} onRetry={frame.retry} />
  else
    content = (
      <LetterheadsContext.Provider value={value!}>
        <Outlet />
      </LetterheadsContext.Provider>
    )

  return (
    <ToolLayout title={strings.nav.heading} width="wide" testId="letterheads-shell">
      {content}
    </ToolLayout>
  )
}
