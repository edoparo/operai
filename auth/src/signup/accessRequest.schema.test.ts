/**
 * specs/023 T1: the `access_request` table's closed value sets are enforced by
 * the database (CHECK constraints in the migration), not only by app code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { db } from "../lib/db";

const EMAIL = "schema-check@welld.test";

afterEach(async () => {
  await db.accessRequest.deleteMany({ where: { email: EMAIL } });
});

describe("access_request CHECK constraints", () => {
  test("accepts a valid row with defaults", async () => {
    const row = await db.accessRequest.create({
      data: { email: EMAIL, name: "A", provider: "google" },
    });
    expect(row.status).toBe("pending");
  });

  test("rejects an unknown status", async () => {
    await expect(
      (async () => db.$executeRawUnsafe(
        `INSERT INTO access_request (id,email,name,provider,status,"updatedAt") VALUES ('x1','${EMAIL}','A','google','other',now())`,
      ))(),
    ).rejects.toThrow(/access_request_status_check/);
  });

  test("rejects an unknown provider", async () => {
    await expect(
      (async () => db.$executeRawUnsafe(
        `INSERT INTO access_request (id,email,name,provider,status,"updatedAt") VALUES ('x2','${EMAIL}','A','facebook','pending',now())`,
      ))(),
    ).rejects.toThrow(/access_request_provider_check/);
  });

  test("email is unique", async () => {
    await db.accessRequest.create({ data: { email: EMAIL, name: "A", provider: "github" } });
    await expect(
      (async () => db.accessRequest.create({ data: { email: EMAIL, name: "B", provider: "github" } }))(),
    ).rejects.toThrow();
  });
});
