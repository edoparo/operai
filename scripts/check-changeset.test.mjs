// node --test scripts/check-changeset.test.mjs  (no dependencies)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { addedChangesetsOf, changedAppDirsOf, readAppDirs } from './check-changeset.mjs'

const root = new URL('..', import.meta.url).pathname
const lerna = JSON.parse(readFileSync(join(root, 'lerna.json'), 'utf8')).packages

test('tracked dirs come from lerna.json, including the newer apps', () => {
  assert.deepEqual(readAppDirs(), lerna)
  for (const d of ['crm-ui', 'crm-api', 'meetings-ui', 'meetings-api', 'projects-ui', 'projects-api', 'activities-api']) {
    assert.ok(readAppDirs().includes(d), d)
  }
})

test('readAppDirs refuses a glob or empty list rather than gating nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lerna-'))
  try {
    const f = join(dir, 'lerna.json')
    writeFileSync(f, JSON.stringify({ packages: ['apps/*'] }))
    assert.throws(() => readAppDirs(f), /plain top-level/)
    writeFileSync(f, JSON.stringify({ packages: [] }))
    assert.throws(() => readAppDirs(f), /no "packages"/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('every top-level app dir with a package.json is in lerna.json', () => {
  const out = execFileSync('git', ['ls-files', '*/package.json'], { cwd: root, encoding: 'utf8' })
  const dirs = out
    .split('\n')
    .filter((f) => f.split('/').length === 2)
    .map((f) => f.split('/')[0])
  const missing = dirs.filter((d) => !lerna.includes(d) && d !== 'tools')
  assert.deepEqual(missing, [], `app dirs missing from lerna.json: ${missing.join(', ')}`)
})

test('changeset-check.yml path filters equal lerna.json (both triggers)', () => {
  const yml = readFileSync(join(root, '.github/workflows/changeset-check.yml'), 'utf8')
  const expected = lerna.map((d) => `${d}/**`).sort()
  for (const trigger of ['pull_request', 'push']) {
    const block = yml.split(new RegExp(`^  ${trigger}:`, 'm'))[1].split(/^  \S/m)[0]
    const paths = [...block.matchAll(/^\s+- "([^"]+)"/gm)].map((m) => m[1]).sort()
    assert.deepEqual(paths, expected, `${trigger} paths differ from lerna.json`)
  }
})

test('changedAppDirsOf: a crm-ui change is gated; root files and docs are not', () => {
  assert.deepEqual([...changedAppDirsOf(['crm-ui/src/a.ts', 'docs/x.md', 'pnpm-lock.yaml'], lerna)], ['crm-ui'])
  assert.equal(changedAppDirsOf(['pnpm-lock.yaml', 'scripts/a.mjs', 'specs/x/spec.md'], lerna).size, 0)
  // an app's own lockfile sits inside the app dir, so it counts as app code
  assert.deepEqual([...changedAppDirsOf(['projects-api/bun.lock'], lerna)], ['projects-api'])
})

test('addedChangesetsOf ignores README and non-md files', () => {
  assert.deepEqual(addedChangesetsOf(['.changeset/README.md', '.changeset/a-b.md', '.changeset/config.json', 'x.md']), [
    '.changeset/a-b.md',
  ])
})

// End to end in a throwaway repo: a crm-ui change with / without a changeset.
function run(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}
function gate(repo, base, head) {
  try {
    execFileSync('node', [join(root, 'scripts/check-changeset.mjs'), `--base=${base}`, `--head=${head}`], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return 0
  } catch (e) {
    return e.status
  }
}

test('script exit codes: crm-ui change fails without a changeset, passes with one', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cc-'))
  try {
    run(repo, 'init', '-q')
    run(repo, 'config', 'user.email', 't@t')
    run(repo, 'config', 'user.name', 't')
    run(repo, 'config', 'commit.gpgsign', 'false')
    mkdirSync(join(repo, 'crm-ui'))
    writeFileSync(join(repo, 'crm-ui/a.ts'), '1')
    run(repo, 'add', '-A')
    run(repo, 'commit', '-qm', 'base', '--no-verify')
    const base = run(repo, 'rev-parse', 'HEAD')

    writeFileSync(join(repo, 'crm-ui/a.ts'), '2')
    run(repo, 'commit', '-qam', 'change', '--no-verify')
    assert.equal(gate(repo, base, run(repo, 'rev-parse', 'HEAD')), 1)

    mkdirSync(join(repo, '.changeset'))
    writeFileSync(join(repo, '.changeset/x.md'), '---\n"@operai/crm-ui": patch\n---\nfix\n')
    run(repo, 'add', '-A')
    run(repo, 'commit', '-qm', 'cs', '--no-verify')
    assert.equal(gate(repo, base, run(repo, 'rev-parse', 'HEAD')), 0)

    // a change outside every tracked dir is nothing to gate
    const before = run(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'README.md'), 'x')
    run(repo, 'add', '-A')
    run(repo, 'commit', '-qm', 'docs', '--no-verify')
    assert.equal(gate(repo, before, run(repo, 'rev-parse', 'HEAD')), 0)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
