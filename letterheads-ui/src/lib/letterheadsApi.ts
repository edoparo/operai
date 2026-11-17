import { getJson } from './api'
import type { Catalog, LetterheadList } from './types'

/** `GET /v1/catalog` (access): the closed lists and `defaultConfig`. */
export const getCatalog = (init?: RequestInit): Promise<Catalog> => getJson<Catalog>('/v1/catalog', init)

/** `GET /v1/letterheads` (access): both entities, with `activeVersion` and `canManage`. */
export const getLetterheads = (init?: RequestInit): Promise<LetterheadList> =>
  getJson<LetterheadList>('/v1/letterheads', init)
