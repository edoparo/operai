import { useId } from 'react'
import { Badge, Banner, Card, Icon, StatePanel } from '@operai/ui'
import type { OfferLanguage } from '../../lib/offerEngine/answers'
import type { Outline, OutlineItem, suppliedFields } from '../../lib/offerEngine/outline'
import { strings } from '../../strings'
import TemplateText from '../offerWizard/TemplateText'

const w = strings.templates.wizardEditor

type Fill = { label: string }

const labelsOf = (fills: readonly Fill[]): string => fills.map((fill) => fill.label).join(', ')

/** One line of an item: what it is, what it is called, and the marks the author needs (optional, calculated). */
function Heading({
  kind,
  label,
  optional = false,
  derived = false,
  language,
}: {
  kind: string
  label?: string
  optional?: boolean
  derived?: boolean
  language: OfferLanguage
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-2xs text-soft">{kind}</span>
      {label !== undefined ? (
        <span className="text-text">
          <TemplateText language={language}>{label}</TemplateText>
        </span>
      ) : null}
      {optional ? <Badge tone="muted">{w.optional}</Badge> : null}
      {derived ? <Badge glyph={<Icon name="lock" />}>{w.kind.derived}</Badge> : null}
    </div>
  )
}

function Note({ children }: { children: string }) {
  return <p className="m-0 text-xs text-soft">{children}</p>
}

function Item({ item, language }: { item: OutlineItem; language: OfferLanguage }) {
  switch (item.type) {
    case 'field':
      return (
        <li className="flex flex-col gap-1">
          <Heading
            kind={w.kind[item.kind]}
            label={item.label}
            optional={item.optional}
            derived={item.derived}
            language={language}
          />
          {item.fills.map((group) =>
            group.assigns.length > 0 ? (
              <Note key={group.option}>{w.fillsFor(group.option, labelsOf(group.assigns))}</Note>
            ) : null,
          )}
        </li>
      )
    case 'list':
      return (
        <li>
          <Heading kind={w.kind.list} label={item.label} optional={item.optional} language={language} />
        </li>
      )
    case 'table':
      return (
        <li>
          <Heading
            kind={w.kind.table(item.columns.length)}
            label={item.label}
            optional={item.optional}
            language={language}
          />
        </li>
      )
    case 'block':
      return (
        <li className="flex flex-col gap-1">
          <Heading kind={w.kind.block} label={item.label} language={language} />
          {item.explain ? <Note>{item.explain}</Note> : null}
          {item.fills.length > 0 ? <Note>{w.fills(labelsOf(item.fills))}</Note> : null}
          {item.children.length > 0 ? (
            <ul className="m-0 ml-4 flex list-none flex-col gap-2 border-l border-rule p-0 pl-3">
              {item.children.map((child) => (
                <Item
                  key={`${child.type}:${'name' in child ? child.name : 'costs'}`}
                  item={child}
                  language={language}
                />
              ))}
            </ul>
          ) : null}
        </li>
      )
    case 'choice':
      return (
        <li className="flex flex-col gap-1">
          <Heading kind={w.kind.choice(item.options.length)} label={item.label} language={language} />
          <ul className="m-0 ml-4 flex list-none flex-col gap-1 border-l border-rule p-0 pl-3">
            {item.options.map((option) => (
              <li key={option.block} className="flex flex-col gap-1">
                <span className="text-sm text-text">
                  <TemplateText language={language}>{option.label}</TemplateText>
                </span>
                {option.fills.length > 0 ? <Note>{w.fills(labelsOf(option.fills))}</Note> : null}
              </li>
            ))}
          </ul>
        </li>
      )
    case 'costTable':
      return (
        <li className="flex flex-col gap-1">
          <Heading kind={w.kind.costs(item.lines.length)} language={language} />
          <ul className="m-0 ml-4 flex list-none flex-col gap-1 border-l border-rule p-0 pl-3 text-xs text-soft">
            {item.lines.map((line) => (
              <li key={line.key}>
                <span className="font-mono">{line.key}</span> · {w.costKind[line.kind]}
              </li>
            ))}
            {item.totals.map((label, index) => (
              <li key={`total-${index}`}>{w.costTotal(label)}</li>
            ))}
          </ul>
        </li>
      )
  }
}

export interface OutlineViewProps {
  outline: Outline
  /** The text has errors: what is shown is the last version that read cleanly. */
  stale: boolean
  /** The template's language, for the labels the author wrote. */
  language: OfferLanguage
  /** The issuer fields the text uses (`suppliedFields(ast)` of the same reading as `outline`); none → no group. */
  supplied?: ReturnType<typeof suppliedFields>
}

/**
 * The fields the CRM fills from the entity profile (AC-12.1, AC-12.9, design D-27): one row per declared issuer field the
 * text uses, in order of first use. They are never asked, so a row is a kind, the author's label and a lock — no input,
 * no "optional". A field without a label is named by its identifier.
 */
function SuppliedGroup({
  fields,
  language,
}: {
  fields: NonNullable<OutlineViewProps['supplied']>
  language: OfferLanguage
}) {
  const headingId = useId()
  if (fields.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid="crm-template-outline-supplied">
      <h4 id={headingId} className="font-disp text-sm text-text">
        {w.supplied.title}
      </h4>
      <p className="m-0 text-xs text-soft">{w.supplied.hint}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {fields.map((field) => (
          <li key={field.name} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-2xs text-soft">
              {field.source === 'issuer' ? w.supplied.issuer : w.supplied.issuerAddress}
            </span>
            <span className="text-text">
              {field.label !== null ? (
                <TemplateText language={language}>{field.label}</TemplateText>
              ) : (
                <span className="font-mono">{field.name}</span>
              )}
            </span>
            <Badge glyph={<Icon name="lock" />}>{w.supplied.badge}</Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * What the wizard will ask (design S13; AC-8.2): per step that has something to ask its sections, then every item
 * the text declares and uses, in text order, nested under the block that holds it. It is `outline(ast, null)`, so
 * an item inside a block that is off by default is listed too — the author sees the whole template.
 */
export default function OutlineView({ outline, stale, language, supplied = [] }: OutlineViewProps) {
  return (
    <Card title={w.outline} data-testid="crm-template-outline">
      <div className="flex flex-col gap-3">
        {stale ? (
          <Banner tone="info" compact live="polite">
            {w.outlineStale}
          </Banner>
        ) : null}
        {outline.steps.length === 0 ? (
          <StatePanel headingLevel={4} title={w.outlineEmpty.title}>
            {w.outlineEmpty.body}
          </StatePanel>
        ) : (
          outline.steps.map((step) => (
            <section key={step.key} className="flex flex-col gap-2">
              <h4 className="font-disp text-sm text-text">{strings.offerWizard.steps[step.key]}</h4>
              {step.sections.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="text-2xs text-soft">{w.outlineSections}</span>
                  <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                    {step.sections.map((section) => (
                      <li key={section.key}>
                        <Badge>
                          <TemplateText language={language}>
                            {section.annex ? w.outlineAnnex(section.annex, section.heading) : section.heading}
                          </TemplateText>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {step.items.map((item) => (
                  <Item key={`${item.type}:${'name' in item ? item.name : 'costs'}`} item={item} language={language} />
                ))}
              </ul>
            </section>
          ))
        )}
        <SuppliedGroup fields={supplied} language={language} />
      </div>
    </Card>
  )
}
