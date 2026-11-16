import { useMemo, useState, type ReactNode } from 'react'
import { Card, VisuallyHidden } from '@operai/ui'
import { chooseOption, setBlock, setField, type WizardAnswers } from '../../lib/offerEngine/answers'
import type { OutlineItem } from '../../lib/offerEngine/outline'
import type { InvalidCode } from '../../lib/offerEngine/resolve'
import type { StepKey } from '../../lib/offerEngine/syntax'
import { strings } from '../../strings'
import BlockChoice from './BlockChoice'
import BlockSwitch from './BlockSwitch'
import { controlId } from './controlId'
import { derivedValues } from './derivedValue'
import FieldInput from './FieldInput'
import { plainText } from './handEdits'
import ListFieldEditor from './ListFieldEditor'
import RepeatableTableEditor from './RepeatableTableEditor'
import type { StepPanelProps } from './StepPanel'
import TemplateText from './TemplateText'
import ValidityDaysInput from './ValidityDaysInput'

const t = strings.offerWizard

export interface StepFormProps extends StepPanelProps {
  /** The items of the step as `outline(ast, answers)` returns them, in text order. */
  items: readonly OutlineItem[]
  /** Inside a card of its own (a cost line): the grid without the `Card` around it (cards are never nested). */
  bare?: boolean
}

/** At most this many hand-edited section headings are named on a field; the rest is "and n more". */
const HEADINGS_NAMED = 2

const fillsList = (assigns: readonly { label: string; value: string }[]): string =>
  assigns.map((assign) => `${assign.label} = ${assign.value}`).join(', ')

/**
 * The generic form of a step (design S4; AC-1.2 to AC-1.5, AC-1.8, AC-1.9, AC-4.5, AC-5.2): the step's items placed
 * and nested exactly as the outline returns them (DD-43), each a control by kind. Every change is made by the
 * engine's `setField`, `setBlock` or `chooseOption`, so what an option fills (decisions.md O3) is decided in one
 * place; this form only reads what changed, to announce it.
 */
