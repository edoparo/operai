/**
 * The state of a save (task T24; design F7): one request at a time, and what it came to. The page decides what
 * each outcome does to its form (`onSaved`, `onRefused`, `onConflict`, `onLost`); this keeps the request, the
 * guard against a second click, and the outcome that is shown (the confirmation, the "not saved" banner).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormConfig, Problem } from '../lib/formStateTypes'
import type { Entity } from '../lib/types'
import { classifySaveFailure, saveVersion } from './SaveBarApi'

/** What the last save came to, for the banners that stay on screen. */
export type SaveOutcome =
  { kind: 'idle' } | { kind: 'saved'; version: number } | { kind: 'failed'; message: string; retryable: boolean }

export interface SaveFlowOptions {
  entity: Entity
  /** The version the form was loaded from (0: the entity has none). Read when the person clicks. */
  baseVersion: number
  /** The form as it is now. Read when the person clicks: what is sent is what was on screen then. */
  config: FormConfig
  /** 201: `config` is now version `version`. */
  onSaved: (version: number, config: FormConfig) => void
  /** 422: these values were refused, nothing was saved. */
  onRefused: (problems: Problem[]) => void
  /** 409: a newer version exists. */
  onConflict: (currentVersion: number | null) => void
  /** 403: the person may no longer change this letterhead. */
  onLost: () => void
}

export interface SaveFlow {
  saving: boolean
  outcome: SaveOutcome
  save: () => void
  /** Hides the confirmation or the failure. */
  dismiss: () => void
}

export function useSaveFlow(options: SaveFlowOptions): SaveFlow {
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState<SaveOutcome>({ kind: 'idle' })
  const latest = useRef(options)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    latest.current = options
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const save = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    // What is sent is what the form holds now; the edits made while the request runs are not in it, and stay unsaved.
    const { entity, baseVersion, config } = latest.current
    setSaving(true)
    setOutcome({ kind: 'idle' })
    saveVersion(entity, baseVersion, config).then(
      (version) => {
        inFlight.current = false
        // The version exists now whether or not the person is still here: the page says so to the list it shares.
        latest.current.onSaved(version, config)
        if (!alive.current) return
        setSaving(false)
        setOutcome({ kind: 'saved', version })
      },
      (error: unknown) => {
        inFlight.current = false
        if (!alive.current) return
        setSaving(false)
        const failure = classifySaveFailure(error)
        if (failure.kind === 'refused') latest.current.onRefused(failure.problems)
        else if (failure.kind === 'conflict') latest.current.onConflict(failure.currentVersion)
        else if (failure.kind === 'lost') latest.current.onLost()
        else setOutcome({ kind: 'failed', message: failure.message, retryable: failure.retryable })
      },
    )
  }, [])

  const dismiss = useCallback(() => setOutcome({ kind: 'idle' }), [])
  return { saving, outcome, save, dismiss }
}
