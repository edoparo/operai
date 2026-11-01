import type { Meta, StoryObj } from '@storybook/react-vite'
import { STATUS, StatusBadge } from '../components/StatusBadge'
import type { StatusMeaning } from '../components/StatusBadge'

/**
 * The status dictionary: every status of every tool maps to ONE of these
 * meanings, in one place per app, and gets its tone and icon. An icon
 * therefore means the same thing everywhere. The app keeps its own label
 * ("On order", "Archived"); the meaning picks the look.
 */
const meta: Meta = {
  title: 'Foundations/Status dictionary',
  parameters: { controls: { disable: true } },
}
export default meta

const MEANINGS: Record<StatusMeaning, { label: string; meaning: string; examples: string }> = {
  draft: { label: 'Draft', meaning: 'Not submitted or not started yet', examples: 'a draft' },
  pending: {
    label: 'Pending',
    meaning: 'Waiting for someone else',
    examples: 'submitted, invited, ordered, queued',
  },
  active: { label: 'Active', meaning: 'Accepted and in effect', examples: 'approved, accepted, assigned, in effect' },
  settled: { label: 'Settled', meaning: 'Finished for good', examples: 'paid, confirmed, closed' },
  stored: { label: 'Stored', meaning: 'Kept, not in use', examples: 'in stock' },
  attention: {
    label: 'Needs attention',
    meaning: 'Needs someone’s attention, but nothing failed',
    examples: 'in repair, waiting too long',
  },
  failed: { label: 'Failed', meaning: 'Ended badly', examples: 'rejected, declined, failed' },
  missing: { label: 'Missing', meaning: 'Cannot be found', examples: 'lost, stolen' },
  voided: {
    label: 'Voided',
    meaning: 'No longer counts',
    examples: 'discarded, cancelled, revoked, expired',
  },
  info: { label: 'Info', meaning: 'A neutral fact worth a badge', examples: 'a built-in record' },
}

export const Dictionary: StoryObj = {
  render: () => (
    <div className="flex max-w-4xl flex-col gap-3">
      <div role="region" aria-label="Status dictionary" tabIndex={0} className="table-region">
        <table className="data-table">
          <caption className="visually-hidden">Status meanings, their tone and icon</caption>
          <thead>
            <tr>
              <th scope="col">Meaning</th>
              <th scope="col">Badge</th>
              <th scope="col">Means</th>
              <th scope="col">For example</th>
              <th scope="col">Tone · icon</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(STATUS) as StatusMeaning[]).map((meaning) => (
              <tr key={meaning}>
                <th scope="row" className="font-mono">
                  {meaning}
                </th>
                <td>
                  <StatusBadge status={meaning}>{MEANINGS[meaning].label}</StatusBadge>
                </td>
                <td>{MEANINGS[meaning].meaning}</td>
                <td className="text-soft">{MEANINGS[meaning].examples}</td>
                <td className="font-mono text-xs text-soft">
                  {STATUS[meaning].tone} · {STATUS[meaning].icon}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-soft">
        Map each domain value once: <code className="font-mono">{`{ archived: 'voided', 'on-order': 'pending' }`}</code>
        , then render <code className="font-mono">{'<StatusBadge status={meaning}>{label}</StatusBadge>'}</code>.
      </p>
    </div>
  ),
}
