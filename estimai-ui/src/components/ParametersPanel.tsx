import type { ChangeEvent } from 'react'
import type { Parameters } from '../types'
import { Card, Field } from '@operai/ui'
import { strings } from '../strings'

interface ParametersPanelProps {
  params: Parameters
  onUpdate: (key: keyof Parameters, value: string) => void
  /**
   * T17 (specs/20260807-estimate-sharing/tasks.md; design.md S5): fed from
   * context's single `canEdit` gate (`!canEdit`). Defaults to `false` so
   * every pre-existing call site keeps its exact prior full-edit behaviour.
   * Every number input becomes `readOnly` (not `disabled`) — stays
   * focusable/AT-readable, browser blocks typing.
   */
  readOnly?: boolean
}

const PARAMETER_FIELDS: ReadonlyArray<{
  k: keyof Parameters & keyof typeof strings.parameters.fields
  step: number
  max?: number
}> = [
  { k: 'parallelism', step: 0.05, max: 1 },
  { k: 'sprintDays', step: 1 },
  { k: 'workingDaysMonth', step: 1 },
  { k: 'qaDeployDays', step: 0.5 },
  { k: 'qaTestDays', step: 0.5 },
  { k: 'pmDays', step: 0.5 },
  { k: 'aiCostCoef', step: 1 },
  { k: 'aiGain', step: 0.05, max: 1 },
]

export default function ParametersPanel({ params, onUpdate, readOnly = false }: ParametersPanelProps) {
  const t = strings.parameters

  // INC-16: each parameter is a labelled control in a Field (label above,
  // hint under, wired id/htmlFor + aria-describedby). INC-17: these are
  // durations, factors and fractions — not money — so they stay
  // type="number". The AI cost coefficient is a currency-neutral model rate,
  // not an amount: a number input too. INC-33: one Card (title h2 — the
  // view's heading under the editor's h1), not a bordered box per field.
  return (
    <Card title={t.heading} headingLevel={2} className="max-w-2xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 items-start">
        {PARAMETER_FIELDS.map(({ k, step, max }) => (
          <Field key={k} label={t.fields[k].label} hint={t.fields[k].hint}>
            {(control) => (
              <input
                {...control}
                type="number"
                value={params[k]}
                readOnly={readOnly}
                min={0}
                max={max}
                step={step}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onUpdate(k, e.target.value)}
                className="font-mono"
              />
            )}
          </Field>
        ))}
      </div>
    </Card>
  )
}
