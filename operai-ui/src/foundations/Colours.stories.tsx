import { useEffect, useRef, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { COLOR_TOKENS } from './tokens'
import type { ColorToken } from './tokens'
import { StatusBadge } from '../components/StatusBadge'

/**
 * Every colour token, with its value in the current theme (read from
 * tokens.css at runtime, never copied here), its role, and whether it may be
 * used as text. For the text tokens the swatch shows the measured contrast on
 * the page background (`--ink`) and on a panel (`--ink-soft`); WCAG AA for
 * small text is 4.5:1. Switch the Theme toolbar to see the light values.
 */
const meta: Meta = {
  title: 'Foundations/Colours',
  parameters: { controls: { disable: true } },
}
export default meta

// Complete class names (Tailwind only generates what it sees whole).
const FILL: Record<string, string> = {
  '--ink': 'bg-ink',
  '--ink-soft': 'bg-ink-soft',
  '--ink-mid': 'bg-ink-mid',
  '--rule': 'bg-rule',
  '--dim': 'bg-dim',
  '--text': 'bg-text',
  '--soft': 'bg-soft',
  '--muted': 'bg-muted',
  '--acc': 'bg-acc',
  '--acc-hi': 'bg-acc-hi',
  '--acc-lo': 'bg-acc-lo',
  '--acc-solid': 'bg-acc-solid',
  '--acc-text': 'bg-acc-text',
  '--grn': 'bg-grn',
  '--grn-text': 'bg-grn-text',
  '--org': 'bg-org',
  '--org-text': 'bg-org-text',
  '--red': 'bg-red',
  '--red-text': 'bg-red-text',
  '--ai': 'bg-ai',
}

const TEXT: Record<string, string> = {
  '--text': 'text-text',
  '--soft': 'text-soft',
  '--acc-text': 'text-acc-text',
  '--grn-text': 'text-grn-text',
  '--org-text': 'text-org-text',
  '--red-text': 'text-red-text',
  '--ai': 'text-ai',
}

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Surfaces and borders', names: ['--ink', '--ink-soft', '--ink-mid', '--rule', '--dim'] },
  { title: 'Text', names: ['--text', '--soft', '--muted'] },
  { title: 'Accent', names: ['--acc', '--acc-hi', '--acc-lo', '--acc-solid', '--acc-text'] },
  { title: 'Tones', names: ['--grn', '--grn-text', '--org', '--org-text', '--red', '--red-text'] },
  { title: 'Special', names: ['--ai'] },
]

type Rgb = [number, number, number, number]

const parseColor = (value: string): Rgb | null => {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  return [parts[0], parts[1], parts[2], parts[3] ?? 1]
}

