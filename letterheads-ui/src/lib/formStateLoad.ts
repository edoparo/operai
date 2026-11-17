import { getJson } from './api'
import type { Entity } from './types'
import type { FormConfig } from './formStateTypes'

/**
 * `GET /v1/letterheads/{entity}/versions/{n}` (access): one stored version, `{ version, layoutVersion,
 * config }` (plan § Person routes; `layoutVersion` is the layout the version was saved on, G6). The form
 * loads the active version with it; the history (T25) opens an old one the same way.
 */
export interface VersionAnswer {
  version: number
  layoutVersion: number
  config: FormConfig
}

export const getVersion = (entity: Entity, version: number, init?: RequestInit): Promise<VersionAnswer> =>
  getJson<VersionAnswer>(`/v1/letterheads/${entity}/versions/${version}`, init)
