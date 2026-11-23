/**
 * @vitest-environment jsdom
 *
 * The estimate JSON file (2026-11-23): what the editor's Export JSON writes is what the list's Import
 * JSON reads back.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEF_PARAMS, contentFromProjectJson, exportProjectToJson, importProjectFromJson, loadProject, projectJsonFileName } from './projects'
import type { Activity, Release } from '../types'

afterEach(() => localStorage.clear())

const releases = [{ id: 'r1', name: 'MVP', fte: 2 }] as unknown as Release[]
const acts = [{ id: 'a1', epic: 'Core', name: 'Login', release: 'MVP', ml: 3 }] as unknown as Activity[]

describe('estimate JSON', () => {
  it('round-trips through the import, with no id, owner or link of its own', () => {
    const raw = exportProjectToJson({ name: 'Intranet', author: 'Ada', params: DEF_PARAMS, releases, acts })
    expect(Object.keys(JSON.parse(raw))).toEqual(['name', 'author', 'params', 'releases', 'acts'])
    const id = importProjectFromJson(raw)
    expect(loadProject(id)).toMatchObject({ name: 'Intranet', author: 'Ada', params: DEF_PARAMS, releases, acts })
  })

  it('names the file after the estimate', () => {
    expect(projectJsonFileName('IBI SA — Digitalizzazione modulistica')).toBe('IBI_SA_—_Digitalizzazione_modulistica.json')
    expect(projectJsonFileName('a/b: c')).toBe('ab_c.json')
    expect(projectJsonFileName('   ')).toBe('estimate.json')
  })

  it('into an open estimate: only the content, missing parameters defaulted, fresh ids', () => {
    const raw = JSON.stringify({ name: 'Ignored', author: 'Ignored', params: { aiGain: 0.5 }, releases, acts })
    const content = contentFromProjectJson(raw)
    expect(Object.keys(content)).toEqual(['params', 'releases', 'acts'])
    expect(content.params).toEqual({ ...DEF_PARAMS, aiGain: 0.5 })
    expect(content.releases[0]).toMatchObject({ name: 'MVP', fte: 2 })
    expect(content.releases[0]!.id).not.toBe('r1')
    expect(content.acts[0]).toMatchObject({ name: 'Login', release: 'MVP' })
    expect(content.acts[0]!.id).not.toBe('a1')
    expect(() => contentFromProjectJson('{"params": null, "releases": [], "acts": []}')).toThrow()
  })
})