export default function StepForm({
  items,
  bare = false,
  ast,
  answers,
  onAnswersChange,
  context,
  resolved,
  step,
  validityEntry,
  onValidityEntry,
}: StepFormProps) {
  const [announcement, setAnnouncement] = useState('')
  const derived = useMemo(() => derivedValues(ast, answers), [ast, answers])
  const headings = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const section of [...resolved.sections, ...resolved.annexes.flatMap((annex) => annex.sections)]) {
      byKey.set(section.key, section.heading)
    }
    return byKey
  }, [resolved])
  const invalid = useMemo(() => new Map(resolved.invalid.map((issue) => [issue.name, issue.code])), [resolved])
  const missing = useMemo(() => new Set(resolved.missing.map((issue) => issue.name)), [resolved])

  /** Hands the engine's next answers up and announces the fields it filled. */
  const apply = (next: WizardAnswers, filled: readonly { name: string; label: string }[]) => {
    const changed = filled.filter((target) => next.fields[target.name] !== answers.fields[target.name])
    if (changed.length > 0) {
      setAnnouncement(t.field.filledLive(changed.length, changed.map((target) => target.label).join(', ')))
    }
    onAnswersChange(next)
  }

  const handEditedNote = (sections: readonly string[]): string | undefined => {
    if (sections.length === 0) return undefined
    const named = sections.slice(0, HEADINGS_NAMED).map((key) => headings.get(key) ?? key)
    const more = sections.length - named.length
    return t.field.handEdited(more > 0 ? `${named.join('”, “')} ${t.field.more(more)}` : named.join('”, “'))
  }

  const wide = (item: OutlineItem): boolean =>
    item.type === 'block' ||
    item.type === 'list' ||
    item.type === 'table' ||
    (item.type === 'field' && item.kind === 'longtext')

  const render = (item: OutlineItem): ReactNode => {
    switch (item.type) {
      case 'field': {
        // the validity is not a field answer (`answers.fields` never holds it): it is `answers.validityDays`
        if (item.system === 'validityDays' && !item.derived) {
          return (
            <ValidityDaysInput
              answers={answers}
              onAnswersChange={onAnswersChange}
              label={<TemplateText language={context.language}>{item.label}</TemplateText>}
              fieldName={item.name}
              issueLabel={plainText(item.label)}
              step={step as StepKey}
              entry={validityEntry}
              onEntryChange={onValidityEntry}
              id={controlId(item.name)}
            />
          )
        }
        const code = invalid.get(item.name)
        const chosen = item.fills.find((group) => group.option === String(answers.fields[item.name]))
        return (
          <FieldInput
            item={item}
            value={answers.fields[item.name]}
            language={context.language}
            currency={context.currency}
            derivedText={item.derived ? (derived(item.name) ?? '') : undefined}
            error={code ? t.invalid[code as InvalidCode] : null}
            missing={missing.has(item.name)}
            handEditedNote={handEditedNote(item.handEditedIn)}
            fillsNote={chosen && chosen.assigns.length > 0 ? t.field.fills(fillsList(chosen.assigns)) : undefined}
            onChange={(value) =>
              apply(
                setField(ast, answers, item.name, value),
                item.fills.find((group) => group.option === String(value))?.assigns ?? [],
              )
            }
          />
        )
      }
      case 'block':
        return (
          <BlockSwitch
            name={item.name}
            label={item.label}
            explain={item.explain}
            language={context.language}
            on={answers.blocks[item.name] === true}
            fillsNote={item.fills.length > 0 ? t.field.fills(fillsList(item.fills)) : undefined}
            onChange={(on) => apply(setBlock(ast, answers, item.name, on), on ? item.fills : [])}
          >
            {item.children.length > 0 ? (
              <div className="flex flex-col gap-4">{item.children.map(renderCell)}</div>
            ) : null}
          </BlockSwitch>
        )
      case 'choice':
        return (
          <BlockChoice
            name={item.name}
            label={item.label}
            language={context.language}
            selected={item.options.find((option) => answers.blocks[option.block] === true)?.block ?? item.default}
            options={item.options.map((option) => ({
              block: option.block,
              label: option.label,
              explain: ast.blocks.find((block) => block.name === option.block)?.explain ?? null,
              fillsNote: option.fills.length > 0 ? t.field.fills(fillsList(option.fills)) : undefined,
            }))}
            onChoose={(block) =>
              apply(
                chooseOption(ast, answers, item.name, block),
                item.options.find((option) => option.block === block)?.fills ?? [],
              )
            }
          />
        )
      case 'list':
        return (
          <ListFieldEditor
            item={item}
            items={answers.lists[item.name] ?? []}
            language={context.language}
            missing={missing.has(item.name)}
            handEditedNote={handEditedNote(item.handEditedIn)}
            onChange={(next) => onAnswersChange({ ...answers, lists: { ...answers.lists, [item.name]: next } })}
          />
        )
      case 'table':
        return (
          <RepeatableTableEditor
            item={item}
            rows={answers.tables[item.name] ?? []}
            ast={ast}
            language={context.language}
            currency={context.currency}
            errorOf={(name) => {
              const code = invalid.get(name)
              return code ? t.invalid[code as InvalidCode] : null
            }}
            isMissing={(name) => missing.has(name)}
            handEditedNote={handEditedNote(item.handEditedIn)}
            onChange={(next) => onAnswersChange({ ...answers, tables: { ...answers.tables, [item.name]: next } })}
          />
        )
      default:
        // the cost table belongs to the Costs step (T44)
        return null
    }
  }

  const renderCell = (item: OutlineItem): ReactNode => {
    const content = render(item)
    if (content === null) return null
    return (
      <div
        key={`${item.type}:${item.type === 'costTable' ? 'costs' : item.name}`}
        className={wide(item) ? 'sm:col-span-2' : undefined}
      >
        {content}
      </div>
    )
  }

  const content = (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{items.map(renderCell)}</div>
      <VisuallyHidden live>{announcement}</VisuallyHidden>
    </>
  )
  return bare ? <div>{content}</div> : <Card>{content}</Card>
}
