/**
 * One-off import of the CRM's activities into activities-api (specs/20261110-activities US-2, ADR 20261110-activities-migration-write-pause).
 *
 *   CRM_DATABASE_URL=<url> DATABASE_URL=<url> bun scripts/import-crm-activities.ts [--apply]
 *
 * The two connection strings come from the ENVIRONMENT only, never from flags: a flag lands in
 * `ps` and in the shell history (OWASP review L4).
 *
 * Reads crm-api's `activity`, `activity_participant`, `task_blocker` and `meeting_host_state`
 * (read only, one repeatable-read snapshot) and writes them to activities-api's `activity`,
 * `activity_participant`, `task_blocker` and `meeting_mirror_state` with the SAME ids and
 * timestamps (raw INSERT, so `updatedAt` is not reset), `hostApp='crm'`, `hostType='company'`,
 * `hostId=companyId`, `kind='pre_sales'`.
 *
 * - Dry run by default: it reads and reports, writes nothing. `--apply` writes.
 * - Re-runnable (AC-2.2): a row already present with equal fields is counted, never rewritten,
 *   so a second `--apply` inserts 0.
 * - Every row that already exists in the target is compared FIELD BY FIELD with what the source
 *   would produce. Any difference, or a meeting already mirrored by another activity, is a
 *   mismatch: nothing is written (not even the rows that would have been fine) and the exit
 *   code is 1 (AC-2.3).
 * - The copy is trusted by a count, not by its exit code (ADR 20261110-activities-migration-write-pause): per table the report shows
 *   found / inserted / already present / mismatched, and with `--apply` the target is re-read
 *   INSIDE the transaction and compared again; unless every source row is present with equal
 *   fields the transaction rolls back and the exit code is 1.
 * - A contact crm-api has erased (a row in the target's `erased_contact`, AC-8.4) is never linked
 *   again: a source activity that would be INSERTED with such a contactId is a mismatch (the script
 *   cannot answer 422), nothing is written, exit 1. The write takes the contact's advisory lock
 *   (the same key as the erasure and the user routes) and re-reads the tombstone after it.
 * - The report names tables, ids and FIELD NAMES only, never a value: activity subjects and
 *   bodies are free text about clients. Connection strings are never printed.
 *
 * Exit codes: 0 accounted for (dry run: nothing in the way), 1 mismatch or failure, 2 usage.
 * Pause activities-api writes first (ACTIVITIES_MAINTENANCE=true, ADR 20261110-activities-migration-write-pause): with writes on
 * either side the count proves nothing.
 */

import { SQL } from "bun";

type Row = Record<string, string | number | null>;
type Tx = Pick<SQL, "unsafe">;

export interface TableReport {
  /** Rows in the source. */
  found: number;
  /** Rows written by this run (dry run: rows that WOULD be written). */
  inserted: number;
  /** Rows already in the target with every compared field equal. */
  alreadyPresent: number;
  /** Rows already in the target that differ, or collide on a unique key. Ids/keys only. */
  mismatched: { key: string; fields: string[] }[];
}

export interface ImportReport {
  applied: boolean;
  tables: Record<TableName, TableReport>;
  /** CRM-hosted activities in the target that are not in the source (informational). */
  targetOnlyActivities: number;
  /** True when every table has mismatched = 0 and found = inserted + alreadyPresent. */
  accountedFor: boolean;
}

const TABLES = ["activity", "activity_participant", "task_blocker", "meeting_mirror_state"] as const;
export type TableName = (typeof TABLES)[number];

// ─── Column maps ──────────────────────────────────────────────────────────────

/** Timestamps travel as text so no driver time zone can shift them. */
const TS = (c: string) => `"${c}"::text AS "${c}"`;

const SOURCE_ACTIVITY_SQL = `SELECT "id", "type"::text AS "type", "subject", "body", ${TS("occurredAt")},
  "companyId", "contactId", "dealId", "authorUserId", "dueDate"::text AS "dueDate", "assigneeUserId",
  ${TS("completedAt")}, "completedByUserId", "meetingId", ${TS("createdAt")}, ${TS("updatedAt")}
  FROM "activity" ORDER BY "id"`;
const SOURCE_PARTICIPANT_SQL = `SELECT "activityId", "userId", "createdBy", ${TS("createdAt")}
  FROM "activity_participant" ORDER BY "activityId", "userId"`;
const SOURCE_BLOCKER_SQL = `SELECT "blockedId", "blockerId", "createdBy", ${TS("createdAt")}
  FROM "task_blocker" ORDER BY "blockedId", "blockerId"`;
const SOURCE_STATE_SQL = `SELECT "meetingId", "lastSeq", ${TS("updatedAt")}
  FROM "meeting_host_state" ORDER BY "meetingId"`;

