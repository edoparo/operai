import type { Activity, Release } from '../types'
import { type WarningCode, WARNING_META } from '../lib/healthWarnings'
import { computeActivityNums } from '../lib/activityNums'
import { DataTable, Dialog, Icon, StatePanel, VisuallyHidden } from '@operai/ui'
import { strings } from '../strings'

interface Props {
  activityWarnings: Map<string, WarningCode[]>
  releaseWarnings: Map<string, WarningCode[]>
  activities: Activity[]
  releases: Release[]
  onClose: () => void
}

/** Every warning of one activity or release, stacked in one cell (one row per record). */
function WarnList({ codes }: { codes: WarningCode[] }) {
  return (
    <div className="flex flex-col gap-2">
      {codes.map((code) => (
        <WarnBadge key={code} code={code} />
      ))}
    </div>
  )
}

function WarnBadge({ code }: { code: WarningCode }) {
  const m = WARNING_META[code]
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1 text-2xs font-medium ${m.colorClass}`}>
        <Icon name={m.icon} />
        <span>{m.title}</span>
      </span>
      <span className="text-2xs text-soft leading-relaxed">{m.description}</span>
    </div>
  )
}

export default function HealthWarningsModal({
  activityWarnings,
  releaseWarnings,
  activities,
  releases,
  onClose,
}: Props) {
  const activityNums = computeActivityNums(activities)
  const warnedActivities = activities.filter((a) => activityWarnings.has(a.id))
  const warnedReleases = releases.filter((r) => releaseWarnings.has(r.id))
  const t = strings.health
  const totalCount =
    [...activityWarnings.values()].reduce((n, ws) => n + ws.length, 0) +
    [...releaseWarnings.values()].reduce((n, ws) => n + ws.length, 0)

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          {t.title}
          {totalCount > 0 && (
            <>
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-2xs font-bold bg-org/20 text-org-text"
              >
                {totalCount}
              </span>
              <VisuallyHidden>{t.countLabel(totalCount)}</VisuallyHidden>
            </>
          )}
        </span>
      }
      size="lg"
      onClose={onClose}
      closeLabel={t.close}
      testIdPrefix="health-warnings"
    >
      {/* Body */}
      <div className="dialog-body overflow-y-auto max-h-[65vh]">
        {totalCount === 0 ? (
          // INC-22: the empty state is a StatePanel (h3 under the dialog's h2).
          <StatePanel title={t.allClear} testId="health-warnings-all-clear">
            {t.allClearBody}
          </StatePanel>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Activity warnings */}
            {warnedActivities.length > 0 && (
              <section>
                <p className="text-2xs font-mono uppercase tracking-widest text-soft mb-2">
                  {t.activitiesSection([...activityWarnings.values()].reduce((n, ws) => n + ws.length, 0))}
                </p>
                {/* INC-14: a read-only list of records with comparable columns → DataTable.
                    One row per activity; its warnings stack in the Warning cell. */}
                <DataTable
                  caption={t.activityCaption}
                  columns={[
                    {
                      id: 'num',
                      header: t.columns.num,
                      render: (a: Activity) => <span className="font-mono text-soft">{activityNums.get(a.id) ?? '—'}</span>,
                    },
                    {
                      id: 'activity',
                      header: t.columns.activity,
                      rowHeader: true,
                      render: (a: Activity) => (
                        <>
                          <div className="font-medium text-text">{a.act || t.unnamed}</div>
                          {a.epic && <div className="text-2xs text-soft">{a.epic}</div>}
                        </>
                      ),
                    },
                    {
                      id: 'warning',
                      header: t.columns.warning,
                      render: (a: Activity) => <WarnList codes={activityWarnings.get(a.id) ?? []} />,
                    },
                  ]}
                  rows={warnedActivities}
                  getRowKey={(a) => a.id}
                  testId="health-warnings-activities"
                  rowTestIdPrefix="health-warnings-activity"
                />
              </section>
            )}

            {/* Release warnings */}
            {warnedReleases.length > 0 && (
              <section>
                <p className="text-2xs font-mono uppercase tracking-widest text-soft mb-2">
                  {t.releasesSection([...releaseWarnings.values()].reduce((n, ws) => n + ws.length, 0))}
                </p>
                <DataTable
                  caption={t.releaseCaption}
                  columns={[
                    {
                      id: 'release',
                      header: t.columns.release,
                      rowHeader: true,
                      render: (r: Release) => <span className="font-medium text-text">{r.name || t.unnamed}</span>,
                    },
                    {
                      id: 'warning',
                      header: t.columns.warning,
                      render: (r: Release) => <WarnList codes={releaseWarnings.get(r.id) ?? []} />,
                    },
                  ]}
                  rows={warnedReleases}
                  getRowKey={(r) => r.id}
                  testId="health-warnings-releases"
                  rowTestIdPrefix="health-warnings-release"
                />
              </section>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
