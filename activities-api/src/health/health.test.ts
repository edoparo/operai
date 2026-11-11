import { describe, expect, it, spyOn } from "bun:test";
import { call, withMaintenance } from "../test-support/world";
import { probes } from "./health.routes";

describe("GET /health", () => {
  it("answers 200 with a reachable database, without a token", async () => {
    const res = await call("GET", "/health", { as: null });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ status: "ok", service: "activities-api", maintenance: false, db: { status: "ok" } });
    expect(typeof res.json.version).toBe("string");
    expect(Number.isNaN(Date.parse(res.json.timestamp))).toBe(false);
  });

  it("answers 503 `degraded` when the database cannot be reached", async () => {
    const probe = spyOn(probes, "db").mockRejectedValue(new Error("connection refused"));
    try {
      const res = await call("GET", "/health", { as: null });
      expect(res.status).toBe(503);
      expect(res.json).toMatchObject({ status: "degraded", service: "activities-api", db: { status: "error" } });
    } finally {
      probe.mockRestore();
    }
  });

  it("still answers 200 in maintenance, and says so (AC-2.5)", async () => {
    await withMaintenance(async () => {
      const res = await call("GET", "/health", { as: null });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ status: "ok", maintenance: true });
    });
  });
});