const TARGET_ACTIVITY_SQL = `SELECT "id", "kind"::text AS "kind", "type"::text AS "type", "hostApp"::text AS "hostApp",
  "hostType", "hostId", "subject", "body", ${TS("occurredAt")}, "contactId", "dealId", "authorUserId",
  "dueDate"::text AS "dueDate", "assigneeUserId", ${TS("completedAt")}, "completedByUserId", "meetingId",
  ${TS("createdAt")}, ${TS("updatedAt")} FROM "activity"`;
const TARGET_PARTICIPANT_SQL = `SELECT "activityId", "userId", "createdBy", ${TS("createdAt")} FROM "activity_participant"`;
const TARGET_BLOCKER_SQL = `SELECT "blockedId", "blockerId", "createdBy", ${TS("createdAt")} FROM "task_blocker"`;
const TARGET_ERASED_SQL = `SELECT "contactId" FROM "erased_contact"`;
const TARGET_STATE_SQL = `SELECT "meetingId", "lastSeq", ${TS("updatedAt")} FROM "meeting_mirror_state"`;

/** The row activities-api must hold for a source activity. `completionSeq` is target-only and not compared. */
function expectedActivity(s: Row): Row {
  return {
    id: s["id"]!,
    kind: "pre_sales",
    type: s["type"]!,
    hostApp: "crm",
    hostType: "company",
    hostId: s["companyId"]!,
    subject: s["subject"]!,
    body: s["body"]!,
    occurredAt: s["occurredAt"]!,
    contactId: s["contactId"]!,
    dealId: s["dealId"]!,
    authorUserId: s["authorUserId"]!,
    dueDate: s["dueDate"]!,
    assigneeUserId: s["assigneeUserId"]!,
    completedAt: s["completedAt"]!,
    completedByUserId: s["completedByUserId"]!,
    meetingId: s["meetingId"]!,
    createdAt: s["createdAt"]!,
    updatedAt: s["updatedAt"]!,
  };
}

const diff = (expected: Row, actual: Row): string[] =>
  Object.keys(expected).filter((f) => (expected[f] ?? null) !== (actual[f] ?? null));

// ─── Reading ──────────────────────────────────────────────────────────────────

interface Snapshot {
  /** Target only: the ids in `erased_contact`. */
  erased: Set<string>;
  activities: Row[];
  participants: Row[];
  blockers: Row[];
  states: Row[];
}

async function readSource(source: SQL): Promise<Snapshot> {
  // One snapshot across the four reads, and read only: this script can never write to the CRM.
  return source.begin(async (tx) => {
    await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return {
      erased: new Set<string>(),
      activities: (await tx.unsafe(SOURCE_ACTIVITY_SQL)) as Row[],
      participants: (await tx.unsafe(SOURCE_PARTICIPANT_SQL)) as Row[],
      blockers: (await tx.unsafe(SOURCE_BLOCKER_SQL)) as Row[],
      states: (await tx.unsafe(SOURCE_STATE_SQL)) as Row[],
    };
  });
}

async function readTarget(tx: Tx): Promise<Snapshot> {
  return {
    erased: new Set(((await tx.unsafe(TARGET_ERASED_SQL)) as Row[]).map((r) => r["contactId"] as string)),
    activities: (await tx.unsafe(TARGET_ACTIVITY_SQL)) as Row[],
    participants: (await tx.unsafe(TARGET_PARTICIPANT_SQL)) as Row[],
    blockers: (await tx.unsafe(TARGET_BLOCKER_SQL)) as Row[],
    states: (await tx.unsafe(TARGET_STATE_SQL)) as Row[],
  };
}

// ─── Comparison ───────────────────────────────────────────────────────────────

interface Plan {
  report: Record<TableName, TableReport>;
  targetOnlyActivities: number;
  insert: { activity: Row[]; activity_participant: Row[]; task_blocker: Row[]; meeting_mirror_state: Row[] };
}