const luminance = ([r, g, b]: Rgb) => {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The token's value and, for a text token, its contrast on ink and ink-soft — re-read when the theme changes. */
function useMeasurements(name: string, theme: unknown) {
  const [state, setState] = useState<{ value: string; onInk?: number; onPanel?: number }>({ value: '' })
  const probe = useRef<HTMLSpanElement>(null)
  const ink = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      const fg = probe.current && parseColor(getComputedStyle(probe.current).color)
      const bgInk = ink.current && parseColor(getComputedStyle(ink.current).backgroundColor)
      const bgPanel = panel.current && parseColor(getComputedStyle(panel.current).backgroundColor)
      setState({
        value,
        onInk: fg && bgInk ? contrast(fg, bgInk) : undefined,
        onPanel: fg && bgPanel ? contrast(fg, bgPanel) : undefined,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [name, theme])
  return { ...state, probe, ink, panel }
}

function Swatch({ token, theme }: { token: ColorToken; theme: unknown }) {
  const { value, onInk, onPanel, probe, ink, panel } = useMeasurements(token.name, theme)
  const textClass = TEXT[token.name]
  return (
    <li className="card gap-2">
      <span aria-hidden="true" className={`block h-12 rounded-md border border-rule ${FILL[token.name] ?? ''}`} />
      <code className="font-mono text-xs text-text">{token.name}</code>
      <span className="font-mono text-2xs text-soft">{value}</span>
      <span className="text-xs text-soft">{token.role}</span>
      {token.text ? (
        <StatusBadge status="active">May be text</StatusBadge>
      ) : (
        <StatusBadge status="voided">Not for text</StatusBadge>
      )}
      {textClass && (
        <>
          <span className="flex gap-2">
            <span ref={ink} className="flex-1 rounded bg-ink px-2 py-1">
              <span ref={probe} className={`text-sm ${textClass}`}>
                Aa
              </span>
            </span>
            <span ref={panel} className="flex-1 rounded bg-ink-soft px-2 py-1">
              <span className={`text-sm ${textClass}`}>Aa</span>
            </span>
          </span>
          <span className="font-mono text-2xs text-soft">
            {onInk !== undefined && onPanel !== undefined
              ? `${onInk.toFixed(1)}:1 on ink · ${onPanel.toFixed(1)}:1 on panel`
              : ' '}
          </span>
        </>
      )}
    </li>
  )
}

function PaletteView({ theme }: { theme: unknown }) {
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-2xl text-sm text-soft">
        Values are read from <code className="font-mono">tokens.css</code> in the current theme. Use them through token
        utilities (<code className="font-mono">text-soft</code>, <code className="font-mono">bg-ink-mid</code>,{' '}
        <code className="font-mono">border-rule</code>, <code className="font-mono">bg-org/10</code>), never as a hex
        value or <code className="font-mono">var(--…)</code> in TypeScript. Base tones are fills, borders and glyphs;
        the matching <code className="font-mono">*-text</code> token is the same tone as text.
      </p>
      {GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-3">
          <h2 className="font-disp text-lg font-bold">{group.title}</h2>
          <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3 p-0">
            {group.names.map((name) => {
              const token = COLOR_TOKENS.find((candidate) => candidate.name === name)
              return token ? <Swatch key={name} token={token} theme={theme} /> : null
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export const Palette: StoryObj = {
  render: (_args, { globals }) => <PaletteView theme={globals.theme} />,
}

function Usage() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h2 className="font-disp text-lg font-bold">Text on surfaces</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['bg-ink', 'Page (ink)'],
          ['bg-ink-soft', 'Panel (ink-soft)'],
          ['bg-ink-mid', 'Control (ink-mid)'],
        ].map(([surface, label]) => (
          <div key={surface} className={`flex flex-col gap-1 rounded-md border border-rule p-3 ${surface}`}>
            <span className="text-2xs font-mono text-soft">{label}</span>
            <span className="text-sm text-text">Primary text</span>
            <span className="text-xs text-soft">Secondary text: labels, meta</span>
            <span className="text-xs text-acc-text underline">Accent text: a link</span>
            <span className="text-xs text-grn-text">Success text</span>
            <span className="text-xs text-org-text">Warning text</span>
            <span className="text-xs text-red-text">Danger text: a field error</span>
          </div>
        ))}
      </div>
      <h2 className="font-disp text-lg font-bold">Tints</h2>
      <p className="text-sm text-soft">
        A tone at 10% opacity is the tinted background of its badge or banner; the label on it uses the tone&apos;s text
        token.
      </p>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md border border-acc/40 bg-acc/10 px-3 py-2 text-xs text-acc-text">bg-acc/10</span>
        <span className="rounded-md border border-grn/40 bg-grn/10 px-3 py-2 text-xs text-grn-text">bg-grn/10</span>
        <span className="rounded-md border border-org/40 bg-org/10 px-3 py-2 text-xs text-org-text">bg-org/10</span>
        <span className="rounded-md border border-red/40 bg-red/10 px-3 py-2 text-xs text-red-text">bg-red/10</span>
      </div>
    </div>
  )
}

export const TextOnSurfaces: StoryObj = {
  name: 'Text on surfaces',
  render: () => <Usage />,
}
