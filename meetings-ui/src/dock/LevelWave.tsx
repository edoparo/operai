import { useEffect, useState } from 'react'

/** Bars drawn, newest on the right. */
export const WAVE_BARS = 14
/** One new bar this often. */
export const WAVE_SAMPLE_MS = 90
/** The lowest bar, so silence still shows a line. */
const FLOOR = 0.08

export type LevelWaveProps = {
  /** Reads the current level, 0..1, or null when there is nothing to measure. */
  read: () => number | null
  /** Sampling stops when false (paused, saving): the wave rests at the floor. */
  active: boolean
  /** The visible short label ("In", "Out"). */
  label: string
  /** The accessible name of the meter ("Microphone level"). */
  meterLabel: string
  /** The bars' colour, a complete token class string (`bg-acc`). */
  barClassName: string
  testId?: string
}

const flat = () => Array.from({ length: WAVE_BARS }, () => 0)

/**
 * LevelWave — how loud one source is, as a short scrolling wave of bars (spec A13). The bars are decoration
 * (`aria-hidden`); the meter itself is a `meter` with the current level, so a screen reader can ask for it, and
 * nothing is announced. It samples only while `active` and while the tab is visible, at most every 90 ms.
 */
export function LevelWave({ read, active, label, meterLabel, barClassName, testId }: LevelWaveProps) {
  const [bars, setBars] = useState<number[]>(flat)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      let level: number | null = null
      try {
        level = read()
      } catch {
        level = null
      }
      setBars((current) => [...current.slice(1), level ?? 0])
    }, WAVE_SAMPLE_MS)
    return () => clearInterval(timer)
  }, [active, read])

  // Not sampling: the wave rests flat (paused, saving).
  const shown = active ? bars : flat()
  const now = shown[shown.length - 1] ?? 0
  return (
    <span className="flex items-center gap-1.5" data-testid={testId}>
      <span className="font-mono text-2xs text-soft">{label}</span>
      <span
        role="meter"
        aria-label={meterLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(now * 100)}
        className="flex h-5 items-center gap-px"
      >
        {shown.map((value, index) => (
          <span
            // the bars are a fixed-length window; their position is their identity
            key={index}
            aria-hidden="true"
            className={`w-0.5 rounded-full ${barClassName}`}
            style={{ height: `${Math.round(Math.max(FLOOR, value) * 100)}%` }}
          />
        ))}
      </span>
    </span>
  )
}
