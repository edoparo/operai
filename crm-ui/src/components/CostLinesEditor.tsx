import type { ReactNode } from 'react'
import { Button, Field, Icon, MoneyInput } from '@operai/ui'
import {
  LIMITS,
  blankOfferLine,
  blankTemplateLine,
  modesFor,
} from '../lib/offerRules'
import type { AmountMode, LineIssue, LinesCheck, OfferLineDraft, TemplateLineDraft } from '../lib/offerRules'
import { COST_KINDS } from '../lib/offerRules'
import type { CostKind } from '../lib/types'
import { strings } from '../strings'

const issueText = (issue: LineIssue | null): string | undefined => {
  const t = strings.templates.costLines.errors
  switch (issue) {
    case 'descriptionRequired':
      return t.descriptionRequired
    case 'descriptionTooLong':
      return t.descriptionTooLong(LIMITS.description)
    case 'amountInvalid':
      return t.amountInvalid
    case 'quantityInvalid':
      return t.quantityInvalid
    case 'quantityOne':
      return t.quantityOne
    default:
      return undefined
  }
}

const listText = (list: LinesCheck['list']): string | null => {
  const t = strings.templates.costLines.errors
  return list === 'count' ? t.count(LIMITS.costLines.min, LIMITS.costLines.max) : list === 'oneOff' ? t.oneOff : null
}

/** The shape the two editors share: a row frame with its heading and remove button. */
function Row({
  n,
  testId,
  onRemove,
  removable,
  children,
}: {
  n: number
  testId: string
  onRemove: () => void
  removable: boolean
  children: ReactNode
}) {
  const t = strings.templates.costLines
  return (
    <div className="flex flex-col gap-2 rounded-md border border-rule p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-soft">{t.item(n)}</span>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label={t.remove(n)}
          disabled={!removable}
          onClick={onRemove}
          data-testid={`${testId}-remove`}
        >
          <Icon name="trash" />
        </Button>
      </div>
      {children}
    </div>
  )
}