function plan(source: Snapshot, target: Snapshot): Plan {
  const empty = (): TableReport => ({ found: 0, inserted: 0, alreadyPresent: 0, mismatched: [] });
  const report = {
    activity: empty(),
    activity_participant: empty(),
    task_blocker: empty(),
    meeting_mirror_state: empty(),
  } satisfies Record<TableName, TableReport>;
  const insert: Plan["insert"] = { activity: [], activity_participant: [], task_blocker: [], meeting_mirror_state: [] };

  const classify = <T extends TableName>(
    table: T,
    rows: Row[],
    keyOf: (r: Row) => string,
    targetRows: Row[],
    expectedOf: (r: Row) => Row,
    extraCollision?: (r: Row, expected: Row) => string | null,
  ) => {
    const byKey = new Map(targetRows.map((r) => [keyOf(r), r]));
    const r = report[table];
    r.found = rows.length;
    for (const s of rows) {
      const expected = expectedOf(s);
      const key = keyOf(expected);
      const existing = byKey.get(key);
      if (!existing) {
        const collision = extraCollision?.(s, expected);
        if (collision) r.mismatched.push({ key, fields: [collision] });
        else {
          r.inserted++;
          insert[table].push(expected);
        }
        continue;
      }
      const fields = diff(expected, existing);
      if (fields.length) r.mismatched.push({ key, fields });
      else r.alreadyPresent++;
    }
  };

  // A meeting is mirrored by at most one activity (UNIQUE meetingId): the same meeting on a
  // DIFFERENT target activity would make the insert fail late, so it is reported here.
  const targetByMeeting = new Map(
    target.activities.filter((a) => a["meetingId"] != null).map((a) => [a["meetingId"] as string, a["id"] as string]),
  );
  classify(
    "activity",
    source.activities,
    (r) => r["id"] as string,
    target.activities,
    expectedActivity,
    (_s, e) => {
      if (e["contactId"] != null && target.erased.has(e["contactId"] as string)) return "contactId(erased contact)";
      const holder = e["meetingId"] == null ? undefined : targetByMeeting.get(e["meetingId"] as string);
      return holder && holder !== e["id"] ? "meetingId(taken by another activity)" : null;
    },
  );
  classify(
    "activity_participant",
    source.participants,
    (r) => `${r["activityId"]}/${r["userId"]}`,
    target.participants,
    (s) => ({ ...s }),
  );
  classify(
    "task_blocker",
    source.blockers,
    (r) => `${r["blockedId"]}/${r["blockerId"]}`,
    target.blockers,
    (s) => ({ ...s }),
  );
  classify(
    "meeting_mirror_state",
    source.states,
    (r) => r["meetingId"] as string,
    target.states,
    (s) => ({ ...s }),
  );

  const sourceIds = new Set(source.activities.map((a) => a["id"]));
  const targetOnlyActivities = target.activities.filter((a) => a["hostApp"] === "crm" && !sourceIds.has(a["id"])).length;
  return { report, targetOnlyActivities, insert };
}

const totalMismatches = (report: Record<TableName, TableReport>) =>
  TABLES.reduce((n, t) => n + report[t].mismatched.length, 0);

const accounted = (report: Record<TableName, TableReport>) =>
  TABLES.every((t) => report[t].mismatched.length === 0 && report[t].found === report[t].inserted + report[t].alreadyPresent);

// ─── Writing ──────────────────────────────────────────────────────────────────

async function writePlan(tx: Tx, p: Plan): Promise<void> {
  // An erased contact must never be linked again (AC-8.4). Same lock key as the erasure and the
  // user routes; the tombstone is read AFTER the lock is held, in its own statement.
  for (const contactId of new Set(p.insert.activity.map((a) => a["contactId"]).filter((v): v is string => typeof v === "string"))) {
    await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`contact:${contactId}`]);
    const erased = (await tx.unsafe(`SELECT 1 FROM "erased_contact" WHERE "contactId" = $1`, [contactId])) as Row[];
    if (erased.length > 0) throw new VerificationFailed("a source activity refers to a contact erased meanwhile; rolled back");
  }
  // Parents first: participants and blockers reference activities (FKs in the target).
  for (const a of p.insert.activity) {
    await tx.unsafe(
      `INSERT INTO "activity" ("id","kind","type","hostApp","hostType","hostId","subject","body","occurredAt",
         "contactId","dealId","authorUserId","dueDate","assigneeUserId","completedAt","completedByUserId",
         "meetingId","createdAt","updatedAt")
       VALUES ($1,$2::"ActivityKind",$3::"ActivityType",$4::"HostApp",$5,$6,$7,$8,$9::timestamp,$10,$11,$12,
         $13::date,$14,$15::timestamp,$16,$17,$18::timestamp,$19::timestamp)
       ON CONFLICT ("id") DO NOTHING`,
      [
        a["id"], a["kind"], a["type"], a["hostApp"], a["hostType"], a["hostId"], a["subject"], a["body"],
        a["occurredAt"], a["contactId"], a["dealId"], a["authorUserId"], a["dueDate"], a["assigneeUserId"],
        a["completedAt"], a["completedByUserId"], a["meetingId"], a["createdAt"], a["updatedAt"],
      ],
    );
  }
  for (const r of p.insert.activity_participant) {
    await tx.unsafe(
      `INSERT INTO "activity_participant" ("activityId","userId","createdBy","createdAt")
       VALUES ($1,$2,$3,$4::timestamp) ON CONFLICT ("activityId","userId") DO NOTHING`,
      [r["activityId"], r["userId"], r["createdBy"], r["createdAt"]],
    );
  }
  for (const r of p.insert.task_blocker) {
    await tx.unsafe(
      `INSERT INTO "task_blocker" ("blockedId","blockerId","createdBy","createdAt")
       VALUES ($1,$2,$3,$4::timestamp) ON CONFLICT ("blockedId","blockerId") DO NOTHING`,
      [r["blockedId"], r["blockerId"], r["createdBy"], r["createdAt"]],
    );
  }
  for (const r of p.insert.meeting_mirror_state) {
    await tx.unsafe(
      `INSERT INTO "meeting_mirror_state" ("meetingId","lastSeq","updatedAt")
       VALUES ($1,$2,$3::timestamp) ON CONFLICT ("meetingId") DO NOTHING`,
      [r["meetingId"], r["lastSeq"], r["updatedAt"]],
    );
  }
}

