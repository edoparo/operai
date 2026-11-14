/**
 * Import script (specs/20261110-activities T13, AC-2.1–2.4) against a CRM source and an activities-api test
 * database.
 *
 * The SOURCE is provisioned by this suite (test-support/crmSource.ts): its own database, holding
 * the pre-T14 shape of the four tables the script reads, created before and dropped after. It
 * does not depend on crm-api's schema version (QE D4), so it passes whether `crm_test` is pre- or
 * post-T14 and never touches it.
 *
 * The TARGET is an activities-api test database, migrated (`prisma migrate deploy`) beforehand and
 * TRUNCATEd by this suite, so its name must end in `_test`. The server comes from DATABASE_URL
 * (the preload's `<name>_test`); the name defaults to `activities_test` and can be overridden with
 * IMPORT_TEST_TARGET_DB.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { formatReport, runImport } from "./import-crm-activities";
import { provisionCrmSource, urlForDatabase } from "./test-support/crmSource";

const TARGET_DB = process.env["IMPORT_TEST_TARGET_DB"] ?? "activities_test";
if (!TARGET_DB.endsWith("_test")) throw new Error("the target database must end in _test");

const targetUrl = urlForDatabase(process.env["DATABASE_URL"]!, TARGET_DB);
const source = await provisionCrmSource(targetUrl, "import");
const sourceUrl = source.url;
const crm = source.sql;
const act = new SQL(targetUrl);
// Connect now, with no time limit, not inside the first beforeEach (5 s): that hook was the only
// place a timed hook opened a connection (specs/20261110-activities QE D9).
await act.unsafe(`SELECT 1`);

const SECRET_SUBJECT = "Renewal talk with ACME about the Zurich site";

async function seedCrm() {
  // The script reads only the four activity tables; the company, contact and deal ids on the
  // activities are plain text here (the source has no foreign keys to rows it never reads).
  await source.reset();
  // updatedAt differs from createdAt and carries milliseconds: an import that lets Prisma/now()
  // stamp them would be caught.
  await crm.unsafe(`INSERT INTO "activity"
    ("id","type","subject","body","occurredAt","companyId","contactId","dealId","authorUserId","dueDate","assigneeUserId","completedAt","completedByUserId","meetingId","createdAt","updatedAt") VALUES
    ('a-note','note','${SECRET_SUBJECT}','Body text','2026-03-04 10:11:12.345','co1','ct1','d1','u1',NULL,NULL,NULL,NULL,NULL,'2026-03-04 10:11:13.001','2026-03-05 08:00:00.789'),
    ('a-call','call','Call',NULL,'2026-03-06 09:00:00','co2',NULL,NULL,'u2',NULL,NULL,NULL,NULL,NULL,'2026-03-06 09:00:00','2026-03-06 09:00:00'),
    ('a-task1','task','Open task',NULL,'2026-03-07 12:00:00.5','co1',NULL,'d1','u1','2026-04-01','u2',NULL,NULL,NULL,'2026-03-07 12:00:00.5','2026-03-07 12:00:00.5'),
    ('a-task2','task','Done task','Done','2026-03-08 12:00:00','co1',NULL,NULL,'u1','2026-04-02','u1','2026-03-09 17:30:00.123','u3',NULL,'2026-03-08 12:00:00','2026-03-09 17:30:00.123'),
    ('a-meet','meeting','Kickoff',NULL,'2026-03-10 14:00:00','co1',NULL,NULL,'u1',NULL,NULL,NULL,NULL,'meeting-1','2026-03-10 14:00:00','2026-03-10 14:00:01')`);
  await crm.unsafe(`INSERT INTO "activity_participant" ("activityId","userId","createdBy","createdAt") VALUES
    ('a-note','u2','u1','2026-03-04 10:12:00.250'), ('a-note','u3','u1','2026-03-04 10:12:01'), ('a-task1','u3','u2','2026-03-07 12:01:00')`);
  await crm.unsafe(`INSERT INTO "task_blocker" ("blockedId","blockerId","createdBy","createdAt") VALUES
    ('a-task1','a-task2','u1','2026-03-08 13:00:00.5')`);
  await crm.unsafe(`INSERT INTO "meeting_host_state" ("meetingId","lastSeq","updatedAt") VALUES
    ('meeting-1',4,'2026-03-10 14:05:00.5'), ('meeting-2',1,'2026-03-11 09:00:00')`);
}

async function resetTarget() {
  await act.unsafe(`TRUNCATE "activity", "meeting_mirror_state" CASCADE`);
}

const COUNTS = { activity: 5, activity_participant: 3, task_blocker: 1, meeting_mirror_state: 2 } as const;

async function targetDump() {
  return {
    activity: await act.unsafe(`SELECT "id","kind"::text,"type"::text,"hostApp"::text,"hostType","hostId","subject","body",
      "occurredAt"::text,"contactId","dealId","authorUserId","dueDate"::text,"assigneeUserId","completedAt"::text,
      "completedByUserId","meetingId","createdAt"::text,"updatedAt"::text FROM "activity" ORDER BY "id"`),
    participants: await act.unsafe(`SELECT "activityId","userId","createdBy","createdAt"::text FROM "activity_participant" ORDER BY 1,2`),
    blockers: await act.unsafe(`SELECT "blockedId","blockerId","createdBy","createdAt"::text FROM "task_blocker" ORDER BY 1,2`),
    states: await act.unsafe(`SELECT "meetingId","lastSeq","updatedAt"::text FROM "meeting_mirror_state" ORDER BY 1`),
  };
}

async function count(table: string): Promise<number> {
  const r = await act.unsafe(`SELECT count(*)::int AS n FROM "${table}"`);
  return r[0].n;
}

beforeEach(async () => {
  await seedCrm();
  await resetTarget();
});

afterAll(async () => {
  await Promise.allSettled([act.close()]);
  await source.dispose();
});

describe("dry run (default)", () => {
  test("reports what it would copy and writes nothing", async () => {
    const report = await runImport({ sourceUrl, targetUrl, apply: false });
    expect(report.applied).toBe(false);
    for (const [table, n] of Object.entries(COUNTS)) {
      const t = report.tables[table as keyof typeof COUNTS];
      expect(t).toMatchObject({ found: n, inserted: n, alreadyPresent: 0, mismatched: [] });
    }
    expect(report.accountedFor).toBe(true);
    for (const table of ["activity", "activity_participant", "task_blocker", "meeting_mirror_state"]) {
      expect(await count(table)).toBe(0);
    }
  });
});

describe("--apply", () => {
  test("copies every activity, participant, blocker and meeting state with equal fields and the same ids and timestamps", async () => {
    const report = await runImport({ sourceUrl, targetUrl, apply: true });
    expect(report.applied).toBe(true);
    expect(report.accountedFor).toBe(true);
    for (const [table, n] of Object.entries(COUNTS)) {
      expect(report.tables[table as keyof typeof COUNTS]).toMatchObject({ found: n, inserted: n, alreadyPresent: 0 });
    }

    // Independent check: read both sides with our own SQL, not through the script's comparison.
    const src = await crm.unsafe(`SELECT "id","type"::text AS "type","companyId","subject","body","occurredAt"::text AS "occurredAt",
      "contactId","dealId","authorUserId","dueDate"::text AS "dueDate","assigneeUserId","completedAt"::text AS "completedAt",
      "completedByUserId","meetingId","createdAt"::text AS "createdAt","updatedAt"::text AS "updatedAt" FROM "activity" ORDER BY "id"`);
    const dump = await targetDump();
    expect(dump.activity.length).toBe(src.length);
    src.forEach((s: Record<string, unknown>, i: number) => {
      const t = dump.activity[i];
      expect(t).toMatchObject({
        id: s["id"], type: s["type"], hostId: s["companyId"], subject: s["subject"], body: s["body"],
        occurredAt: s["occurredAt"], contactId: s["contactId"], dealId: s["dealId"], authorUserId: s["authorUserId"],
        dueDate: s["dueDate"], assigneeUserId: s["assigneeUserId"], completedAt: s["completedAt"],
        completedByUserId: s["completedByUserId"], meetingId: s["meetingId"], createdAt: s["createdAt"],
        updatedAt: s["updatedAt"], kind: "pre_sales", hostApp: "crm", hostType: "company",
      });
    });
    // The timestamp that would be reset by an ORM write, and the sub-second part.
    expect(dump.activity.find((a: Record<string, unknown>) => a["id"] === "a-note")).toMatchObject({
      updatedAt: "2026-03-05 08:00:00.789",
      createdAt: "2026-03-04 10:11:13.001",
    });
    expect(dump.participants).toEqual(
      await crm.unsafe(`SELECT "activityId","userId","createdBy","createdAt"::text FROM "activity_participant" ORDER BY 1,2`),
    );
    expect(dump.blockers).toEqual(
      await crm.unsafe(`SELECT "blockedId","blockerId","createdBy","createdAt"::text FROM "task_blocker" ORDER BY 1,2`),
    );
    expect(dump.states).toEqual(
      await crm.unsafe(`SELECT "meetingId","lastSeq","updatedAt"::text FROM "meeting_host_state" ORDER BY 1`),
    );
  });

  test("a second apply inserts 0 and changes nothing", async () => {
    await runImport({ sourceUrl, targetUrl, apply: true });
    const before = await targetDump();
    const again = await runImport({ sourceUrl, targetUrl, apply: true });
    for (const [table, n] of Object.entries(COUNTS)) {
      expect(again.tables[table as keyof typeof COUNTS]).toMatchObject({ found: n, inserted: 0, alreadyPresent: n, mismatched: [] });
    }
    expect(again.accountedFor).toBe(true);
    expect(await targetDump()).toEqual(before);
  });

  test("a CRM source left untouched", async () => {
    const before = await crm.unsafe(`SELECT count(*)::int AS n FROM "activity"`);
    await runImport({ sourceUrl, targetUrl, apply: true });
    expect(await crm.unsafe(`SELECT count(*)::int AS n FROM "activity"`)).toEqual(before);
  });
});

describe("a pre-existing target row that differs", () => {
  async function plantDifferentRow() {
    await act.unsafe(`INSERT INTO "activity" ("id","kind","type","hostApp","hostType","hostId","subject","occurredAt","authorUserId","createdAt","updatedAt")
      VALUES ('a-note','pre_sales','note','crm','company','co1','A DIFFERENT SUBJECT','2026-03-04 10:11:12.345','u1','2026-03-04 10:11:13.001','2026-03-05 08:00:00.789')`);
  }

  test("is reported by id and field, writes NOTHING (not even the rows that were fine), and is not accounted for", async () => {
    await plantDifferentRow();
    for (const apply of [false, true]) {
      const report = await runImport({ sourceUrl, targetUrl, apply });
      expect(report.accountedFor).toBe(false);
      expect(report.applied).toBe(false);
      expect(report.tables.activity.mismatched).toEqual([{ key: "a-note", fields: ["subject", "body", "contactId", "dealId"] }]);
      expect(await count("activity")).toBe(1);
      expect(await count("activity_participant")).toBe(0);
      expect(await count("task_blocker")).toBe(0);
      expect(await count("meeting_mirror_state")).toBe(0);
      const text = formatReport(report);
      expect(text).toContain("MISMATCH activity a-note");
      expect(text).toContain("NOT ACCOUNTED FOR");
      // Free text about clients never reaches the report.
      expect(text).not.toContain("DIFFERENT SUBJECT");
      expect(text).not.toContain(SECRET_SUBJECT);
    }
  });

  test("a participant or meeting state that differs is also a mismatch", async () => {
    await runImport({ sourceUrl, targetUrl, apply: true });
    await act.unsafe(`UPDATE "meeting_mirror_state" SET "lastSeq" = 9 WHERE "meetingId" = 'meeting-1'`);
    await act.unsafe(`UPDATE "activity_participant" SET "createdBy" = 'someone-else' WHERE "activityId" = 'a-note' AND "userId" = 'u2'`);
    const report = await runImport({ sourceUrl, targetUrl, apply: true });
    expect(report.accountedFor).toBe(false);
    expect(report.tables.meeting_mirror_state.mismatched).toEqual([{ key: "meeting-1", fields: ["lastSeq"] }]);
    expect(report.tables.activity_participant.mismatched).toEqual([{ key: "a-note/u2", fields: ["createdBy"] }]);
  });

  test("a meeting already mirrored by a different activity is reported, not left to fail the insert", async () => {
    await act.unsafe(`INSERT INTO "activity" ("id","kind","type","hostApp","hostType","hostId","subject","occurredAt","authorUserId","meetingId","createdAt","updatedAt")
      VALUES ('other','pre_sales','meeting','crm','company','co1','x','2026-03-10 14:00:00','u1','meeting-1','2026-03-10 14:00:00','2026-03-10 14:00:00')`);
    const report = await runImport({ sourceUrl, targetUrl, apply: true });
    expect(report.accountedFor).toBe(false);
    expect(report.tables.activity.mismatched).toEqual([{ key: "a-meet", fields: ["meetingId(taken by another activity)"] }]);
    expect(await count("activity")).toBe(1);
  });
});

describe("an erased contact (AC-8.4)", () => {
  beforeEach(async () => {
    await act.unsafe(`TRUNCATE "erased_contact"`);
  });
  afterAll(async () => {
    await act.unsafe(`TRUNCATE "erased_contact"`);
  });

  test("a source activity that would be inserted with a tombstoned contact is a mismatch: nothing is written, not accounted for", async () => {
    await act.unsafe(`INSERT INTO "erased_contact" ("contactId") VALUES ('ct1')`);
    const report = await runImport({ sourceUrl, targetUrl, apply: true });
    expect(report.applied).toBe(false);
    expect(report.accountedFor).toBe(false);
    expect(report.tables.activity.mismatched).toEqual([{ key: "a-note", fields: ["contactId(erased contact)"] }]);
    expect(await count("activity")).toBe(0);
    expect(await count("task_blocker")).toBe(0);
  });

  test("the command line exits 1 and names the id and field, not a value", async () => {
    await act.unsafe(`INSERT INTO "erased_contact" ("contactId") VALUES ('ct1')`);
    const p = Bun.spawn(["bun", `${import.meta.dir}/import-crm-activities.ts`, "--apply"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env["PATH"]!, HOME: process.env["HOME"] ?? "", CRM_DATABASE_URL: sourceUrl, DATABASE_URL: targetUrl },
    });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(code).toBe(1);
    expect(out).toContain("MISMATCH activity a-note: contactId(erased contact)");
    expect(out).not.toContain(SECRET_SUBJECT);
    expect(await count("activity")).toBe(0);
  });

  test("a tombstone that lands between the plan and the write (read after the lock) rolls the whole copy back", async () => {
    // Hold the contact's lock, start the apply (it plans, then waits for the lock), tombstone, release.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const hasLock = new Promise<void>((resolve) => (locked = resolve));
    const holder = act.begin(async (tx) => {
      await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtextextended('contact:ct1', 0))`);
      locked();
      await held;
      await tx.unsafe(`INSERT INTO "erased_contact" ("contactId") VALUES ('ct1')`);
    });
    await hasLock;
    const apply = runImport({ sourceUrl, targetUrl, apply: true });
    const outcome = apply.then(() => "resolved", (e: Error) => e.message);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await holder;
    expect(await outcome).toMatch(/erased meanwhile/);
    expect(await count("activity")).toBe(0);
  });
});

describe("failure handling", () => {
  test("a write that fails part way leaves the target as it was (one transaction)", async () => {
    await act.unsafe(`CREATE OR REPLACE FUNCTION t13_refuse() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 't13 refuses'; END $$`);
    await act.unsafe(`CREATE TRIGGER t13_refuse BEFORE INSERT ON "meeting_mirror_state" FOR EACH ROW EXECUTE FUNCTION t13_refuse()`);
    try {
      await expect(runImport({ sourceUrl, targetUrl, apply: true })).rejects.toThrow();
      expect(await count("activity")).toBe(0);
      expect(await count("activity_participant")).toBe(0);
    } finally {
      await act.unsafe(`DROP TRIGGER t13_refuse ON "meeting_mirror_state"`);
      await act.unsafe(`DROP FUNCTION t13_refuse()`);
    }
  });

  test("refuses a source and target that are the same database", async () => {
    await expect(runImport({ sourceUrl: targetUrl, targetUrl, apply: true })).rejects.toThrow(/same database/);
  });
});

describe("command line", () => {
  // The connection strings are ENVIRONMENT only (OWASP review L4): never an argument, so never in `ps`.
  const urls = { CRM_DATABASE_URL: sourceUrl, DATABASE_URL: targetUrl };
  async function cli(args: string[] = [], env: Record<string, string> = urls) {
    const p = Bun.spawn(["bun", `${import.meta.dir}/import-crm-activities.ts`, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env["PATH"]!, HOME: process.env["HOME"] ?? "", ...env },
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, code };
  }

  test("dry run exits 0 without writing; --apply exits 0 and a mismatch exits 1; usage errors exit 2", async () => {
    const dry = await cli();
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("DRY RUN");
    expect(await count("activity")).toBe(0);

    const applied = await cli(["--apply"]);
    expect(applied.code).toBe(0);
    expect(applied.out).toContain("APPLIED");
    expect(await count("activity")).toBe(COUNTS.activity);
    expect(applied.out).not.toContain(SECRET_SUBJECT);
    expect(applied.out + applied.err).not.toContain(new URL(sourceUrl).password || "\u0000");

    await act.unsafe(`UPDATE "activity" SET "subject" = 'edited' WHERE "id" = 'a-call'`);
    const bad = await cli(["--apply"]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("MISMATCH activity a-call: subject");

    expect((await cli(["--bogus"])).code).toBe(2);
    expect((await cli([], {})).code).toBe(2); // no environment, no run
  });

  test("a connection string given as a flag is refused (usage, exit 2) and never reaches a database", async () => {
    for (const flags of [["--crm-database-url", sourceUrl], ["--database-url", targetUrl]]) {
      const refused = await cli(flags, urls);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("usage");
      expect(refused.out + refused.err).not.toContain(new URL(targetUrl).password || "\u0000");
    }
    expect(await count("activity")).toBe(0);
  });

  test("the usage text names the environment variables and no URL flag", async () => {
    const usage = await cli(["--bogus"]);
    expect(usage.err).toContain("CRM_DATABASE_URL");
    expect(usage.err).not.toContain("--crm-database-url");
  });
});
