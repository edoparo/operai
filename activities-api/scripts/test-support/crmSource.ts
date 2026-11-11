/**
 * The CRM database as the import script reads it, provisioned by the test itself (specs/028 QE D4).
 *
 * The import script reads four tables of crm-api: `activity`, `activity_participant`,
 * `task_blocker` and `meeting_host_state`. T14 drops them from crm-api's schema, so a test that
 * read `crm_test` passed only while that database still had the pre-T14 schema, and nothing
 * enforced it. This helper gives the tests a source of their own: a separate database that exists
 * for the length of a test file, holding exactly the pre-T14 shape of those four tables (copied
 * from crm-api's schema before migration 20261111120000_drop_activity_tables) and nothing else.
 * The suite therefore passes whether `crm_test` is pre- or post-T14.
 *
 * The database is named `import_src_<tag>_<target database>` (the target ends in `_test`, so does this),
 * created on the same server as DATABASE_URL and dropped afterwards. It is never an existing
 * database of another service: only a database with this prefix is ever created, emptied or dropped.
 */
import { SQL } from "bun";

const PREFIX = "import_src_";

export interface CrmSource {
  /** Connection string of the source database. */
  url: string;
  /** For the test's own seeding and independent checks. */
  sql: SQL;
  /** Empties the four tables. */
  reset(): Promise<void>;
  /** Closes the connection and drops the database. */
  dispose(): Promise<void>;
}

/** Same server and credentials as `base`, another database. */
export function urlForDatabase(base: string, name: string): string {
  const u = new URL(base);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Test databases do not wait for the WAL flush at commit (specs/028 QE D9). The first hook of a
 * run (seed plus TRUNCATE ... CASCADE, a dozen commits) once took more than its 5 s limit on a
 * shared Postgres whose own log shows checkpoints syncing for 5 s; every commit of a test hook is
 * a wait on the same disk as that checkpoint. The tests assert on data, never on durability.
 * Only ever applied to a `*_test` database and to the `import_src_*` ones this helper creates.
 */
const QUIET_COMMITS = (database: string) => `ALTER DATABASE "${database}" SET synchronous_commit = off`;

/** The pre-T14 crm-api tables, columns, types, keys and foreign keys the script depends on. */
const PRE_T14_SCHEMA = [
  `DROP TABLE IF EXISTS "task_blocker", "activity_participant", "activity", "meeting_host_state" CASCADE`,
  `DROP TYPE IF EXISTS "ActivityType"`,
  `CREATE TYPE "ActivityType" AS ENUM ('note', 'call', 'meeting', 'email', 'task')`,
  `CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "dueDate" DATE,
    "assigneeUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX "activity_meetingId_key" ON "activity"("meetingId")`,
  `CREATE TABLE "activity_participant" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_participant_pkey" PRIMARY KEY ("activityId", "userId"),
    CONSTRAINT "activity_participant_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE "task_blocker" (
    "blockedId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_blocker_pkey" PRIMARY KEY ("blockedId", "blockerId"),
    CONSTRAINT "task_blocker_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_blocker_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE "meeting_host_state" (
    "meetingId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "meeting_host_state_pkey" PRIMARY KEY ("meetingId")
  )`,
];

/**
 * Creates (or recreates) the source database next to `targetUrl`'s database and returns it ready
 * to seed. `targetUrl` must name a database ending in `_test`; `tag` keeps two test files that
 * provision a source from sharing (and dropping) one.
 */
export async function provisionCrmSource(targetUrl: string, tag: string): Promise<CrmSource> {
  if (!/^[a-z0-9]+$/.test(tag)) throw new Error("the tag is lower-case letters and digits");
  const targetName = new URL(targetUrl).pathname.replace(/^\//, "");
  if (!targetName.endsWith("_test")) throw new Error("the import tests run only against a *_test target database");
  const name = `${PREFIX}${tag}_${targetName}`;
  if (name.length > 63) throw new Error(`database name too long: ${name}`);

  const admin = new SQL(urlForDatabase(targetUrl, "postgres"));
  try {
    const exists = (await admin.unsafe(`SELECT 1 FROM pg_database WHERE datname = $1`, [name])) as unknown[];
    // A leftover of a crashed run is dropped, not trusted: the schema below is rebuilt either way.
    if (exists.length > 0) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    // Both are disposable test databases: nothing they hold needs to survive a crash, so a commit
    // must not wait for the disk (see QUIET_COMMITS). ALTER DATABASE ... SET applies to sessions
    // opened afterwards, which is every connection of this process: the tests have none yet.
    for (const db of [name, targetName]) await admin.unsafe(QUIET_COMMITS(db));
  } finally {
    await admin.close();
  }

  const url = urlForDatabase(targetUrl, name);
  const sql = new SQL(url);
  for (const statement of PRE_T14_SCHEMA) await sql.unsafe(statement);

  return {
    url,
    sql,
    reset: async () => {
      await sql.unsafe(`TRUNCATE "activity", "activity_participant", "task_blocker", "meeting_host_state" CASCADE`);
    },
    dispose: async () => {
      await Promise.allSettled([sql.close()]);
      const drop = new SQL(urlForDatabase(targetUrl, "postgres"));
      try {
        await drop.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await drop.close();
      }
    },
  };
}