function KindSelect({ n, value, onChange }: { n: number; value: CostKind; onChange: (kind: CostKind) => void }) {
  const t = strings.templates.costLines
  return (
    <Field label={`${t.kind} (${n})`}>
      {(control) => (
        <select {...control} value={value} onChange={(event) => onChange(event.target.value as CostKind)}>
          {COST_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t.kinds[kind]}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/**
 * TemplateCostLinesEditor — the default cost lines of an offer template. The
 * amount is the deal amount, a split per estimate release (one-off only), a
 * fixed amount, or a percentage (discounts only); the quantity is a number or
 * the estimate's man-days (D-13, D-14).
 */
export function TemplateCostLinesEditor({
  lines,
  onChange,
  check,
  unitColumns,
  disabled = false,
  currency,
}: {
  lines: TemplateLineDraft[]
  onChange: (lines: TemplateLineDraft[]) => void
  check?: LinesCheck
  unitColumns: boolean
  disabled?: boolean
  currency?: string
}) {
  const t = strings.templates.costLines
  const update = (index: number, patch: Partial<TemplateLineDraft>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)))
  const setKind = (index: number, kind: CostKind) => {
    const line = lines[index]!
    const allowed = modesFor(kind)
    const mode: AmountMode = allowed.includes(line.mode) ? line.mode : (allowed[allowed.length - 1] as AmountMode)
    update(index, { kind, mode })
  }
  const error = check ? listText(check.list) : null
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled} data-testid="crm-template-costlines">
      <legend className="field-label">{t.legend}</legend>
      {error && (
        <p className="form-error" role="alert" data-testid="crm-template-costlines-error">
          {error}
        </p>
      )}
      {lines.map((line, index) => {
        const n = index + 1
        const issue = check?.items[index] ?? null
        const text = issueText(issue)
        const percent = line.mode === 'percent'
        return (
          <Row
            key={index}
            n={n}
            testId={`crm-template-costline-${index}`}
            removable={lines.length > LIMITS.costLines.min}
            onRemove={() => onChange(lines.filter((_, at) => at !== index))}
          >
            <Field
              label={`${t.description} (${n})`}
              required
              error={issue === 'descriptionRequired' || issue === 'descriptionTooLong' ? text : undefined}
            >
              {(control) => (
                <input {...control} value={line.description} onChange={(event) => update(index, { description: event.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KindSelect n={n} value={line.kind} onChange={(kind) => setKind(index, kind)} />
              <Field label={`${t.amountMode} (${n})`}>
                {(control) => (
                  <select
                    {...control}
                    value={line.mode}
                    onChange={(event) => update(index, { mode: event.target.value as AmountMode })}
                  >
                    {modesFor(line.kind).map((mode) => (
                      <option key={mode} value={mode}>
                        {t.modes[mode]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {(line.mode === 'fixed' || percent) && (
                <Field
                  label={`${percent ? t.percent : currency ? `${t.amount} (${currency})` : t.amount} (${n})`}
                  hint={percent ? t.percentHint : undefined}
                  error={issue === 'amountInvalid' ? text : undefined}
                >
                  {(control) => (
                    <MoneyInput {...control} value={line.amount} onChange={(event) => update(index, { amount: event.target.value })} />
                  )}
                </Field>
              )}
              {!percent && unitColumns && (
                <Field label={`${t.quantityMode} (${n})`}>
                  {(control) => (
                    <select
                      {...control}
                      value={line.quantityMode}
                      onChange={(event) => update(index, { quantityMode: event.target.value as 'number' | 'manDays' })}
                    >
                      <option value="number">{t.quantityModes.number}</option>
                      <option value="manDays">{t.quantityModes.manDays}</option>
                    </select>
                  )}
                </Field>
              )}
              {!percent && unitColumns && line.quantityMode === 'number' && (
                <Field
                  label={`${t.quantity} (${n})`}
                  error={issue === 'quantityInvalid' || issue === 'quantityOne' ? text : undefined}
                >
                  {(control) => (
                    <input
                      {...control}
                      inputMode="numeric"
                      className="font-mono"
                      value={line.quantity}
                      onChange={(event) => update(index, { quantity: event.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          </Row>
        )
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={lines.length >= LIMITS.costLines.max}
          onClick={() => onChange([...lines, blankTemplateLine()])}
          data-testid="crm-template-costline-add"
        >
          {t.add}
        </Button>
      </div>
    </fieldset>
  )
}

/**
 * OfferCostLinesEditor — the cost lines of the offer being prepared, with the
 * amounts as decimal major units of the deal currency (converted to cents when
 * posted). Quantity is editable only when the unit columns are on.
 */
export function OfferCostLinesEditor({
  lines,
  onChange,
  check,
  unitColumns,
  currency,
  disabled = false,
}: {
  lines: OfferLineDraft[]
  onChange: (lines: OfferLineDraft[]) => void
  check?: LinesCheck
  unitColumns: boolean
  currency: string
  disabled?: boolean
}) {
  const t = strings.templates.costLines
  const update = (index: number, patch: Partial<OfferLineDraft>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...patch } : line)))
  const setKind = (index: number, kind: CostKind) => {
    // A percentage is for discounts only.
    update(index, kind === 'discount' ? { kind } : { kind, mode: 'fixed' })
  }
  const error = check ? listText(check.list) : null
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled} data-testid="crm-offer-costlines">
      <legend className="field-label">{t.legend}</legend>
      {error && (
        <p className="form-error" role="alert" data-testid="crm-offer-costlines-error">
          {error}
        </p>
      )}
      {lines.map((line, index) => {
        const n = index + 1
        const issue = check?.items[index] ?? null
        const text = issueText(issue)
        const percent = line.mode === 'percent'
        return (
          <Row
            key={index}
            n={n}
            testId={`crm-offer-costline-${index}`}
            removable={lines.length > LIMITS.costLines.min}
            onRemove={() => onChange(lines.filter((_, at) => at !== index))}
          >
            <Field
              label={`${t.description} (${n})`}
              required
              error={issue === 'descriptionRequired' || issue === 'descriptionTooLong' ? text : undefined}
            >
              {(control) => (
                <input {...control} value={line.description} onChange={(event) => update(index, { description: event.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KindSelect n={n} value={line.kind} onChange={(kind) => setKind(index, kind)} />
              {line.kind === 'discount' && (
                <Field label={`${t.amountMode} (${n})`}>
                  {(control) => (
                    <select
                      {...control}
                      value={line.mode}
                      onChange={(event) => update(index, { mode: event.target.value as 'fixed' | 'percent' })}
                    >
                      <option value="fixed">{t.modes.fixed}</option>
                      <option value="percent">{t.modes.percent}</option>
                    </select>
                  )}
                </Field>
              )}
              <Field
                label={`${percent ? t.percent : `${t.amount} (${currency})`} (${n})`}
                hint={percent ? t.percentHint : undefined}
                error={issue === 'amountInvalid' ? text : undefined}
              >
                {(control) => (
                  <MoneyInput {...control} value={line.amount} onChange={(event) => update(index, { amount: event.target.value })} />
                )}
              </Field>
              {unitColumns && !percent && (
                <Field
                  label={`${t.quantity} (${n})`}
                  error={issue === 'quantityInvalid' || issue === 'quantityOne' ? text : undefined}
                >
                  {(control) => (
                    <input
                      {...control}
                      inputMode="numeric"
                      className="font-mono"
                      value={line.quantity}
                      onChange={(event) => update(index, { quantity: event.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          </Row>
        )
      })}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={lines.length >= LIMITS.costLines.max}
          onClick={() => onChange([...lines, blankOfferLine()])}
          data-testid="crm-offer-costline-add"
        >
          {t.add}
        </Button>
      </div>
    </fieldset>
  )
}

/** The two table-column switches and the total-row switch, shared by the template page and the dialog. */
export function CostColumnSwitches({
  columns,
  showTotal,
  onColumns,
  onShowTotal,
  disabled = false,
  testIdPrefix,
}: {
  columns: { position: boolean; unit: boolean }
  showTotal: boolean
  onColumns: (columns: { position: boolean; unit: boolean }) => void
  onShowTotal: (value: boolean) => void
  disabled?: boolean
  testIdPrefix: string
}) {
  const t = strings.templates.costLines
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="field-label">{t.columnsLegend}</legend>
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={columns.position}
          onChange={(event) => onColumns({ ...columns, position: event.target.checked })}
          data-testid={`${testIdPrefix}-position`}
        />
        {t.position}
      </label>
      <label className="flex items-start gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={columns.unit}
          onChange={(event) => onColumns({ ...columns, unit: event.target.checked })}
          data-testid={`${testIdPrefix}-unit`}
        />
        <span>
          {t.unit}
          <span className="block text-xs text-soft">{t.unitHint}</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={showTotal}
          onChange={(event) => onShowTotal(event.target.checked)}
          data-testid={`${testIdPrefix}-total`}
        />
        {t.showTotal}
      </label>
    </fieldset>
  )
}
