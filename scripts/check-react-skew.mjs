#!/usr/bin/env node
/**
 * scripts/check-react-skew.mjs — do all the frontends' lockfiles resolve the
 * SAME `react` / `react-dom` / `@tanstack/react-router` version?
 *
 * WHY. The shell and every remote share `react` / `react-dom` as Module
 * Federation singletons (ADR 20260709-suite-frontend-module-federation). Each frontend is installed on its own, so
 * each lockfile resolves React independently; when they disagree the singleton
 * negotiation picks the highest version and the others run against a React
 * they were never installed with. That broke every remote once already
 * (inventory-ui's lockfile resolved 19.3.0 while the rest resolved 19.2.7).
 * A skewed lockfile builds, type-checks and passes unit tests — only the
 * assembled suite fails — so it is checked here, statically.
 *
 * `@tanstack/react-router` is a shared singleton on the same terms (the shell's
 * and projects-ui's federation `shared` config), and its behaviour changes
 * between patch versions: 1.170.46 stopped reloading a router that is mounted a
 * second time, which 1.170.17 did, so the one copy the singleton negotiation
 * picks decides how EVERY remote behaves (specs/20261111-push-notifications E-1).
 *
 * HOW. Reads only `lerna.json` and each frontend's `pnpm-lock.yaml` with plain
 * text parsing — no install, no network, no dependencies. A "frontend" is any
 * `lerna.json` package that has a `pnpm-lock.yaml` and no `bun.lock` (the Bun
 * backends), so a new frontend is covered the moment it is listed in
 * `lerna.json`. It collects every `react@x` / `react-dom@x` entry of the
 * lockfile's `packages:` section, so a lockfile that resolves TWO versions of
 * React internally also fails.
 *
 * Usage:
 *   node scripts/check-react-skew.mjs               # the repo this script lives in
 *   node scripts/check-react-skew.mjs --root=<dir>  # any tree with lerna.json + lockfiles (tests)
 *
 * Exit codes: 0 = one version of each across all frontends, 1 = skew (or a
 * lockfile whose React could not be read — never a silent pass), 2 = usage error.
 *
 * Fix a failure from the odd app's directory: `pnpm update react react-dom
 * @tanstack/react-router` (to the version the others resolve; pin the exact
 * router version in package.json), then commit that app's lockfile.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = ['react', 'react-dom', '@tanstack/react-router']

/**
 * Versions of the checked packages in a pnpm v9 lockfile's `packages:`
 * section: keys look like `  react@19.2.7:` or
 * `  '@tanstack/react-router@1.170.46':` (quoted if the name needs it; a peer
 * suffix after the version, as in `snapshots:`, is ignored).
 * Returns { react: Set, 'react-dom': Set, '@tanstack/react-router': Set }.
 */
export function readReactVersions(lockText) {
  const found = Object.fromEntries(PACKAGES.map((pkg) => [pkg, new Set()]))
  let inPackages = false
  for (const line of lockText.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith('packages:')
      continue
    }
    if (!inPackages) continue
    const m = /^ {2}'?(react|react-dom|@tanstack\/react-router)@(\d[^':(]*)(?:\([^']*)?'?:/.exec(line)
    if (m) found[m[1]].add(m[2])
  }
  return found
}

/**
 * Frontend dirs: lerna.json packages that have a pnpm-lock.yaml and are not a
 * Bun service. A directory with a Bun lockfile is a backend even if a stray
 * `pnpm-lock.yaml` was left in it by a tool that ran pnpm there: its React is
 * not part of the federated singleton.
 */
export function frontendDirs(root) {
  const lerna = JSON.parse(readFileSync(join(root, 'lerna.json'), 'utf8'))
  const has = (d, file) => existsSync(join(root, d, file))
  return (lerna.packages ?? []).filter((d) => has(d, 'pnpm-lock.yaml') && !has(d, 'bun.lock') && !has(d, 'bun.lockb'))
}

/**
 * Is `pkg` expected in this frontend's lockfile? react / react-dom always are.
 * `@tanstack/react-router` only where the app's package.json declares it — the
 * design-system library (operai-ui) has a lockfile and React but no router, and
 * must not fail for that. A missing or unreadable package.json counts as
 * declared, so a check can never pass silently for want of the file.
 */
function isExpected(root, dir, pkg) {
  if (pkg === 'react' || pkg === 'react-dom') return true
  try {
    const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
    return [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies].some((d) => d && pkg in d)
  } catch {
    return true
  }
}

/** Returns { problems: string[], table: Record<dir, {react: string[], 'react-dom': string[]}> }. */
export function checkReactSkew(root) {
  const dirs = frontendDirs(root)
  const problems = []
  const table = {}
  if (dirs.length < 2) {
    problems.push(`found ${dirs.length} frontend lockfile(s) under ${root} — expected the whole suite (is lerna.json readable?)`)
  }
  const all = Object.fromEntries(PACKAGES.map((pkg) => [pkg, new Map()])) // version -> dirs
  for (const dir of dirs) {
    const found = readReactVersions(readFileSync(join(root, dir, 'pnpm-lock.yaml'), 'utf8'))
    table[dir] = {}
    for (const pkg of PACKAGES) {
      const versions = [...found[pkg]].sort()
      table[dir][pkg] = versions
      if (versions.length === 0) {
        if (!isExpected(root, dir, pkg)) continue
        problems.push(`${dir}: no ${pkg} entry in pnpm-lock.yaml (lockfile format changed, or the app dropped it?)`)
      } else if (versions.length > 1) {
        problems.push(`${dir}: resolves ${pkg} ${versions.join(' AND ')} in one lockfile (two copies in one app)`)
      }
      for (const v of versions) all[pkg].set(v, [...(all[pkg].get(v) ?? []), dir])
    }
  }
  for (const pkg of PACKAGES) {
    if (all[pkg].size > 1) {
      const detail = [...all[pkg]].map(([v, ds]) => `${v} (${ds.join(', ')})`).join(' vs ')
      problems.push(`${pkg} versions differ across frontends: ${detail}`)
    }
  }
  if (all.react.size === 1 && all['react-dom'].size === 1 && [...all.react.keys()][0] !== [...all['react-dom'].keys()][0]) {
    problems.push(`react ${[...all.react.keys()][0]} and react-dom ${[...all['react-dom'].keys()][0]} differ`)
  }
  return { problems, table }
}

function main() {
  const rootArg = process.argv.find((a) => a.startsWith('--root='))
  const root = rootArg ? resolve(rootArg.slice('--root='.length)) : resolve(dirname(fileURLToPath(import.meta.url)), '..')
  if (!existsSync(join(root, 'lerna.json'))) {
    console.error(`[react-skew] no lerna.json under ${root}`)
    process.exit(2)
  }
  const { problems, table } = checkReactSkew(root)
  for (const [dir, v] of Object.entries(table)) {
    console.log(
      `  ${dir.padEnd(14)} react ${v.react.join(',') || '-'}  react-dom ${v['react-dom'].join(',') || '-'}  react-router ${v['@tanstack/react-router'].join(',') || '-'}`,
    )
  }
  if (problems.length === 0) {
    console.log(`[react-skew] OK — ${Object.keys(table).length} frontends resolve one react / react-dom / @tanstack/react-router version.`)
    return
  }
  for (const p of problems) console.error(`[react-skew] FAIL: ${p}`)
  console.error('[react-skew] Module Federation shares react, react-dom and @tanstack/react-router as singletons across the suite (ADR 20260709-suite-frontend-module-federation); align the odd app with `pnpm update react react-dom @tanstack/react-router` in its directory (pin the exact version in package.json) and commit its lockfile.')
  process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
