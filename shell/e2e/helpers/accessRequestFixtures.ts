/**
 * Test-only fixture bridge for specs/20261105-signup-gate e2e (T10).
 *
 * A waiting-list row is only ever written by a refused first OAuth sign-in, and
 * real OAuth cannot run in e2e (`/test-auth/session` deliberately bypasses the
 * gate, AC-1.9). So the rows are seeded straight into `auth`'s database through
 * `auth/scripts/e2e-invite-fixtures.ts`, the same bridge `inviteFixtures.ts`
 * uses and with the same environment prerequisites (see its doc comment).
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.resolve(__dirname, '../../../auth')
const SCRIPT_ARGS = ['run', 'scripts/e2e-invite-fixtures.ts']

function runFixtureScript(args: string[]): string {
  let output: string
  try {
    output = execFileSync('bun', [...SCRIPT_ARGS, ...args], {
      cwd: AUTH_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    output = execFileSync('direnv', ['exec', '.', 'bun', ...SCRIPT_ARGS, ...args], {
      cwd: AUTH_DIR,
      encoding: 'utf-8',
    })
  }
  // Prisma's dev-mode query logging can share stdout: the script's own result is the last JSON line.
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('{')) return lines[i]
  }
  throw new Error(`[accessRequestFixtures] no JSON output (args: ${args.join(' ')})\n${output}`)
}

/** Inserts a `pending` access request, as a refused first sign-in would. Returns its id. */
export function seedAccessRequest(email: string, name: string, provider = 'google'): { id: string } {
  return JSON.parse(runFixtureScript(['seed-access-request', email, name, provider])) as { id: string }
}

/** Best-effort cleanup — deletes every access request whose email contains `tag`. */
export function clearAccessRequests(tag: string): void {
  try {
    runFixtureScript(['clear-access-requests', tag])
  } catch {
    // Best-effort: a cleanup failure must never fail the suite itself.
  }
}
