/**
 * The source helper's own contract (specs/20261110-activities QE D9): the databases a test hook writes to do not
 * wait for the disk at commit, and the helper only ever creates, changes and drops `*_test` and
 * `import_src_*` databases.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { provisionCrmSource, urlForDatabase, type CrmSource } from "./crmSource";

const targetUrl = urlForDatabase(process.env["DATABASE_URL"]!, "activities_test");
let source: CrmSource | undefined;
afterAll(async () => {
  await source?.dispose();
});

async function setting(url: string): Promise<string> {
  const s = new SQL(url);
  try {
    return ((await s.unsafe(`SHOW synchronous_commit`)) as { synchronous_commit: string }[])[0]!.synchronous_commit;
  } finally {
    await s.close();
  }
}

describe("provisionCrmSource", () => {
  test("a new session on the source and on the target database does not wait for the WAL flush at commit", async () => {
    source = await provisionCrmSource(targetUrl, "helper");
    expect(await setting(source.url)).toBe("off");
    expect(await setting(targetUrl)).toBe("off");
  });

  test("refuses a target that is not a *_test database and a tag that is not lower-case letters and digits", async () => {
    await expect(provisionCrmSource(urlForDatabase(targetUrl, "activities"), "helper")).rejects.toThrow("*_test");
    await expect(provisionCrmSource(targetUrl, "Bad-Tag")).rejects.toThrow("lower-case");
  });
});
