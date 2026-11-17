/**
 * The shared entity-scope table (specs/20261116-letterhead-service, plan R3, task T14).
 *
 * `docs/fixtures/entity-scope.json` is run here against `conditions.ts` (the reference) and by
 * `letterhead-api/api/src/authz/scope.rs` against the Rust port, so a rule changed in one and not
 * the other fails a test instead of drifting. Pure: no database, no `auth`, no environment.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENTITIES, hasCapability, inScope, scopeFor } from "./conditions";
import type { ResolvedPermission } from "./resolveClient";

interface ScopeCase {
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly callerEntity: string | null;
  readonly permissions: readonly ResolvedPermission[];
  readonly hasCapability: boolean;
  readonly scope: readonly string[];
}

interface ScopeFixture {
  readonly entities: readonly string[];
  readonly cases: readonly ScopeCase[];
}

// crm-api/src/authz -> the repository root.
const FIXTURE_PATH = join(import.meta.dir, "..", "..", "..", "docs", "fixtures", "entity-scope.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as ScopeFixture;

/** Names that are never in scope, whatever a grant says. */
const NEVER_IN_SCOPE = ["welld_de", "WELLD_IT", "", " welld_it"];

describe("entity scope fixture (docs/fixtures/entity-scope.json)", () => {
  // `scopeFor` warns once per grant it cannot read; the cases that exercise that stay quiet.
  let warn: ReturnType<typeof spyOn>;
  beforeEach(() => {
    warn = spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("is a table that cannot pass by being empty, in the order crm-api uses", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
    expect([...fixture.entities]).toEqual([...ENTITIES]);
    const names = fixture.cases.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const scopeCase of fixture.cases) {
    it(scopeCase.name, () => {
      const { permissions, resource, action, callerEntity } = scopeCase;

      expect(hasCapability(permissions, resource, action)).toBe(scopeCase.hasCapability);

      const scope = scopeFor(permissions, resource, action, callerEntity);
      expect([...scope] as string[]).toEqual([...scopeCase.scope]);

      // inScope agrees with the scope for every entity, and never admits a name that is not one of ours.
      for (const entity of ENTITIES) {
        expect(inScope({ entity }, scope)).toBe(scopeCase.scope.includes(entity));
      }
      for (const stranger of NEVER_IN_SCOPE) {
        expect(inScope({ entity: stranger }, scope)).toBe(false);
      }
    });
  }
});
