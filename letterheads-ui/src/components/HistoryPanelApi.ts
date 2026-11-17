/**
 * What the history asks of letterhead-api (task T25; plan § Person routes, amendment G9; `routes/read.rs`
 * `versions`, `routes/write.rs` `restore`):
 *
 * - `GET /v1/letterheads/{entity}/versions`: `[{ version, createdBy: { sub, name }, createdAt, changedSettings,
 *   restoredFrom }]`, newest first;
 * - `POST /v1/letterheads/{entity}/versions/{n}/restore` with `{ baseVersion }`: 201 `{ version }`; 409
 *   `version_conflict` (`currentVersion`); 403 `forbidden` / `out_of_scope`; 422 `unknown_layout`; 404
 *   `letterhead_version_not_found`; 429 `busy`, 5xx and the network: it did not happen, trying again may work.
 */
import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '@operai/ui'
import { ApiError, getJson, sendJson } from '../lib/api'
import type { Entity } from '../lib/types'
import { strings } from '../strings'

/** One version of the history, as the table reads it. */
export interface HistoryRow {
  version: number
  /** The display name of the person who saved it (G9); the account id when the service had no name. */
  savedBy: string
  /** An ISO 8601 instant. */
  createdAt: string
  /** The closed set of `settingNames` (G9). A restore holds the names that differed from the version it replaced. */
  changedSettings: readonly string[]
  /** The version a restore copied; `null` for a save. */
  restoredFrom: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isVersionNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

/** The answer is not an array: not what the contract says. */
export class HistoryShapeError extends Error {
  constructor() {
    super('The history answer is not what the contract says')
    this.name = 'HistoryShapeError'
  }
}

/**
 * Reads the answer into rows, newest first. An entry that is not a version (no whole version number) is left
 * out rather than shown half-empty; an answer that is not a list at all is a failure.
 */
export function parseHistory(answer: unknown): HistoryRow[] {
  if (!Array.isArray(answer)) throw new HistoryShapeError()
  const rows = answer.flatMap((entry: unknown): HistoryRow[] => {
    if (!isRecord(entry) || !isVersionNumber(entry.version)) return []
    const by = isRecord(entry.createdBy) ? entry.createdBy : {}
    const name = typeof by.name === 'string' && by.name.trim() !== '' ? by.name : null
    const sub = typeof by.sub === 'string' ? by.sub : ''
    return [
      {
        version: entry.version,
        savedBy: name ?? sub,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
        changedSettings: Array.isArray(entry.changedSettings)
          ? entry.changedSettings.filter((item): item is string => typeof item === 'string')
          : [],
        restoredFrom: isVersionNumber(entry.restoredFrom) ? entry.restoredFrom : null,
      },
    ]
  })
  return rows.sort((a, b) => b.version - a.version)
}

/** `GET /v1/letterheads/{entity}/versions` (access). */
export const getHistory = async (entity: Entity, init?: RequestInit): Promise<HistoryRow[]> =>
  parseHistory(await getJson<unknown>(`/v1/letterheads/${entity}/versions`, init))

/** The highest version of the history: the active one (the service activates the newest). `null` for an empty history. */
export const newestVersion = (rows: readonly HistoryRow[] | null): number | null =>
  rows === null || rows.length === 0 ? null : Math.max(...rows.map((row) => row.version))

export interface VersionHistory {
  status: 'loading' | 'ready' | 'error'
  /** The last answer; kept while the next one is awaited, and after a reload that failed. `null` until the first. */
  rows: readonly HistoryRow[] | null
  error: unknown
  /** Loads again behind the rows on screen (after a conflict, or a failure). */
  reload: () => void
}

interface Settled {
  entity: Entity
  attempt: number
  rows: readonly HistoryRow[] | null
  error: unknown
}

/**
 * The history of `entity`, loaded when the component mounts. `reload` asks again without throwing the rows on
 * screen away (the restore dialog sits over them and reads the active version from them); only the first load
 * has nothing to show. An answer for another entity or an older attempt is never shown.
 */
export function useVersionHistory(entity: Entity): VersionHistory {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<Settled | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getHistory(entity, { signal: controller.signal }).then(
      (rows) => {
        if (!controller.signal.aborted) setSettled({ entity, attempt, rows, error: null })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setSettled((previous) => ({
          entity,
          attempt,
          rows: previous?.entity === entity ? previous.rows : null,
          error: error ?? new Error('unknown'),
        }))
      },
    )
    return () => controller.abort()
  }, [entity, attempt])

  const reload = useCallback(() => setAttempt((current) => current + 1), [])
  const current = settled?.entity === entity ? settled : null
  const done = current !== null && current.attempt === attempt
  return {
    status: !done ? 'loading' : current.error === null ? 'ready' : 'error',
    rows: current?.rows ?? null,
    error: done ? current.error : null,
    reload,
  }
}

/** A date for a person; what the service sent, as it came, when it is not a date. */
export const formatSavedAt = (createdAt: string): string =>
  Number.isNaN(new Date(createdAt).getTime()) ? createdAt : formatDateTime(createdAt)

/** The words for one name of `changedSettings`; a name this build does not know is shown as received. */
export const settingName = (name: string): string =>
  Object.prototype.hasOwnProperty.call(strings.history.setting, name)
    ? strings.history.setting[name as keyof typeof strings.history.setting]
    : name

/** "What changed" of a row: a restore says whose settings it copied, a save lists the names of what it changed. */
export function describeChanged(row: HistoryRow): string {
  if (row.restoredFrom !== null) return strings.history.sameAs(row.restoredFrom)
  return row.changedSettings.length === 0
    ? strings.history.nothingChanged
    : row.changedSettings.map(settingName).join(', ')
}

/**
 * Restores `version` of `entity`, the entity's active version being `baseVersion`. Resolves the version the
 * restore made. A 201 whose body names no version still is a restore: the service only restores when the base is
 * the newest, so the version it made is `baseVersion + 1`.
 */
export async function restoreVersion(
  entity: Entity,
  version: number,
  baseVersion: number,
  signal?: AbortSignal,
): Promise<number> {
  const answer = await sendJson<unknown>(
    `/v1/letterheads/${entity}/versions/${version}/restore`,
    'POST',
    { baseVersion },
    { signal },
  )
  const made = isRecord(answer) ? answer.version : undefined
  return isVersionNumber(made) ? made : baseVersion + 1
}

/** A restore that did not happen, as the dialog acts on it. */
export type RestoreFailure =
  /** A newer version exists: the history is out of date. */
  | { kind: 'conflict' }
  /** The person may no longer change this letterhead. */
  | { kind: 'lost' }
  /** Anything else: the sentence to show. Nothing changed; trying again may help. */
  | { kind: 'failed'; message: string }

/** Reads a thrown value of `restoreVersion` into what the dialog does about it. */
export function classifyRestoreFailure(error: unknown, version: number): RestoreFailure {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === 'version_conflict') return { kind: 'conflict' }
    if (error.status === 403) return { kind: 'lost' }
    if (error.status === 422 && error.code === 'unknown_layout') {
      return { kind: 'failed', message: strings.restore.unknownLayout }
    }
  }
  return { kind: 'failed', message: strings.restore.failed(version) }
}
