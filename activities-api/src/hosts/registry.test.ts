/**
 * The host registry is data (specs/20261110-activities plan.md § Access, ADR 20261110-activities-service-access-delegated-to-host): two hosts, the rules of
 * each as fields. These tests pin the rules, so a change to one is a visible diff.
 */
import { describe, expect, it } from "bun:test";
import { buildRegistry, hostRegistry, setRegistryForTests } from "./registry";

const registry = buildRegistry({ crmApiUrl: "http://crm.internal:8084", projectsApiUrl: "http://projects.internal:8086" });

describe("host registry", () => {
  it("holds exactly crm/company and projects/project", () => {
    expect(registry.all().map((h) => `${h.app}/${h.entityType}`)).toEqual(["crm/company", "projects/project"]);
  });

  it("looks a host up by app and entity type, and answers undefined for anything else", () => {
    expect(registry.get("crm", "company")?.kind).toBe("pre_sales");
    expect(registry.get("projects", "project")?.kind).toBe("operational");
    expect(registry.get("crm", "project")).toBeUndefined();
    expect(registry.get("projects", "company")).toBeUndefined();
    expect(registry.get("meetings", "meeting")).toBeUndefined();
    expect(registry.get("crm", "deal")).toBeUndefined();
  });

  it("looks a host up by the kind of activity it holds", () => {
    expect(registry.forKind("pre_sales")?.app).toBe("crm");
    expect(registry.forKind("operational")?.app).toBe("projects");
  });

  it("takes base URLs from its options, without a trailing slash", () => {
    const withSlash = buildRegistry({ crmApiUrl: "http://crm.internal:8084/", projectsApiUrl: "http://projects.internal:8086//" });
    expect(withSlash.get("crm", "company")?.baseUrl).toBe("http://crm.internal:8084");
    expect(withSlash.get("projects", "project")?.baseUrl).toBe("http://projects.internal:8086");
  });

  describe("crm (pre-sales)", () => {
    const crm = registry.get("crm", "company")!;
    it("takes all five activity types", () => {
      expect([...crm.types].sort()).toEqual(["call", "email", "meeting", "note", "task"]);
    });
    it("lets the author edit and any reader complete (017 AC-4.2, AC-4.3)", () => {
      expect(crm.editBy).toBe("author");
      expect(crm.completeBy).toBe("reader");
    });
    it("lets any CRM user be assigned, checked against auth's crm app access", () => {
      expect(crm.assignees).toBe("app_users");
      expect(crm.accessAppId).toBe("crm");
    });
    it("asks the host for related contacts and deals", () => {
      expect([...crm.relatedTypes].sort()).toEqual(["contact", "deal"]);
    });
    it("points task notices at the task list and an entity at its company page (CRM copy unchanged)", () => {
      expect(crm.links.task("c1")).toBe("/crm/tasks");
      expect(crm.links.entity("c1")).toBe("/crm/companies/c1");
    });
  });

  describe("projects (operational)", () => {
    const projects = registry.get("projects", "project")!;
    it("takes tasks only", () => {
      expect([...projects.types]).toEqual(["task"]);
    });
    it("lets a manager edit, and an assignee or a manager complete (AC-3.2, AC-3.3)", () => {
      expect(projects.editBy).toBe("manager");
      expect(projects.completeBy).toBe("assignee_or_manager");
    });
    it("limits assignees to the list the host sends, with participants checked against projects access (AC-3.1, AC-5.1)", () => {
      expect(projects.assignees).toBe("host_list");
      expect(projects.accessAppId).toBe("projects");
    });
    it("has no related entities", () => {
      expect(projects.relatedTypes).toEqual([]);
    });
    it("points a notice at the project page", () => {
      expect(projects.links.task("p1")).toBe("/projects/p1");
      expect(projects.links.entity("p1")).toBe("/projects/p1");
    });
  });

  it("is built once from the environment, and replaceable in tests", () => {
    // Another file of the same `bun test` process (the route tests' world) may have replaced it.
    setRegistryForTests(null);
    const fromEnv = hostRegistry();
    expect(hostRegistry()).toBe(fromEnv);
    expect(fromEnv.get("crm", "company")?.baseUrl).toBe("http://127.0.0.1:1");
    const other = buildRegistry({ crmApiUrl: "http://a:1", projectsApiUrl: "http://b:2" });
    setRegistryForTests(other);
    expect(hostRegistry()).toBe(other);
    setRegistryForTests(null);
    expect(hostRegistry().get("crm", "company")?.baseUrl).toBe("http://127.0.0.1:1");
  });
});
