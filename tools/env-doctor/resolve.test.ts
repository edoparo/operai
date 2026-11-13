import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasSecretSentinels, hasTemplates, loadTemplateSuite, resolveSecretsInValue, type OpReader } from "./resolve";
import { checkSuite } from "./check";

/** Build a throwaway templates root with the given `<service>.env` contents for one env. */
function fixture(env: string, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "envdoctor-tpl-"));
  const dir = join(root, env);
  mkdirSync(dir, { recursive: true });
  for (const [svc, body] of Object.entries(files)) writeFileSync(join(dir, `${svc}.env`), body);
  return root;
}

// Assembled so a literal 1Password reference never appears in this source file
// (the secret scanner's 1password-reference rule) — the resolver's whole job is to PRODUCE these.
const OP = "op:" + "//";

const AUTH_TPL = [
  "BETTER_AUTH_URL=https://auth.operai.welld.io",
  "BETTER_AUTH_SECRET=${OP:Employee/Paperclip - BETTER_AUTH_SECRET/password}",
  "AUTH_AUDIENCE=${{shared.AUTH_AUDIENCE}}",
].join("\n");

describe("env-doctor resolver", () => {
  test("resolveSecretsInValue reads each ${OP:path} via op:// and substitutes the value", () => {
    const read: OpReader = (ref) => ({ code: 0, stdout: `VAL(${ref})\n`, stderr: "" });
    const r = resolveSecretsInValue("${OP:Vault/Item/field}", read);
    expect(r.error).toBeUndefined();
    expect(r.value).toBe(`VAL(${OP}Vault/Item/field)`); // trailing newline trimmed
  });

  test("resolveSecretsInValue surfaces the first failed reference", () => {
    const read: OpReader = () => ({ code: 1, stdout: "", stderr: "isn't an item" });
    const r = resolveSecretsInValue("${OP:Bad/Path/x}", read);
    expect(r.error).toContain("op read failed for Bad/Path/x");
  });

  test("hasSecretSentinels detects ${OP:…} and is not confused by ${{railway.refs}}", () => {
    expect(hasSecretSentinels(AUTH_TPL)).toBe(true);
    expect(hasSecretSentinels("A=${{shared.X}}\nB=https://y")).toBe(false);
  });

  test("hasTemplates: true for an env dir with .env files, false otherwise", () => {
    const root = fixture("production", { auth: AUTH_TPL });
    expect(hasTemplates("production", root)).toBe(true);
    expect(hasTemplates("staging", root)).toBe(false);
  });

  test("offline (resolve:false): ${OP:…} is left verbatim; resolved=false", () => {
    const root = fixture("production", { auth: AUTH_TPL });
    const r = loadTemplateSuite("production", { dir: root });
    expect(r.loaded).toEqual(["auth"]);
    expect(r.resolved).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.suite.auth!.BETTER_AUTH_SECRET).toBe("${OP:Employee/Paperclip - BETTER_AUTH_SECRET/password}");
    expect(r.suite.auth!.BETTER_AUTH_URL).toBe("https://auth.operai.welld.io");
  });

  test("resolve:true reads each ${OP:…} ref (leaving ${{railway.refs}} untouched) and substitutes values", () => {
    const root = fixture("production", { auth: AUTH_TPL });
    const seen: string[] = [];
    const read: OpReader = (ref) => {
      seen.push(ref);
      return { code: 0, stdout: "s3cr3t-value-x".padEnd(32, "x") + "\n", stderr: "" };
    };
    const r = loadTemplateSuite("production", { dir: root, resolve: true, read });
    // Only the ${OP:…} secret is read — the ${{shared.…}} Railway ref is never passed to op.
    expect(seen).toEqual([OP + "Employee/Paperclip - BETTER_AUTH_SECRET/password"]);
    expect(r.resolved).toBe(true);
    expect(r.suite.auth!.BETTER_AUTH_SECRET).toBe("s3cr3t-value-x".padEnd(32, "x"));
    expect(r.suite.auth!.AUTH_AUDIENCE).toBe("${{shared.AUTH_AUDIENCE}}"); // untouched
  });

  test("resolve:true with a failing read → error surfaced, non-secret values still parsed", () => {
    const root = fixture("production", { auth: AUTH_TPL });
    const read: OpReader = () => ({ code: 1, stdout: "", stderr: "[ERROR] not signed in" });
    const r = loadTemplateSuite("production", { dir: root, resolve: true, read });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.scope).toBe("auth");
    expect(r.errors[0]!.message).toContain("op read failed");
    // Falls back to the unresolved template so the URL/audience checks still run.
    expect(r.suite.auth!.BETTER_AUTH_URL).toBe("https://auth.operai.welld.io");
    expect(r.resolved).toBe(false);
  });

  test("a template with no ${OP:…} secrets does not invoke the reader even with resolve:true", () => {
    const root = fixture("production", { "estimai-api": "AUTH_AUDIENCE=${{shared.AUTH_AUDIENCE}}\nPORT=8080" });
    let called = false;
    const read: OpReader = () => {
      called = true;
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = loadTemplateSuite("production", { dir: root, resolve: true, read });
    expect(called).toBe(false);
    expect(r.resolved).toBe(true);
    expect(r.suite["estimai-api"]!.PORT).toBe("8080");
  });

  // Guards the SHIPPED templates against contract drift — if someone edits a real
  // template into an invalid shape, this fails offline, before any deploy.
  test("the committed production templates pass the doctor offline (no errors, no warnings)", () => {
    const r = loadTemplateSuite("production"); // real TEMPLATES_DIR, offline
    expect(r.errors).toEqual([]);
    expect(r.loaded).toEqual(["auth", "estimai-api", "notify-api", "refund-api", "inventory-api", "crm-api", "meetings-api", "projects-api", "activities-api", "hours-api"]);
    const findings = checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved });
    const bad = findings.filter((f) => f.level !== "ok");
    expect(bad).toEqual([]);
  });

  // The done-when of specs/015 T43, against the SHIPPED templates (not a hand-built suite).
  test("the committed templates fail when SERVICE_AUDIENCE drifts between auth and notify-api", () => {
    const r = loadTemplateSuite("production");
    r.suite.auth!.SERVICE_AUDIENCE = "operai-service";
    r.suite["notify-api"]!.SERVICE_AUDIENCE = "operai-service-2";
    const findings = checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved });
    expect(findings.some((f) => f.level === "error" && f.message.includes("SERVICE_AUDIENCE is not identical"))).toBe(true);
  });

  // specs/021 T81 done-when, against the SHIPPED templates.
  test("the committed templates fail when meetings-api's registry entry loses host-notices.send", () => {
    const r = loadTemplateSuite("production");
    r.suite.auth!.SERVICE_CLIENTS = r.suite.auth!.SERVICE_CLIENTS!.replace("notifications.push host-notices.send", "notifications.push");
    const findings = checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved });
    expect(findings.some((f) => f.level === "error" && f.message.includes('lacks the "host-notices.send" scope'))).toBe(true);
  });

  test("the committed templates fail when crm-api has no SERVICE_AUDIENCE, or meetings-api no MEETINGS_S3_REGION", () => {
    const r = loadTemplateSuite("production");
    delete r.suite["crm-api"]!.SERVICE_AUDIENCE;
    delete r.suite["meetings-api"]!.MEETINGS_S3_REGION;
    const findings = checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved });
    const errors = findings.filter((f) => f.level === "error").map((f) => `${f.scope}: ${f.message}`);
    expect(errors).toContain("crm-api: SERVICE_AUDIENCE is missing");
    expect(errors).toContain("meetings-api: MEETINGS_S3_REGION is missing");
  });

  test("the committed meetings-api template carries the port, client id and provider mode the contract expects", () => {
    const r = loadTemplateSuite("production");
    expect(r.suite["meetings-api"]!.PORT).toBe("8085");
    expect(r.suite["meetings-api"]!.SERVICE_CLIENT_ID).toBe("meetings-api");
    expect(r.suite["meetings-api"]!.MEETINGS_AI_PROVIDER).toBe("real");
    expect(r.suite["meetings-api"]!.MEETINGS_TEST_HOSTS).toBeUndefined();
  });

  test("the committed templates fail when inventory-api's client id is not in auth's SERVICE_CLIENTS", () => {
    const r = loadTemplateSuite("production");
    r.suite["inventory-api"]!.SERVICE_CLIENT_ID = "someone-else";
    const findings = checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved });
    expect(findings.some((f) => f.level === "error" && f.message.includes('no entry for client id "someone-else"'))).toBe(true);
  });

  // specs/026 T16: the shipped templates carry the hand-off keys and scopes; losing one fails offline.
  test("the committed templates fail when a specs/026 hand-off key or scope is dropped", () => {
    const check = (mutate: (s: ReturnType<typeof loadTemplateSuite>["suite"]) => void) => {
      const r = loadTemplateSuite("production");
      mutate(r.suite);
      return checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved })
        .filter((f) => f.level === "error")
        .map((f) => f.message)
        .join(" | ");
    };
    expect(check((s) => delete s["estimai-api"]!.SERVICE_AUDIENCE)).toContain("SERVICE_AUDIENCE is missing");
    expect(check((s) => delete s["projects-api"]!.SERVICE_AUDIENCE)).toContain("SERVICE_AUDIENCE is missing");
    expect(check((s) => delete s["projects-api"]!.ESTIMAI_INTERNAL_URL)).toContain("ESTIMAI_INTERNAL_URL is missing");
    expect(check((s) => delete s["projects-api"]!.NOTIFY_INTERNAL_URL)).toContain("NOTIFY_INTERNAL_URL is missing");
    expect(check((s) => delete s["crm-api"]!.PROJECTS_INTERNAL_URL)).toContain("PROJECTS_INTERNAL_URL is missing");
    const registry = (s: ReturnType<typeof loadTemplateSuite>["suite"]) => JSON.parse(s.auth!.SERVICE_CLIENTS!);
    expect(
      check((s) => {
        const reg = registry(s);
        reg["projects-api"].scope = "crm.companies.read";
        s.auth!.SERVICE_CLIENTS = JSON.stringify(reg);
      }),
    ).toContain('entry "projects-api" lacks the "estimai.estimates.read" scope');
    for (const scope of ["crm.contacts.read", "notifications.push"]) {
      expect(
        check((s) => {
          const reg = registry(s);
          reg["projects-api"].scope = reg["projects-api"].scope.split(" ").filter((x: string) => x !== scope).join(" ");
          s.auth!.SERVICE_CLIENTS = JSON.stringify(reg);
        }),
      ).toContain(`entry "projects-api" lacks the "${scope}" scope`);
    }
    expect(
      check((s) => {
        const reg = registry(s);
        reg["crm-api"].scope = "notifications.push emails.send";
        s.auth!.SERVICE_CLIENTS = JSON.stringify(reg);
      }),
    ).toContain('entry "crm-api" lacks the "projects.purchase-orders.read" scope');
  });

  // specs/029 T33: the shipped templates carry the hours-api contract and meetings-api's service audience;
  // losing a piece fails offline, before any deploy. The errors come back as "<scope>: <message>".
  describe("the committed templates — hours-api and meetings-api's service audience (specs/029)", () => {
    type Suite = ReturnType<typeof loadTemplateSuite>["suite"];
    const errorsAfter = (mutate: (s: Suite) => void) => {
      const r = loadTemplateSuite("production");
      mutate(r.suite);
      return checkSuite(r.suite, { env: "production", isProdLike: true, resolved: r.resolved })
        .filter((f) => f.level === "error")
        .map((f) => `${f.scope}: ${f.message}`);
    };
    const withRegistry = (s: Suite, change: (reg: Record<string, { secret: string; scope: string }>) => void) => {
      const reg = JSON.parse(s.auth!.SERVICE_CLIENTS!);
      change(reg);
      s.auth!.SERVICE_CLIENTS = JSON.stringify(reg);
    };

    test("hours-api or meetings-api without SERVICE_AUDIENCE fails", () => {
      expect(errorsAfter((s) => delete s["hours-api"]!.SERVICE_AUDIENCE)).toContain("hours-api: SERVICE_AUDIENCE is missing");
      expect(errorsAfter((s) => delete s["meetings-api"]!.SERVICE_AUDIENCE)).toContain("meetings-api: SERVICE_AUDIENCE is missing");
    });

    test("hours-api's SERVICE_AUDIENCE equal to its AUTH_AUDIENCE fails (so does meetings-api's)", () => {
      for (const svc of ["hours-api", "meetings-api"] as const) {
        const errors = errorsAfter((s) => (s[svc]!.SERVICE_AUDIENCE = s[svc]!.AUTH_AUDIENCE!));
        expect(errors.some((e) => e.startsWith(`${svc}: ${svc}.SERVICE_AUDIENCE must differ from ${svc}.AUTH_AUDIENCE`))).toBe(true);
      }
    });

    test("auth's hours-api entry without meetings.hosts.read, with an extra scope, or missing fails", () => {
      expect(
        errorsAfter((s) => withRegistry(s, (reg) => (reg["hours-api"]!.scope = "notifications.push"))).join(" | "),
      ).toContain('entry "hours-api" lacks the "meetings.hosts.read" scope');
      expect(
        errorsAfter((s) => withRegistry(s, (reg) => (reg["hours-api"]!.scope = "meetings.hosts.read crm.deals.read"))).join(" | "),
      ).toContain('entry "hours-api" holds the "crm.deals.read" scope, which hours-api does not need');
      expect(errorsAfter((s) => withRegistry(s, (reg) => delete reg["hours-api"])).join(" | ")).toContain(
        'has no entry for client id "hours-api"',
      );
    });

    test("hours-api's CORS missing the shell or admin-ui origin fails", () => {
      expect(errorsAfter((s) => (s["hours-api"]!.ALLOWED_ORIGINS = "https://admin.operai.welld.io")).join(" | ")).toContain(
        "hours-api.ALLOWED_ORIGINS is missing shell's origin https://operai.welld.io",
      );
      expect(errorsAfter((s) => (s["hours-api"]!.ALLOWED_ORIGINS = "https://operai.welld.io")).join(" | ")).toContain(
        "hours-api.ALLOWED_ORIGINS is missing admin-ui's origin https://admin.operai.welld.io",
      );
    });

    test("each of hours-api's four owner URLs made public fails", () => {
      for (const [name, target] of [
        ["PROJECTS_API_URL", "projects-api"],
        ["CRM_API_URL", "crm-api"],
        ["ACTIVITIES_API_URL", "activities-api"],
        ["MEETINGS_API_URL", "meetings-api"],
      ] as const) {
        const errors = errorsAfter((s) => (s["hours-api"]![name] = `https://${target}.operai.welld.io`));
        expect(errors.some((e) => e.startsWith(`hours-api: ${name} should call ${target} over private networking`))).toBe(true);
      }
    });

    test("each of hours-api's required variables dropped from the template fails", () => {
      for (const key of [
        "DATABASE_URL", "ALLOWED_ORIGINS", "AUTH_ISSUER", "AUTH_JWKS_URL", "AUTH_BASE_URL", "AUTH_AUDIENCE",
        "PROJECTS_API_URL", "CRM_API_URL", "ACTIVITIES_API_URL", "MEETINGS_API_URL",
        "SERVICE_CLIENT_ID", "SERVICE_CLIENT_SECRET", "SERVICE_AUDIENCE", "PORT",
      ]) {
        expect(errorsAfter((s) => delete s["hours-api"]![key])).toContain(`hours-api: ${key} is missing`);
      }
    });

    test("the shipped hours-api template: port, client id, a referenced secret, one scope in auth's entry, the same secret on both sides", () => {
      const r = loadTemplateSuite("production");
      const hours = r.suite["hours-api"]!;
      expect(hours.PORT).toBe("8088");
      expect(hours.SERVICE_CLIENT_ID).toBe("hours-api");
      expect(hours.NODE_ENV).toBe("production");
      // The secret is a Railway Shared Variable reference, never a literal, and auth's entry carries the SAME reference.
      expect(hours.SERVICE_CLIENT_SECRET).toStartWith("${{shared.");
      const entry = JSON.parse(r.suite.auth!.SERVICE_CLIENTS!)["hours-api"];
      expect(entry.secret).toBe(hours.SERVICE_CLIENT_SECRET!);
      expect(entry.scope).toBe("meetings.hosts.read");
      // It sends no notification and holds no retired variable.
      expect(hours.NOTIFY_INTERNAL_URL).toBeUndefined();
      expect(hours.NOTIFY_INTERNAL_TOKEN).toBeUndefined();
    });

    test("the shipped meetings-api template carries the shared SERVICE_AUDIENCE, as auth does", () => {
      const r = loadTemplateSuite("production");
      expect(r.suite["meetings-api"]!.SERVICE_AUDIENCE).toBe("${{shared.SERVICE_AUDIENCE}}");
      expect(r.suite.auth!.SERVICE_AUDIENCE).toBe("${{shared.SERVICE_AUDIENCE}}");
      expect(r.suite["hours-api"]!.SERVICE_AUDIENCE).toBe("${{shared.SERVICE_AUDIENCE}}");
    });
  });
});
