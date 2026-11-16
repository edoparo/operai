/**
 * @vitest-environment jsdom
 *
 * The document preview (specs/20261115-crm-offer-wizard T46; AC-3.1, AC-3.2, AC-3.3, AC-5.2; DD-21, DD-29, DD-46,
 * DD-47): the paper draws what `ResolvedOffer` says — section numbers, annex letters, span totals and "–" included —
 * a missing value is a marked run with its label (headings, annex titles and cost descriptions too), a value `**x**`
 * stays literal on a plain surface, the pane catches up 250 ms after the last change, and below 1 280 px the same
 * document opens in a drawer.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import DocumentPreview, { type EffortAnnexPreview } from './DocumentPreview'
import OfferWizard from './OfferWizard'
import {
  initialAnswers,
  sampleAnswers,
  sampleContext,
  setField,
  type WizardAnswers,
  type WizardContext,
} from '../../lib/offerEngine/answers'
import { formatAmount, formatNumber, formatPercent, shortDate } from '../../lib/offerEngine/format'
import { parseMarkup, type Block, type CellLine, type Run } from '../../lib/offerEngine/markup'
import { numberOffer } from '../../lib/offerEngine/numbering'
import { resolveOffer, type ResolvedOffer } from '../../lib/offerEngine/resolve'
import { parseTemplate } from '../../lib/offerEngine/syntax'
import { words } from '../../lib/offerEngine/words'
import { strings } from '../../strings'

const t = strings.offerWizard

const SOURCE = `@@salutation Spettabile
@@acceptance Il Cliente

Con la presente offriamo a [CLIENTE_NOME] la fornitura **[OGGETTO]** (rif. [RIF]).

## OGGETTO DELLA FORNITURA
@@step scope
Descrizione del servizio.

### Modalità

- primo punto
- secondo punto

### Tempi

| Fase | Durata |
|---|---|
| Analisi | 2 settimane |

## COSTI [OGGETTO]
@@step costs
@@costs position unit
@@line sviluppo one_off | Sviluppo di **[OGGETTO]** | unit=deal | qty=1
@@line canone yearly | Canone annuo | unit=1200 | qty=2
@@line sconto discount | Sconto | unit=?
@@total **TOTALE primo anno**
@@total **TOTALE successivo**
@@line scelta option | Voce a scelta | unit=500 | qty=1
@@end

@@annex SLA Livello di servizio
@@subtitle Supporto per [OGGETTO]

Testo introduttivo.

## Parametri
@@step annexes
Livello: [LIVELLO].

@@field CLIENTE_NOME
label: Client
source: client

@@field RIF
label: Reference
source: reference

@@field OGGETTO
label: Oggetto

@@field LIVELLO
label: Livello
`

const ast = parseTemplate(SOURCE).ast
const itContext: WizardContext = {
  ...sampleContext('it'),
  attachments: [{ id: 'a1', fileName: 'condizioni.pdf', sizeBytes: 1000 }],
}
const effort: EffortAnnexPreview = {
  releases: [
    { name: 'Release 1', manDaysTenths: 125, epics: [{ epic: 'Epic uno', manDaysTenths: 125 }] },
    { name: 'Release 2', manDaysTenths: 80, epics: [] },
  ],
  manDaysTenths: 205,
}

const complete = (): WizardAnswers => ({
  ...sampleAnswers(ast, 'it'),
  effortAnnex: true,
  aiAssisted: true,
  attachmentIds: ['a1'],
})

// ─── what the document should say, written without React (the test's own documentText) ───

const PENDING = t.preview.pending
const runsText = (runs: readonly Run[]): string =>
  runs.map((run) => (run.mark === 'missing' ? `⟦${run.text}⟧` : run.mark === 'pending' ? PENDING : run.text)).join('')
const cellText = (lines: readonly CellLine[]): string =>
  lines.map((line) => (line.bullet ? '• ' : '') + runsText(line.runs)).join(' ')

function blocksText(blocks: readonly Block[], labels: readonly string[] | null, taken: { n: number }): string[] {
  const out: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') out.push(runsText(block.runs))
    else if (block.type === 'heading') out.push(labels === null ? block.text : (labels[taken.n++] ?? block.text))
    else if (block.type === 'list') {
      for (const item of block.items) {
        out.push(`${item.marker} ${runsText(item.runs)}`)
        out.push(...blocksText(item.children, labels, taken))
      }
    } else {
      out.push(block.header.map(cellText).join(' '))
      for (const row of block.rows) out.push(row.map(cellText).join(' '))
    }
  }
  return out
}

function documentText(
  resolved: ResolvedOffer,
  context: WizardContext,
  names: string[],
  annex: EffortAnnexPreview | null,
): string {
  const w = words(resolved.language)
  const numbered = numberOffer({
    language: resolved.language,
    sections: resolved.sections,
    annexes: resolved.annexes.map((entry) => ({
      designation: entry.designation,
      title: entry.title,
      sections: entry.sections,
    })),
    effortAnnex: resolved.effortAnnex,
    attachmentNames: names,
  })
  const currency = context.currency
  const lines: string[] = [resolved.salutation, ...resolved.client.lines]
  if (resolved.client.contacts.length > 0) lines.push(`${w.attn} ${resolved.client.contacts.join(', ')}`)
  const date = shortDate(resolved.client.date ?? '')
  lines.push(resolved.client.place ? `${resolved.client.place}, ${date}` : date)
  const [before, after] = w.title('\u0001').split('\u0001')
  lines.push(`${before}${PENDING}${after}`)
  if (numbered.index) lines.push(w.index, ...numbered.index.map((entry) => entry.label))
  lines.push(...blocksText(parseMarkup(resolved.opening), null, { n: 0 }))

  const costTable = (): string[] => {
    const { columns, labels, showTotals, rows, result } = resolved.costs
    const out = [
      [
        columns.position ? w.position : '',
        w.item,
        columns.unit ? `${labels.unit ?? w.unit(currency)} ${labels.quantity ?? w.quantity}` : '',
        w.amount(currency),
      ].join(' '),
    ]
    rows.forEach((row, index) => {
      const res = result.rows[index]!
      if (row.type === 'total' && res.type === 'total') {
        if (showTotals)
          out.push(
            `${row.label} ${res.state === 'ok' && res.totalCents !== null ? formatAmount(res.totalCents, currency) : '–'}`,
          )
      } else if (row.type === 'line' && res.type === 'line') {
        const discount = row.kind === 'discount'
        const percent = discount && row.percentBp !== null
        out.push(
          [
            columns.position && res.position !== null ? String(res.position) : '',
            `${row.kind === 'option' ? '□ ' : ''}${row.description}${percent && !columns.unit ? ` (${formatPercent(row.percentBp!)})` : ''}`,
            columns.unit
              ? `${percent ? formatPercent(row.percentBp!) : row.unitCents === null ? '' : `${discount ? '- ' : ''}${formatAmount(row.unitCents, currency)}`} ${percent ? '' : String(row.quantity ?? 1)}`
              : '',
            res.totalCents === null ? '–' : `${discount ? '- ' : ''}${formatAmount(res.totalCents, currency)}`,
          ].join(' '),
        )
      }
    })
    return out
  }
  resolved.sections.forEach((section, index) => {
    const entry = numbered.sections[index]!
    lines.push(entry.heading)
    if (section.costs) lines.push(...costTable())
    lines.push(...blocksText(parseMarkup(section.body), entry.subheadings, { n: 0 }))
  })
  lines.push(w.acceptance)
  if (resolved.acceptanceLabel) lines.push(resolved.acceptanceLabel)
  lines.push(w.place, w.signature)
  if (numbered.annexList.length > 0) lines.push(w.annexes, ...numbered.annexList.map((line) => `• ${line}`))
  resolved.annexes.forEach((entry, index) => {
    const numberedAnnex = numbered.annexes[index]!
    lines.push(numberedAnnex.heading)
    if (entry.subtitle) lines.push(entry.subtitle.trim())
    lines.push(...blocksText(parseMarkup(entry.intro), null, { n: 0 }))
    entry.sections.forEach((section, at) => {
      const numberedSection = numberedAnnex.sections[at]!
      lines.push(
        numberedSection.heading,
        ...blocksText(parseMarkup(section.body), numberedSection.subheadings, { n: 0 }),
      )
    })
  })
  if (resolved.effortAnnex && numbered.effortAnnexLetter) {
    lines.push(w.annexHeading(numbered.effortAnnexLetter))
    if (resolved.aiAssisted) lines.push(w.aiNote)
    if (annex) {
      const days = (tenths: number) => formatNumber(`${Math.trunc(tenths / 10)}.${tenths % 10}`, resolved.language)
      lines.push(`${w.release} ${w.epic} ${w.manDays}`)
      for (const release of annex.releases) {
        lines.push(`${release.name} ${days(release.manDaysTenths)}`)
        for (const epic of release.epics) lines.push(`${epic.epic} ${days(epic.manDaysTenths)}`)
      }
      lines.push(`${w.annexTotal} ${days(annex.manDaysTenths)}`)
    }
  }
  return lines.join('\n')
}

/** What a reader sees of the document: the paper without the pane's own notes and the hidden "Missing:" prefixes. */
function paperText(): string {
  const paper = screen
    .getByRole('region', { name: t.preview.title })
    .querySelector('article')!
    .cloneNode(true) as HTMLElement
  paper.querySelectorAll('[data-chrome], .visually-hidden').forEach((node) => node.remove())
  return paper.textContent ?? ''
}
const squash = (text: string): string => text.replace(/\s+/g, '')

