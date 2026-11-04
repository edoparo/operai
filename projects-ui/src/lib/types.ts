/**
 * The wire shapes of projects-api (specs/025-projects, tasks.md § API contracts)
 * and of the `auth` directory read. Ids are text (cuids), dates are `YYYY-MM-DD`,
 * and no amount, price or rate exists anywhere (AC-2.9).
 */

export type Entity = 'welld_ch' | 'welld_it'
export type ProjectType = 't_and_m' | 'fixed_price' | 'maintenance' | 'saas' | 'internal'
export type ProjectState = 'planned' | 'active' | 'on_hold' | 'closed' | 'cancelled'
export type ContractOrigin = 'manual' | 'deal'
export type HourPackageKind = 'capacity' | 'yearly'

/** A user as the API reports them: the live name (`null` when unknown), and whether the account is deleted. */
export type Person = { id: string; name: string | null; deleted: boolean }

/** `name` is `null` when crm-api cannot answer (fail soft). */
export type CompanyRef = { id: string; name: string | null }

/** One row of `GET /companies?q=`: what the company picker offers. */
export type CompanyChoice = { id: string; name: string; entity: Entity }

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number }

/** `GET /scope`: what the caller may manage (UX gating only; the server's 403 is the gate, ADR-0014). */
export type Scope = { manage: Entity[]; managesAll: boolean; bexio: boolean }

export type ProjectSummary = {
  id: string
  name: string
  type: ProjectType
  state: ProjectState
  entity: Entity
  company: CompanyRef | null
  /** Distinct contract companies; what a `saas` row shows. */
  clientCount: number
  projectManager: Person
}

/**
 * The deal a contract was made from, read live from the CRM on every request (specs/022): `title` and
 * `won` are `null` when crm-api cannot answer, and `won: false` is the "no longer won" notice (AC-2.3).
 */
export type DealRef = { id: string; title: string | null; won: boolean | null }

export type ContractSummary = {
  id: string
  type: ProjectType
  company: CompanyRef
  origin: ContractOrigin
  bexioOrderId: string | null
  startDate: string
  endDate: string | null
  /** `null` for a contract entered by hand (specs/022). */
  deal: DealRef | null
}

export type Project = {
  id: string
  name: string
  type: ProjectType
  state: ProjectState
  /** The state an `on_hold` project left (and may return to); `null` in every other state. */
  stateBeforeHold: ProjectState | null
  entity: Entity
  company: CompanyRef | null
  projectManager: Person
  team: Person[]
  /** Every contract whole (terms and version), so a contract card needs no request of its own. */
  contracts: Contract[]
  /** Earliest contract start; `null` with no contract. */
  startDate: string | null
  /** Latest contract end; `null` with no contract or when any contract is open-ended. */
  endDate: string | null
  version: number
  createdAt: string
  updatedAt: string
}

// ─── Contract terms (by project type) ────────────────────────────────────────

/** Take-in-charge times in whole working days, 0–60. The UI prefills 1 / 3 (AC-2.5). */
export type Sla = { highDays: number; normalDays: number }

export type HourPackage = {
  hours: number
  kind: HourPackageKind
  startDate: string
  /** Only a `capacity` package expires. */
  expiryDate?: string | null
}

export type Position = { profile: string; plannedManDays: number }

export type FixedPriceTerms = { deadline: string; estimatedManDays?: number | null; maxEffortManDays: number }
export type SlaAndHoursTerms = { sla?: Sla | null; hourPackage?: HourPackage | null }
export type TAndMTerms = { positions: Position[] }

/** What a create or update sends: the member set depends on the project's type (`internal` takes none). */
export type ContractTermsInput = FixedPriceTerms | SlaAndHoursTerms | TAndMTerms | Record<string, never>

/** What a read returns: every member present, `null` when absent. */
export type ContractTerms =
  | { deadline: string; estimatedManDays: number | null; maxEffortManDays: number }
  | { sla: Sla | null; hourPackage: (HourPackage & { expiryDate: string | null }) | null }
  | { positions: Position[] }
  | Record<string, never>

export type Contract = ContractSummary & {
  projectId: string
  /** The deal's id (specs/022); `null` for a contract entered by hand. */
  dealId: string | null
  /** The deal's EstimAI estimate at creation (AC-3.2); `null` for a hand-entered contract and for a deal without one. */
  estimate: { id: string } | null
  terms: ContractTerms
  version: number
}

// ─── The to-start queue and taking a deal (specs/022) ────────────────────────

/** A won deal no project has taken. No amount, currency, owner or notes exist on it (D14). */
export type QueueItem = {
  dealId: string
  title: string
  entity: Entity
  company: CompanyRef
  /** When the deal was won; `null` only if crm-api sends none. */
  wonAt: string | null
  estimate: { id: string; name: string } | null
}

/** `GET /queue`: `truncated` when the CRM has more won deals than the 500 it returns (A26). */
export type QueueList = { items: QueueItem[]; truncated: boolean }

/** The client types a project taken from a deal can have (AC-1.2); `saas` and `internal` have no company. */
export type DealProjectType = 't_and_m' | 'fixed_price' | 'maintenance'

/** The contract part of taking a deal: its dates and its terms, by the project's type (tasks.md § API contracts). */
export type DealContractInput = { startDate: string; endDate?: string | null; terms: ContractTermsInput }

/** One row of `auth GET /authz/users/directory` (ADR-0047). */
export type DirectoryUser = { id: string; name: string | null; email: string; entity: string | null }
