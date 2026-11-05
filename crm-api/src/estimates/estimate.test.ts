import { beforeEach, describe, expect, it } from "bun:test";
import { appAccess, call, db, estimai, estimaiNotice, makeCompany, makeDeal, resetWorld, signServiceToken, app } from "../test-support/world";
import { addWorkingDays } from "./workingDays";

/** specs/018 US-3: estimate requests, the ready/reopen/override lifecycle and the gate. */
describe("technical estimates (specs/018 US-3)", () => {
  beforeEach(resetWorld);

  const qualifiedDeal = async () => {
    const company = await makeCompany({ name: "Acme SA" });
    return makeDeal(company.id, { stage: "qualified", title: "Grid analytics" }, "salesCh");
  };
  const request = (dealId: string, technicalUserId = "user-tech", as: "salesCh" | "admin" | "consultant" = "salesCh") =>
    call("POST", `/deals/${dealId}/estimate`, { as, body: { technicalUserId } });

  it("creates the estimate in EstimAI, shares it with the technician, links it and tasks them", async () => {
    const deal = await qualifiedDeal();
    const res = await request(deal.id);
    expect(res.status).toBe(201);
    expect(res.json.estimate).toMatchObject({ name: "Acme SA — Grid analytics", state: "requested", technical: { id: "user-tech" } });
    expect(res.json.estimateState).toBe("requested");

    const [created] = [...estimai.estimates.values()];
    expect(created).toMatchObject({ owner: "user-sales-ch", editors: ["user-tech@welld.test"] });
    expect(res.json.estimate.estimateId).toBe(created!.id);

    const tasks = await call("GET", "/tasks", { as: "tech" });
    expect(tasks.json.items).toHaveLength(1);
    expect(tasks.json.items[0]).toMatchObject({ subject: "Estimate: Grid analytics", deal: { id: deal.id } });
    expect(tasks.json.items[0].task.dueDate).not.toBeNull();
  });

  it("refuses a technician who is not a CRM user, or cannot use EstimAI, and leaves nothing behind", async () => {
    const deal = await qualifiedDeal();
    expect((await request(deal.id, "user-outsider")).json).toMatchObject({ code: "owner_not_crm_user", field: "technicalUserId" });
    // user-colleague can open the CRM but not EstimAI.
    expect((await request(deal.id, "user-colleague")).json).toMatchObject({ code: "technician_not_estimai_user" });
    expect(estimai.estimates.size).toBe(0);

    // EstimAI refusing the grant: the half-made estimate is deleted again.
    estimai.shareStatus = 422;
    expect((await request(deal.id)).json.code).toBe("technician_not_estimai_user");
    expect(estimai.estimates.size).toBe(0);
    expect(estimai.deletes).toHaveLength(1);
    expect(await db.dealEstimate.count()).toBe(0);
  });

  it("a requester without EstimAI gets 403 estimai_access_required; EstimAI down is a 503", async () => {
    const deal = await qualifiedDeal();
    estimai.forbidden.add("user-sales-ch");
    expect((await request(deal.id)).json).toMatchObject({ status: 403, code: "estimai_access_required" });
    estimai.forbidden.clear();
    estimai.down = true;
    expect((await request(deal.id)).json).toMatchObject({ status: 503, code: "estimai_unavailable" });
  });

  it("only a lead or qualified deal without an estimate can request one; scope applies", async () => {
    const deal = await qualifiedDeal();
    await request(deal.id);
    expect((await request(deal.id)).json.code).toBe("estimate_exists");
    const itCompany = await makeCompany({ entity: "welld_it" });
    const itDeal = await makeDeal(itCompany.id);
    expect((await request(itDeal.id)).json.code).toBe("out_of_scope");
    expect((await request(deal.id, "user-tech", "consultant")).status).toBe(403);
  });

  it("gates proposal on a ready estimate; it is ready once closed in EstimAI (AC-3.3)", async () => {
    const deal = await qualifiedDeal();
    const move = (stage: string, ifMatch: number) =>
      call("POST", `/deals/${deal.id}/stage`, { as: "salesCh", ifMatch, body: { stage } });

    const noEstimate = await move("proposal", 1);
    expect(noEstimate.json).toMatchObject({ status: 409, code: "estimate_not_ready", estimateState: null });

    await request(deal.id);
    expect((await move("proposal", 1)).json).toMatchObject({ code: "estimate_not_ready", estimateState: "requested" });
    // Lost is never gated, and lost → won cannot step around the gate.
    expect((await move("lost", 1)).status).toBe(200);
    expect((await move("won", 2)).json.code).toBe("estimate_not_ready");
    expect((await move("qualified", 2)).status).toBe(200);

    // The CRM no longer marks it ready itself.
    expect((await call("POST", `/deals/${deal.id}/estimate/ready`, { as: "admin" })).status).toBe(404);
    expect((await estimaiNotice(deal.id)).status).toBe(204);
    const ready = await call("GET", `/deals/${deal.id}`, { as: "salesCh" });
    expect(ready.json.estimate).toMatchObject({ state: "ready" });
    expect(ready.json.estimate.readyAt).not.toBeNull();
    // The request task is done.
    expect((await call("GET", "/tasks?status=done", { as: "tech" })).json.total).toBe(1);

    expect((await move("proposal", 3)).json).toMatchObject({ stage: "proposal" });
    // Past qualified, the gate no longer applies, even if the estimate is reopened.
    await estimaiNotice(deal.id, "reopened", { by: "user-sales-ch" });
    expect((await call("GET", `/deals/${deal.id}`, { as: "salesCh" })).json.estimate.state).toBe("requested");
    expect((await call("GET", "/tasks", { as: "tech" })).json.total).toBe(1);
    expect((await move("negotiation", 4)).status).toBe(200);
  });

  it("unlinking removes the request task while it is open, and keeps a completed one", async () => {
    const deal = await qualifiedDeal();
    await request(deal.id);
    expect((await call("DELETE", `/deals/${deal.id}/estimate`, { as: "salesCh" })).status).toBe(200);
    expect((await call("GET", "/tasks", { as: "tech" })).json.total).toBe(0);
    expect(await db.activity.count({ where: { dealId: deal.id, type: "task" } })).toBe(0);

    await request(deal.id);
    await estimaiNotice(deal.id);
    expect((await call("DELETE", `/deals/${deal.id}/estimate`, { as: "salesCh" })).status).toBe(200);
    expect((await call("GET", "/tasks?status=done", { as: "tech" })).json.total).toBe(1);
  });

  it("a late notice cannot undo a newer one, and an unknown estimate is a quiet 204", async () => {
    const deal = await qualifiedDeal();
    await request(deal.id);
    await estimaiNotice(deal.id, "closed", { version: 4 });
    // The reopen of version 3 arrives after the close of version 4: ignored.
    await estimaiNotice(deal.id, "reopened", { version: 3 });
    expect((await call("GET", `/deals/${deal.id}`)).json.estimate.state).toBe("ready");
    expect((await call("GET", "/tasks?status=done", { as: "tech" })).json.total).toBe(1);
    await estimaiNotice(deal.id, "reopened", { version: 5 });
    expect((await call("GET", `/deals/${deal.id}`)).json.estimate.state).toBe("requested");
    expect((await call("GET", "/tasks", { as: "tech" })).json.total).toBe(1);

    const token = await signServiceToken({ sub: "system:estimai-api", scope: "estimate-notices.send" });
    const unknown = await app.request("/system/estimate-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ estimateId: "est-nobody", event: "closed", version: 2, at: new Date().toISOString(), byUserId: "user-tech" }),
    });
    expect(unknown.status).toBe(204);
  });

  it("takes only estimai-api's service credential with the notices scope", async () => {
    const deal = await qualifiedDeal();
    await request(deal.id);
    expect((await estimaiNotice(deal.id, "closed", { sub: "system:crm-api" })).status).toBe(401);
    expect((await estimaiNotice(deal.id, "closed", { scope: "notifications.push" })).status).toBe(401);
    const userToken = await call("POST", "/system/estimate-notices", { as: "tech", body: {} });
    expect(userToken.status).toBe(401);
    const otherAudience = await signServiceToken({ sub: "system:estimai-api", scope: "estimate-notices.send", audience: "operai-suite" });
    const res = await app.request("/system/estimate-notices", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${otherAudience}` },
      body: JSON.stringify({ estimateId: "x", event: "closed", version: 2, at: new Date().toISOString(), byUserId: "user-tech" }),
    });
    expect(res.status).toBe(401);
    expect((await call("GET", `/deals/${deal.id}`)).json.estimate.state).toBe("requested");
  });

  it("an admin overrides the gate with a reason, kept on the timeline and across an unlink", async () => {
    const deal = await qualifiedDeal();
    const override = (as: "salesCh" | "admin") =>
      call("POST", `/deals/${deal.id}/estimate/override`, { as, body: { reason: "Framework contract" } });
    expect((await override("salesCh")).json.code).toBe("admin_only");
    const res = await override("admin");
    expect(res.json.estimate).toBeNull();
    expect(res.json.estimateOverride).toMatchObject({ reason: "Framework contract", by: { id: "user-admin" } });
    expect(res.json.estimateOverridden).toBe(true);

    const timeline = await call("GET", `/activities?dealId=${deal.id}`);
    expect(timeline.json.items[0]).toMatchObject({ type: "note", subject: "Estimate gate overridden", body: "Framework contract" });

    // A request still works on an overridden deal; unlinking keeps the override.
    expect((await request(deal.id)).status).toBe(201);
    const unlinked = await call("DELETE", `/deals/${deal.id}/estimate`, { as: "salesCh" });
    expect(unlinked.json.estimate).toBeNull();
    expect(unlinked.json.estimateOverridden).toBe(true);
    expect((await call("POST", `/deals/${deal.id}/stage`, { as: "salesCh", ifMatch: 1, body: { stage: "proposal" } })).status).toBe(200);
  });

  it("the technician must still be a CRM user when the request is made", async () => {
    appAccess.crm.delete("user-tech");
    const deal = await qualifiedDeal();
    expect((await request(deal.id)).json.code).toBe("owner_not_crm_user");
  });

  it("counts working days for the task's due date", () => {
    // Friday 2026-11-06 + 5 working days = Friday 2026-11-13.
    expect(addWorkingDays(new Date(Date.UTC(2026, 10, 6, 15)), 5).toISOString().slice(0, 10)).toBe("2026-11-13");
    // Saturday + 1 = Monday.
    expect(addWorkingDays(new Date(Date.UTC(2026, 10, 7)), 1).toISOString().slice(0, 10)).toBe("2026-11-09");
  });
});