function matchMedia(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

beforeEach(() => matchMedia(false))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DocumentPreview — the document (AC-3.2, DD-21, DD-29)', () => {
  it('says exactly what documentText says: numbers, letters, span totals, dashes and document words', () => {
    const answers = complete()
    render(<DocumentPreview ast={ast} answers={answers} context={itContext} effortAnnex={effort} />)
    const resolved = resolveOffer(ast, answers, itContext)
    expect(resolved.missing).toEqual([])
    // the template's second span is empty: "–" is part of what is compared
    expect(resolved.costs.result.rows.some((row) => row.type === 'total' && row.state === 'empty')).toBe(true)
    expect(parseTemplate(SOURCE).problems.filter((problem) => problem.severity === 'error')).toEqual([])
    const expected = documentText(resolved, itContext, ['condizioni.pdf'], effort)
    expect(squash(paperText())).toBe(squash(expected))
    expect(expected).toContain('1. OGGETTO DELLA FORNITURA')
    expect(expected).toContain('1.1 MODALITÀ')
    expect(expected).toContain('ALLEGATO SLA – LIVELLO DI SERVIZIO')
    expect(expected).toContain('Allegato A - Dettaglio dell’impegno')
    expect(expected).toContain('Allegato B - condizioni.pdf')
  })

  it('prints "–" for a total whose span has no counted line', () => {
    const empty = parseTemplate(`@@salutation Dear

## COSTS
@@step costs
@@costs position unit
@@line a one_off | Work | unit=100 | qty=1
@@total **FIRST**
@@total **SECOND**
@@end
`).ast
    const context = { ...sampleContext('en'), estimate: null }
    render(<DocumentPreview ast={empty} answers={initialAnswers(empty, context)} context={context} />)
    const rows = screen.getAllByRole('row')
    const second = rows.find((row) => row.textContent?.includes('SECOND'))!
    expect(within(second).getByText('–')).not.toBeNull()
    expect(rows.find((row) => row.textContent?.includes('FIRST'))!.textContent).toContain('100')
    expect(squash(paperText())).toContain('SECOND–')
  })

  it('draws the effort-detail annex table and the deal’s PDFs as appended', () => {
    render(<DocumentPreview ast={ast} answers={complete()} context={itContext} effortAnnex={effort} />)
    expect(screen.getByText('Epic uno')).not.toBeNull()
    expect(screen.getByText('20,5')).not.toBeNull()
    expect(screen.getByText(t.preview.annexAppended('condizioni.pdf'), { exact: false })).not.toBeNull()
  })

  it('marks the paper with the template’s language and draws the reference as pending', () => {
    render(<DocumentPreview ast={ast} answers={complete()} context={itContext} />)
    const paper = screen.getByRole('region', { name: t.preview.title }).querySelector('article')!
    expect(paper.getAttribute('lang')).toBe('it')
    expect(within(paper).getAllByText(t.preview.pending).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('crm-wizard-page')[0]!.className).toContain('bg-paper')
  })

  it('captions a section edited by hand', () => {
    const answers = complete()
    const key = resolveOffer(ast, answers, itContext).sections[0]!.key
    const edited = {
      ...answers,
      handEdits: { [key]: { heading: 'Titolo mio', body: 'Testo mio.', sourceHeading: 'x' } },
    }
    render(<DocumentPreview ast={ast} answers={edited} context={itContext} />)
    expect(screen.getByText(t.preview.edited)).not.toBeNull()
    expect(screen.getByText('Testo mio.')).not.toBeNull()
  })

  it('draws no HTML from the document: no dangerouslySetInnerHTML in the wizard’s components', () => {
    const dir = __dirname
    const offenders = readdirSync(dir)
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
      .filter((name) => readFileSync(join(dir, name), 'utf8').includes('dangerouslySetInnerHTML'))
    expect(offenders).toEqual([])
  })
})

