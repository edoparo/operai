import { useState } from 'react'
import { Button, Card } from '@operai/ui'
import type { Project } from '../lib/types'
import { strings } from '../strings'
import TermsBlock from './TermsBlock'
import TermsFormDialog from './TermsFormDialog'

/**
 * TermsCard — the terms of a hand-made project (specs/022 AC-5.3, AC-5.4): its dates and the terms of
 * its type, or none when it has none (they are optional as a whole). There is nothing of a purchase
 * order here — no deal, estimate, Bexio order id, referent or ops-manager — because a hand-made project
 * never has one (AC-5.2); a project made from a deal shows its terms inside its purchase order card.
 *
 * A holder of manage projects adds terms (not on an `internal` project, which has none, and not on a
 * closed or cancelled one, whose existing terms stay editable) and edits or ends them. Removing them is
 * T33's. Every write tells the page (`onChanged`), which reads the project again.
 */
export default function TermsCard({
  project,
  canManage,
  onChanged,
  onStale,
}: {
  project: Project
  canManage: boolean
  onChanged: (message: string) => void
  onStale: () => void
}) {
  const t = strings.terms
  const [adding, setAdding] = useState(false)
  const open = project.state !== 'closed' && project.state !== 'cancelled'
  const canAdd = canManage && project.type !== 'internal' && open && project.terms === null

  return (
    <Card
      title={t.title}
      data-testid="project-terms"
      action={
        canAdd && (
          <Button size="sm" aria-haspopup="dialog" onClick={() => setAdding(true)} data-testid="project-terms-add">
            {t.add}
          </Button>
        )
      }
    >
      {project.type === 'internal' ? (
        <p className="text-sm text-soft">{t.internal}</p>
      ) : project.terms === null ? (
        <>
          {canManage && !open && <p className="text-sm text-soft">{t.notOpen}</p>}
          <p className="text-sm text-soft">{t.empty}</p>
        </>
      ) : (
        <TermsBlock
          project={project}
          terms={project.terms}
          canManage={canManage}
          onChanged={onChanged}
          onStale={onStale}
        />
      )}
      {adding && (
        <TermsFormDialog
          project={project}
          onSaved={() => {
            setAdding(false)
            onChanged(t.saved.created)
          }}
          onCancel={() => setAdding(false)}
          onStale={() => {
            setAdding(false)
            onStale()
          }}
        />
      )}
    </Card>
  )
}
