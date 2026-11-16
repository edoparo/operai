/**
 * AC-6.7 (specs/20261115-crm-offer-wizard; design F5): nothing of an offer draft is kept in the browser — no
 * `localStorage`, `sessionStorage`, IndexedDB, Cache API or cookie, not even for UI state. The draft lives in the
 * page's memory and in crm-api, and nowhere else (ADR 20261115-offer-draft-server-held-generated-from-stored-state).
 *
 * This reads the SOURCE of every file that is part of the wizard, as code with the comments left out (the files'
 * own comments say "no `localStorage`"), so a later task that adds a storage call to any of them fails here, not in
 * review. The run-time half — a whole editing session touching no storage — is in `hooks/useOfferDraft.test.tsx`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const isSource = (file: string) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)

/** The wizard: its folder, its engine copy, its draft hook and client, and any file named for the wizard or the draft. */
const isWizardFile = (file: string): boolean => {
  const path = relative(SRC, file).split('\\').join('/')
  return (
    path.startsWith('components/offerWizard/') ||
    path.startsWith('lib/offerEngine/') ||
    path.startsWith('strings/offerWizard') ||
    /(^|\/)(use)?offer(wizard|draft)[^/]*\.tsx?$/i.test(path) ||
    path === 'lib/crmApi.ts' ||
    path === 'lib/api.ts' ||
    path === 'lib/offerErrors.ts'
  )
}

/** The web-storage names: as a bare identifier, as a property name, or as the string of a computed access. */
const STORAGE_NAMES = new Set([
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'IDBFactory',
  'IDBDatabase',
  'openDatabase',
  'caches',
  'CacheStorage',
  'Storage',
  'StorageEvent',
  'cookieStore',
])

/** Modules whose job is to remember something in the browser. */
const STORAGE_MODULES =
  /(^|[/@-])(idb|dexie|localforage|store2|js-cookie|use-local-storage|redux-persist)($|[/-])|persist/i

export function storageUses(source: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && STORAGE_NAMES.has(node.text)) found.push(node.text)
    if (ts.isStringLiteralLike(node) && STORAGE_NAMES.has(node.text)) found.push(`"${node.text}"`)
    // `document.cookie`
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'cookie') found.push('.cookie')
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'cookie'
    ) {
      found.push('["cookie"]')
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (STORAGE_MODULES.test(node.moduleSpecifier.text)) found.push(`import ${node.moduleSpecifier.text}`)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteralLike(arg) && STORAGE_MODULES.test(arg.text)) found.push(`import ${arg.text}`)
    }
    ts.forEachChild(node, visit)
  }
  // `createSourceFile` keeps comments out of the tree: nothing a comment says is visited.
  visit(ts.createSourceFile('x.tsx', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX))
  return found
}

describe('the checker itself', () => {
  it('finds each way of reaching browser storage', () => {
    expect(storageUses('localStorage.setItem("a", "b")')).toEqual(['localStorage'])
    expect(storageUses('window.sessionStorage.getItem("a")')).toEqual(['sessionStorage'])
    expect(storageUses('const k = window["localStorage"]')).toEqual(['"localStorage"'])
    expect(storageUses('const db = indexedDB.open("x")')).toEqual(['indexedDB'])
    expect(storageUses('document.cookie = "a=b"')).toEqual(['.cookie'])
    expect(storageUses('const c = await caches.open("x")')).toEqual(['caches'])
    expect(storageUses('import { openDB } from "idb"')).toEqual(['import idb'])
    expect(storageUses('const m = await import("localforage")')).toEqual(['import localforage'])
    expect(storageUses('import { persist } from "zustand/middleware/persist"')).toEqual([
      'import zustand/middleware/persist',
    ])
  })

  it('does not read comments, nor names that merely contain a storage word', () => {
    expect(storageUses('// never localStorage or sessionStorage\n/* indexedDB */ const x = 1')).toEqual([])
    expect(storageUses('const myLocalStorageFree = 1; const cookies = []; const storageKey = 2')).toEqual([])
  })
})

describe('AC-6.7: the wizard keeps nothing of the draft in the browser', () => {
  const files = walk(SRC).filter(isSource).filter(isWizardFile).sort()

  it('scans the wizard’s files — the scan cannot pass by finding none', () => {
    const names = files.map((file) => relative(SRC, file).split('\\').join('/'))
    expect(names).toContain('hooks/useOfferDraft.ts')
    expect(names).toContain('lib/crmApi.ts')
    expect(names).toContain('components/offerWizard/OfferWizard.tsx')
    expect(names.some((name) => name.startsWith('lib/offerEngine/'))).toBe(true)
  })

  it('uses no web storage, IndexedDB, Cache API or cookie, and no library that does', () => {
    const offenders = files
      .map((file) => ({ file: relative(SRC, file), uses: storageUses(readFileSync(file, 'utf8')) }))
      .filter(({ uses }) => uses.length > 0)
    expect(offenders).toEqual([])
  })
})