class VerificationFailed extends Error {}

// ─── Entry points ─────────────────────────────────────────────────────────────

export interface ImportOptions {
  sourceUrl: string;
  targetUrl: string;
  apply: boolean;
}

export async function runImport({ sourceUrl, targetUrl, apply }: ImportOptions): Promise<ImportReport> {
  if (sameDatabase(sourceUrl, targetUrl)) throw new Error("the source and the target are the same database");
  const source = new SQL(sourceUrl);
  const target = new SQL(targetUrl);
  try {
    const snapshot = await readSource(source);
    let result: Plan;

    if (!apply) {
      result = plan(snapshot, await readTarget(target));
    } else {
      // Plan, write and verify in ONE target transaction: a mismatch writes nothing, and a
      // write that does not leave every source row present with equal fields is rolled back.
      result = await target.begin(async (tx) => {
        const p = plan(snapshot, await readTarget(tx));
        if (totalMismatches(p.report) > 0) return p;
        await writePlan(tx, p);
        const after = plan(snapshot, await readTarget(tx));
        if (totalMismatches(after.report) > 0 || !TABLES.every((t) => after.report[t].inserted === 0 && after.report[t].alreadyPresent === after.report[t].found)) {
          throw new VerificationFailed("the target does not hold every source row after the copy; rolled back");
        }
        // Report what THIS run wrote against what it found.
        return { ...p, targetOnlyActivities: after.targetOnlyActivities };
      });
    }

    const mismatched = totalMismatches(result.report) > 0;
    return {
      applied: apply && !mismatched,
      tables: result.report,
      targetOnlyActivities: result.targetOnlyActivities,
      accountedFor: accounted(result.report),
    };
  } finally {
    await Promise.allSettled([source.close(), target.close()]);
  }
}

function sameDatabase(a: string, b: string): boolean {
  const key = (u: string) => {
    const url = new URL(u);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  };
  return key(a) === key(b);
}

export function formatReport(r: ImportReport): string {
  const lines = [r.applied ? "APPLIED" : "DRY RUN (nothing written)"];
  for (const t of TABLES) {
    const x = r.tables[t];
    lines.push(
      `${t.padEnd(22)} found=${x.found} ${r.applied ? "inserted" : "to-insert"}=${x.inserted} already-present=${x.alreadyPresent} mismatched=${x.mismatched.length}`,
    );
    for (const m of x.mismatched) lines.push(`  MISMATCH ${t} ${m.key}: ${m.fields.join(", ")}`);
  }
  if (r.targetOnlyActivities > 0) {
    lines.push(`note: ${r.targetOnlyActivities} CRM-hosted activities in the target are not in the source`);
  }
  lines.push(r.accountedFor ? "ACCOUNTED FOR: every source row is present or will be" : "NOT ACCOUNTED FOR: do not lift the pause, do not run the contract step");
  return lines.join("\n");
}

/** Only `--apply` is a flag: the connection strings are environment, never arguments (they would show in `ps`). */
export function parseArgs(argv: string[], env: Record<string, string | undefined> = process.env): { sourceUrl?: string; targetUrl?: string; apply: boolean } | null {
  let apply = false;
  for (const a of argv) {
    if (a === "--apply") apply = true;
    else return null;
  }
  const sourceUrl = env["CRM_DATABASE_URL"];
  const targetUrl = env["DATABASE_URL"];
  return { ...(sourceUrl ? { sourceUrl } : {}), ...(targetUrl ? { targetUrl } : {}), apply };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (!args || !args.sourceUrl || !args.targetUrl) {
    console.error(
      "usage: CRM_DATABASE_URL=<url> DATABASE_URL=<url> bun scripts/import-crm-activities.ts [--apply]\n" +
        "  The connection strings are environment variables only (never flags: they would show in ps).\n" +
        "  Dry run unless --apply.",
    );
    process.exit(2);
  }
  try {
    const report = await runImport({ sourceUrl: args.sourceUrl, targetUrl: args.targetUrl, apply: args.apply });
    console.log(formatReport(report));
    process.exit(report.accountedFor ? 0 : 1);
  } catch (e) {
    // The message only: a driver error may carry the statement, never a connection string.
    console.error(`import failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
