import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { call, estimaiNotice, forgetIdentities, identities, makeCompany, makeDeal, markEstimateReady, resetWorld, estimai, offerBody } from "./test-support/world";
import { recipientsOf, setNotifierForTests, type NotifyEvent } from "./lib/notify";

/** specs/019 T7: the events crm-api sends, hooked after the commit, through an injected recording notifier. */
describe("CRM notifications (specs/019, E1–E9)", () => {
  let events: (NotifyEvent & { to: string[] })[];
  const AMOUNT_CENTS = 8_500_050;

  beforeEach(async () => {
    await resetWorld();
    events = [];
    setNotifierForTests({
      async notify(event) {
        events.push({ ...event, to: recipientsOf(event) });
      },
    });
  });
  afterEach(() => setNotifierForTests(null));

  const deal = async (overrides: Record<string, unknown> = {}, as: "salesCh" | "admin" = "salesCh", companyName = `Acme SA ${crypto.randomUUID().slice(0, 4)}`) => {
    const company = await makeCompany({ name: companyName });
    const made = await makeDeal(company.id, { stage: "qualified", title: "Grid analytics", amountCents: AMOUNT_CENTS, ...overrides }, as);
    events.length = 0; // creation is E4's business; clear it
    return made;
  };
  const request = (dealId: string, as: "salesCh" | "admin" = "salesCh") =>
    call("POST", `/deals/${dealId}/estimate`, { as, body: { technicalUserId: "user-tech" } });
  const noMoney = () => {
    for (const e of events) {
      for (const digits of ["8500050", "85000", "850005"]) {
        expect(e.title).not.toContain(digits);
        expect(e.body).not.toContain(digits);
      }
    }
  };

  it("E1 estimate requested: the technical contact, by email, linking to the deal", async () => {
    const d = await deal();
    expect((await request(d.id)).status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "estimate_requested",
      to: ["user-tech"],
      email: true,
      severity: "info",
      href: `/crm/deals/${d.id}`,
      title: "Estimate requested: Grid analytics",
    });
    expect(events[0]!.body).toMatch(/^Name of user-sales-ch asked you to estimate Grid analytics for Acme SA [0-9a-f]{4}\. Due \d\d\.\d\d\.\d{4}\.$/);
    noMoney();
  });

  it("E2 estimate ready: requester and owner (once), by email; not again when already ready", async () => {
    const d = await deal();
    await request(d.id);
    events.length = 0;
    await estimaiNotice(d.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "estimate_ready", to: ["user-sales-ch"], email: true, severity: "success", href: `/crm/deals/${d.id}` });
    expect(events[0]!.body).toContain("The estimate for Grid analytics was closed in EstimAI");
    await estimaiNotice(d.id);
    expect(events).toHaveLength(1);
    noMoney();
  });

  it("E2 tells the owner and the requester separately when they differ", async () => {
    const d = await deal({ ownerUserId: "user-colleague" }, "admin");
    await request(d.id, "admin");
    events.length = 0;
    await estimaiNotice(d.id);
    expect(events[0]!.to.sort()).toEqual(["user-admin", "user-colleague"]);
  });

  it("E3 estimate reopened in EstimAI: the technical contact and the requester, by email, as a warning; never whoever reopened it", async () => {
    const d = await deal();
    await request(d.id);
    await estimaiNotice(d.id);
    events.length = 0;
    await estimaiNotice(d.id, "reopened", { by: "user-sales-ch" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "estimate_reopened", to: ["user-tech"], email: true, severity: "warning", href: `/crm/deals/${d.id}` });
    await estimaiNotice(d.id);
    events.length = 0;
    await estimaiNotice(d.id, "reopened", { by: "user-tech" });
    expect(events[0]!.to).toEqual(["user-sales-ch"]);
  });

  it("E4 new owner: on create and on an owner change, by email; never for yourself or an unchanged owner", async () => {
    const company = await makeCompany();
    const created = await makeDeal(company.id, { ownerUserId: "user-colleague", title: "Gift" }, "salesCh");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "deal_owner",
      to: ["user-colleague"],
      email: true,
      severity: "info",
      href: `/crm/deals/${created.id}`,
      title: "You own a deal: Gift",
    });
    expect(events[0]!.body).toBe(`Name of user-sales-ch made you the owner of Gift (${company.name}).`);

    events.length = 0;
    await makeDeal(company.id, {}, "salesCh"); // owner = actor
    expect(events.every((e) => e.to.length === 0)).toBe(true);

    events.length = 0;
    const patch = (body: Record<string, unknown>, version: number) =>
      call("PATCH", `/deals/${created.id}`, { as: "salesCh", ifMatch: version, body });
    const same = await patch({ ownerUserId: "user-colleague", title: "Gift 2" }, created.version);
    expect(events.every((e) => e.to.length === 0)).toBe(true);
    const moved = await patch({ ownerUserId: "user-admin" }, same.json.version);
    expect(events.filter((e) => e.to.length > 0)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ to: ["user-admin"], kind: "deal_owner" });
    events.length = 0;
    await patch({ ownerUserId: "user-sales-ch" }, moved.json.version); // handed to the actor
    expect(events.every((e) => e.to.length === 0)).toBe(true);
  });

  // E5 (a task assigned to you) and the tasks a completion frees are announced by activities-api now
  // (specs/028 US-6, ADR-0082): its tests own the copy. crm-api still announces every estimate event.
  it("creating the estimate's task for the technician sends no second notice: E1 is the only one", async () => {
    const d = await deal();
    await request(d.id);
    expect(events.map((e) => e.kind)).toEqual(["estimate_requested"]);
  });

  it("E6 estimate unlinked: the technical contact, in-app only", async () => {
    const d = await deal();
    await request(d.id);
    events.length = 0;
    await call("DELETE", `/deals/${d.id}/estimate`, { as: "salesCh" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "estimate_unlinked", to: ["user-tech"], email: false, severity: "info", href: `/crm/deals/${d.id}`, title: "Estimate unlinked: Grid analytics" });
  });

  it("E7 moved without estimate: the owner and the requester, in-app only, with the reason", async () => {
    const d = await deal({ ownerUserId: "user-colleague" }, "admin");
    // No estimate yet: the owner alone is told.
    await call("POST", `/deals/${d.id}/estimate/override`, { as: "admin", body: { reason: "Framework contract" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "estimate_gate_overridden", to: ["user-colleague"], email: false, severity: "warning", href: `/crm/deals/${d.id}`, title: "Moved without estimate: Grid analytics" });
    expect(events[0]!.body).toContain("Reason: Framework contract");

    // With a request on record, the requester joins.
    const e = await deal({ ownerUserId: "user-colleague" }, "admin");
    await request(e.id, "admin");
    events.length = 0;
    await call("POST", `/deals/${e.id}/estimate/override`, { as: "salesCh", body: { reason: "x" } });
    expect(events).toHaveLength(0); // refused: admin only
    await call("POST", `/deals/${e.id}/estimate/override`, { as: "admin", body: { reason: "Framework contract" } });
    expect(events[0]!.to).toEqual(["user-colleague"]); // requester is the actor: dropped
  });

  it("E7 reaches a requester who is not the actor", async () => {
    const d = await deal({ ownerUserId: "user-colleague" }, "admin");
    await request(d.id, "salesCh"); // salesCh may request for an entity deal
    events.length = 0;
    await call("POST", `/deals/${d.id}/estimate/override`, { as: "admin", body: { reason: "Framework contract" } });
    expect(events[0]!.to.sort()).toEqual(["user-colleague", "user-sales-ch"]);
  });

  it("E8 deal won / lost: the owner, in-app only; the owner moving it tells nobody", async () => {
    const won = await deal();
    await markEstimateReady(won.id);
    const move = (id: string, version: number, as: "salesCh" | "admin", body: Record<string, unknown>) =>
      call("POST", `/deals/${id}/stage`, { as, ifMatch: version, body });
    const prop = await move(won.id, won.version, "salesCh", { stage: "proposal" });
    expect(events).toHaveLength(0);
    const res = await move(won.id, prop.json.version, "admin", { stage: "won" });
    expect(res.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "deal_won", to: ["user-sales-ch"], email: false, severity: "success", href: `/crm/deals/${won.id}`, title: "Deal won: Grid analytics" });

    events.length = 0;
    const lost = await deal();
    const l = await move(lost.id, lost.version, "admin", { stage: "lost", lostReason: "Budget" });
    expect(l.status).toBe(200);
    expect(events[0]).toMatchObject({ kind: "deal_lost", to: ["user-sales-ch"], severity: "warning", email: false, title: "Deal lost: Grid analytics" });

    events.length = 0;
    const own = await deal();
    await move(own.id, own.version, "salesCh", { stage: "lost", lostReason: "Budget" });
    expect(events.every((e) => e.to.length === 0)).toBe(true);
    noMoney();
  });

  it("E9 offer generated: the owner, in-app only, with no price", async () => {
    const d = await deal({ ownerUserId: "user-colleague" }, "admin");
    await request(d.id, "admin");
    const [estimate] = [...estimai.estimates.values()];
    estimate!.content = { params: {}, releases: [{ id: "r1", name: "MVP" }], acts: [{ id: "1", epic: "Auth", ml: 4, release: "r1" }] };
    await estimaiNotice(d.id);
    await call("PUT", "/entity-profiles/welld_ch", {
      as: "admin",
      body: { legalName: "wellD SA", addressLines: ["Via Example 1"], vatNumber: "CHE-1", iban: "CH00 0000", offerTermsEn: "30 days", offerTermsIt: "30 giorni" },
    });
    events.length = 0;
    const res = await call("POST", `/deals/${d.id}/offers`, { as: "admin", body: await offerBody(d.id, "welld_ch", "Training") });
    expect(res.status).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "offer_generated", to: ["user-colleague"], email: false, severity: "info", href: `/crm/deals/${d.id}`, title: "Offer generated: Grid analytics" });
    noMoney();
  });

  it("clips a long deal title to 100 characters and stays inside notify-api's limits", async () => {
    const d = await deal({ title: "T".repeat(200) });
    await request(d.id);
    expect(events[0]!.title).toBe(`Estimate requested: ${"T".repeat(99)}…`);
    expect(events[0]!.title.length).toBeLessThanOrEqual(200);
    expect(events[0]!.body.length).toBeLessThanOrEqual(2000);
  });

  it("uses 'A colleague' when the actor's name cannot be resolved", async () => {
    const d = await deal();
    forgetIdentities();
    identities.down = true;
    await call("POST", `/deals/${d.id}/estimate/override`, { as: "admin", body: { reason: "x" } });
    expect(events[0]!.body.startsWith("A colleague let")).toBe(true);
  });

  it("the actor is never a recipient, and a refused write notifies nobody", async () => {
    const d = await deal();
    await call("POST", `/deals/${d.id}/estimate/override`, { as: "salesCh", body: { reason: "x" } }); // 403
    expect(events).toHaveLength(0);
    await request(d.id, "salesCh");
    expect(events.flatMap((e) => e.to)).not.toContain("user-sales-ch");
  });
});