describe('DocumentPreview — missing values (AC-3.3, DD-46, DD-47)', () => {
  const blank = (): WizardAnswers => {
    const answers = complete()
    delete answers.fields.OGGETTO
    return answers
  }

  it('renders a missing field as a mark with its label and a hidden prefix, never colour alone', () => {
    render(<DocumentPreview ast={ast} answers={blank()} context={itContext} />)
    const marks = screen.getByRole('region', { name: t.preview.title }).querySelectorAll('mark')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) {
      expect(mark.textContent).toContain('⟦Oggetto⟧')
      expect(mark.querySelector('.visually-hidden')?.textContent).toContain(t.preview.missing)
      expect(mark.className).toContain('bg-paper-mark')
    }
  })

  it('composes a section heading from the number and the split text — no "?" for the marker', () => {
    render(<DocumentPreview ast={ast} answers={blank()} context={itContext} />)
    const heading = screen.getByRole('heading', { level: 4, name: /COSTI/ })
    expect(heading.textContent?.startsWith('2. COSTI ')).toBe(true)
    expect(heading.querySelector('mark')?.textContent).toContain('⟦Oggetto⟧')
    expect(heading.textContent).not.toContain('?')
    expect(squash(paperText())).not.toContain('?')
  })

  it('composes an annex title and a cost description the same way', () => {
    const titled = parseTemplate(`@@salutation Dear

## COSTS
@@step costs
@@costs position unit
@@line a one_off | Work for **[CLIENTE]** | unit=100 | qty=1
@@end

@@annex SLA Service for [CLIENTE]

Intro.

## Part
@@step annexes
Text.

@@field CLIENTE
label: Customer
`).ast
    const context = { ...sampleContext('en'), estimate: null }
    render(<DocumentPreview ast={titled} answers={initialAnswers(titled, context)} context={context} />)
    const annexHeading = screen.getByRole('heading', { level: 4, name: /SLA/ })
    expect(annexHeading.textContent?.startsWith('ANNEX SLA – SERVICE FOR ')).toBe(true)
    expect(annexHeading.querySelector('mark')?.textContent).toContain('⟦Customer⟧')
    const row = screen.getAllByRole('row').find((entry) => entry.textContent?.includes('Work for'))!
    expect(row.querySelector('mark')?.textContent).toContain('⟦Customer⟧')
    expect(squash(paperText())).not.toContain('?')
  })

  it('prints a value `**x**` in a heading or cost description as the literal characters', () => {
    const answers = { ...complete(), fields: { ...complete().fields, OGGETTO: '**x**' } }
    render(<DocumentPreview ast={ast} answers={answers} context={itContext} />)
    expect(screen.getByRole('heading', { level: 4, name: /COSTI/ }).textContent).toContain('**X**')
    expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('Sviluppo di **x**'))).toBe(true)
  })
})

