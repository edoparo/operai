import { useCallback, useId } from 'react'
import { PageHeader, StatePanel } from '@operai/ui'
import EntityProfileForm from '../components/EntityProfileForm'
import LetterheadCard from '../components/LetterheadCard'
import TemplatesCard from '../components/TemplatesCard'
import { LoadFailure, Loading } from '../components/LoadState'
import { listEntityProfiles } from '../lib/crmApi'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { useResource } from '../hooks/useResource'
import type { EntityProfile } from '../lib/types'
import { strings } from '../strings'

/**
 * SettingsPage — the letterhead and standard terms printed on offers, one form
 * per entity the caller manages deals for (specs/018 O2). The tab is shown to
 * `deal:manage` holders only; the list itself needs `deal:financials` (a 403
 * renders the denied state) and a save needs `deal:manage` over that entity.
 */
export default function SettingsPage() {
  const t = strings.settings
  const titleId = useId()
  const { dealEntities } = useCrmCapabilities()
  const load = useCallback((signal: AbortSignal) => listEntityProfiles({ signal }), [])
  const profiles = useResource(load)

  let content
  if (dealEntities.length === 0)
    content = (
      <StatePanel title={t.emptyTitle} testId="crm-settings-empty">
        {t.emptyBody}
      </StatePanel>
    )
  else if (profiles.status === 'loading') content = <Loading label={t.loading} rows={4} />
  else if (profiles.status === 'error') content = <LoadFailure error={profiles.error} onRetry={profiles.retry} />
  else
    content = (
      <div className="flex flex-col gap-4">
        {dealEntities.map((entity) => {
          const profile = profiles.data!.items.find((item) => item.entity === entity) ?? null
          // A saved or re-lettered profile replaces its row, so the letterhead card sees it at once.
          const changed = (next: EntityProfile) =>
            profiles.replace({ items: [...profiles.data!.items.filter((item) => item.entity !== entity), next] })
          return (
            <div key={entity} className="flex flex-col gap-4">
              <EntityProfileForm entity={entity} profile={profile} onSaved={changed} />
              <LetterheadCard entity={entity} profile={profile} onChanged={changed} />
              <TemplatesCard entity={entity} />
            </div>
          )
        })}
      </div>
    )

  return (
    <section aria-labelledby={titleId} data-testid="crm-settings-page">
      <PageHeader title={t.heading} titleId={titleId} description={t.description} />
      {content}
    </section>
  )
}