describe('DocumentPreview — in the wizard (AC-3.1)', () => {
  function Wizard({ wide }: { wide: boolean }) {
    matchMedia(wide)
    const tree = useMemo(() => ast, [])
    const [answers, setAnswers] = useState(complete)
    return (
      <>
        <OfferWizard
          mode="sample"
          ast={tree}
          answers={answers}
          onAnswersChange={setAnswers}
          context={itContext}
          step="scope"
          onStepChange={() => undefined}
        />
        <button
          type="button"
          onClick={() => setAnswers((current) => setField(tree, current, 'OGGETTO', 'Nuovo oggetto'))}
        >
          change
        </button>
      </>
    )
  }

  it('shows the pane beside the form on a wide viewport and no drawer trigger', () => {
    render(<Wizard wide />)
    expect(screen.getByRole('region', { name: t.preview.title })).not.toBeNull()
    expect(screen.queryByRole('button', { name: t.bar.preview })).toBeNull()
  })

  it('shows the Drawer trigger instead on a narrow viewport and opens the same document in a drawer', () => {
    render(<Wizard wide={false} />)
    expect(screen.queryByRole('region', { name: t.preview.title })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t.bar.preview }))
    const drawer = screen.getByRole('dialog', { name: t.preview.drawerTitle })
    expect(within(drawer).getByRole('region', { name: t.preview.title })).not.toBeNull()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('catches up 250 ms after the last change, within a second, and is busy meanwhile', () => {
    vi.useFakeTimers()
    render(<Wizard wide />)
    const region = () => screen.getByRole('region', { name: t.preview.title })
    expect(paperText()).not.toContain('Nuovo oggetto')
    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    expect(region().getAttribute('aria-busy')).toBe('true')
    expect(paperText()).not.toContain('Nuovo oggetto')
    act(() => void vi.advanceTimersByTime(249))
    expect(paperText()).not.toContain('Nuovo oggetto')
    act(() => void vi.advanceTimersByTime(1))
    expect(paperText()).toContain('Nuovo oggetto')
    expect(region().getAttribute('aria-busy')).toBe('false')
  })

  it('restarts the wait with each change', () => {
    vi.useFakeTimers()
    render(<Wizard wide />)
    fireEvent.click(screen.getByRole('button', { name: 'change' }))
    act(() => void vi.advanceTimersByTime(200))
    // a second change one tick before the first would have settled
    fireEvent.change(screen.getByLabelText(/Oggetto/), { target: { value: 'Ancora un altro' } })
    act(() => void vi.advanceTimersByTime(200))
    expect(paperText()).not.toContain('Ancora un altro')
    act(() => void vi.advanceTimersByTime(60))
    expect(paperText()).toContain('Ancora un altro')
  })
})
