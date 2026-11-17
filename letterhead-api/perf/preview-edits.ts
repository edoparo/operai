#!/usr/bin/env bun
/**
 * How long a person waits for the new pages after an edit, in the two previews that draw them: the Letterheads
 * configurator and the CRM offer wizard (specs/20261116-letterhead-service, T34).
 *
 *   AC-8.4   configurator: "within 2 seconds of the last edit in 95 % of edits"
 *   AC-10.4  CRM wizard:   "within 2 seconds of a change in 95 % of changes"
 *
 * Unlike render-perf.ts (the service's own routes, called with a service credential) this is the END-TO-END time a
 * person sees, so it drives the real shell in headless Chromium, signed in as a real administrator, against the real
 * `auth`, letterhead-api and (for the wizard) crm-api: 40 scripted edits, each one a `fill` of a text field, and for each
 * the time from the field's `input` event to the moment the page's preview holds the pages that carry the new text and
 * is no longer updating (`data-state="ready"`, `aria-busy` off), plus two animation frames so the browser has painted what
 * it was given. That includes everything: the debounce of the screen (250 ms in both), the request (through crm-api for the
 * wizard), the layout, the PNG and the text in the answer, and the browser decoding the page images. The marker of an
 * edit is in the text of the pages, so a preview that has not changed cannot count as an answer.
 *
 *   configurator  /letterheads?entity=welld_ch, the sample document (at least 3 pages, every block type); each edit sets
 *                 the footer's first line (English text) to `PERF-E<n>`, which every page's footer carries.
 *   wizard        a deal of welld_ch, two documents one after the other; each edit sets the first text field of the Scope
 *                 step (the subject, "Oggetto") to `PERF-E<n>`, which one page carries:
 *                   - a 10-page offer: the plan's budgets (AC-1.9) are set for 10 pages. Numbered paragraphs on the
 *                     wizard template of the e2e suite, `--paragraphs` of them (default 90, which lays out to 10 pages).
 *                   - the longest offer the wizard's journeys use: the seeded "Progetto a corpo con SLA" with every field
 *                     answered at length, a hand-edited section and two annexes (about 25 pages). A worst case, not a
 *                     typical offer; every answer carries all its pages.
 *
 * Sequential, `--quiet-ms` (500) of quiet between edits, after `--warmup` (2) edits that are not counted (the first
 * render of a process reads the logos; the supervisor keeps them). Percentiles are nearest-rank over the sorted
 * samples: p50 = the 20th and p95 = the 38th of 40. An edit whose pages do not arrive within 15 s aborts the run.
 *
 * Optionally (`--container <name>`) the service's own log line for each SYSTEM render in the window (`render
 * route=preview ... ms=N`: the wizard's, through crm-api) is read with `docker logs` and its p50/p95 printed beside the
 * client's, which is the time the SERVER took. The person routes (the configurator's) are not logged per render.
 *
 * Needs what the e2e suite needs (shell/e2e/fixtures/letterheads.ts, crmOfferService.ts, helpers/crmOfferFixtures.ts):
 * the shell, letterheads-ui and crm-ui served (`--shell-url`, default http://localhost:5173), `auth` with
 * ENABLE_TEST_AUTH=true (E2E_AUTH_URL, and DATABASE_URL: the first admin is made there), letterhead-api
 * (E2E_LETTERHEADS_API_URL), crm-api (E2E_CRM_API_URL) with LETTERHEAD_SERVICE_ENABLED=true calling the service DIRECTLY
 * (not through the e2e relay), and PLAYWRIGHT_BROWSERS_PATH with a Chromium. It makes: the people of the letterheads e2e,
 * one version of welld_ch's letterhead when it has none, a template, two deals and their drafts (discarded and archived
 * at the end); it saves no version and generates no offer.
 *
 *   bun letterhead-api/perf/preview-edits.ts --json perf-previews.json --container lh-t34-api
 *
 * Exit code: 0 when every measured preview's p95 is under `--budget-ms` (2000), 3 when one is not (the numbers are
 * printed either way), 1 on any error.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arg, fail } from "./auth.ts";

const SHELL = fileURLToPath(new URL("../../shell/", import.meta.url));
const { chromium } = createRequire(SHELL + "package.json")("@playwright/test") as typeof import("@playwright/test");
type Page = import("@playwright/test").Page;
type Locator = import("@playwright/test").Locator;

const letterheads = await import(SHELL + "e2e/fixtures/letterheads.ts");
const crm = await import(SHELL + "e2e/helpers/crmOfferFixtures.ts");
const service = await import(SHELL + "e2e/fixtures/crmOfferService.ts");
const session = await import(SHELL + "e2e/helpers/adminSession.ts");

const edits = Number(arg("edits", "40"));
const warmup = Number(arg("warmup", "2"));
const budgetMs = Number(arg("budget-ms", "2000"));
const only = arg("only", "both");
const jsonOut = arg("json");
const container = arg("container");
const quietMs = Number(arg("quiet-ms", "500"));
const paragraphs = Number(arg("paragraphs", "90"));
const shellUrl = (arg("shell-url") ?? "http://localhost:5173").replace(/\/+$/, "");
if (!Number.isInteger(edits) || edits < 1) fail("--edits must be a positive integer");
if (!["both", "configurator", "wizard"].includes(only as string)) fail("--only is both, configurator or wizard");

// --- statistics ----------------------------------------------------------------------------------------------

const rank = (sorted: number[], p: number): number => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: rank(sorted, 50),
    p95: rank(sorted, 95),
    max: sorted[sorted.length - 1]!,
    mean: Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
  };
}
type Stats = ReturnType<typeof stats>;
const show = (label: string, s: Stats) =>
  console.log(`  ${label.padEnd(8)} n=${s.n}  min ${s.min}  p50 ${s.p50}  p95 ${s.p95}  max ${s.max}  mean ${s.mean}  (ms)`);

// --- one preview, timed --------------------------------------------------------------------------------------

interface Target {
  /** CSS selector of the preview region (it carries `data-state`). */
  region: string;
  /** The text field the edits go into. */
  field: Locator;
  /** `every`: every page carries the marker (a footer); `some`: at least one does. */
  mode: "every" | "some";
}

/** One edit: arms the wait in the page, fills the field, and returns the ms from the `input` event to the pages. */
async function edit(page: Page, target: Target, marker: string): Promise<number> {
  await page.evaluate(
    ({ region, text, mode }) => {
      const w = window as unknown as { __tInput: number; __done: Promise<number> };
      document.addEventListener("input", () => (w.__tInput = performance.now()), { capture: true, once: true });
      w.__done = new Promise<number>((resolve, reject) => {
        const root = document.querySelector(region);
        if (!root) return reject(new Error(`no preview region ${region}`));
        const settle = () => {
          const captions = [...root.querySelectorAll("figure figcaption")].map((c) => c.textContent ?? "");
          const carries = mode === "every" ? captions.length > 0 && captions.every((c) => c.includes(text)) : captions.some((c) => c.includes(text));
          if (carries && root.getAttribute("data-state") === "ready" && root.getAttribute("aria-busy") !== "true") {
            observer.disconnect();
            // after the browser has painted what it was just given
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
          }
        };
        const observer = new MutationObserver(settle);
        observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
        setTimeout(() => {
          observer.disconnect();
          reject(new Error(`the pages with ${text} did not arrive in 15 s`));
        }, 15_000);
      });
      w.__done.catch(() => undefined);
    },
    { region: target.region, text: marker, mode: target.mode },
  );
  await target.field.fill(marker);
  return page.evaluate(async () => {
    const w = window as unknown as { __tInput: number; __done: Promise<number> };
    return Math.round((await w.__done) - w.__tInput);
  });
}

async function measure(label: string, page: Page, target: Target) {
  for (let i = 1; i <= warmup; i += 1) {
    await edit(page, target, `PERF-W${i}`);
    await page.waitForTimeout(quietMs);
  }
  const counted = new Date();
  const samples: number[] = [];
  for (let i = 1; i <= edits; i += 1) {
    samples.push(await edit(page, target, `PERF-E${String(i).padStart(2, "0")}`));
    await page.waitForTimeout(quietMs);
  }
  const pages = await page.locator(`${target.region} figure`).count();
  console.log(`${label}: ${pages} pages in the preview`);
  const client = stats(samples);
  show("client", client);
  const server = container ? serverTimes(counted) : null;
  if (server) show("server", server);
  return { client, samples, server, pages, startedAt: counted.toISOString() };
}

/** The service's own `ms=` of each system preview render logged since `from` (the counted edits only), by `docker logs`. */
function serverTimes(from: Date): Stats | null {
  try {
    const logs = execFileSync("docker", ["logs", "--since", from.toISOString(), container as string], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const ms = [...logs.matchAll(/render route=preview .*?outcome=ok .*?pages=\d+ ms=(\d+)/g)].map((m) => Number(m[1]));
    return ms.length > 0 ? stats(ms) : null;
  } catch (error) {
    console.error(`  (the service's log could not be read: ${(error as Error).message.split("\n")[0]})`);
    return null;
  }
}

// --- the two previews ----------------------------------------------------------------------------------------

const browser = await chromium.launch();
const result: Record<string, unknown> = { measuredAt: new Date().toISOString(), edits, warmup, quietMs, budgetMs, container: container ?? null };
let missed = false;
const cleanup: Array<() => Promise<void>> = [];

try {
  const people = await letterheads.setUpPeople();
  await service.ensureServiceLetterhead(people.admin, "welld_ch");

  if (only === "both" || only === "configurator") {
    console.log("configurator (AC-8.4): the sample document, footer text edits");
    const context = await browser.newContext({ baseURL: shellUrl, locale: "en-US", viewport: { width: 1440, height: 1000 } });
    await session.applySessionCookie(context, people.admin);
    const page = await context.newPage();
    await letterheads.openConfigurator(page, "welld_ch");
    const footer = page
      .getByRole("region", { name: "Default page" })
      .getByRole("group", { name: "Footer", exact: true })
      .getByRole("group", { name: "Left zone" })
      .getByRole("group", { name: "Line 1" })
      .getByRole("textbox", { name: "Text, English" });
    const m = await measure("configurator", page, { region: '[role="region"][aria-label="Preview of the sample document"]', field: footer, mode: "every" });
    result["configurator"] = m;
    if (m.client.p95 >= budgetMs) missed = true;
    await context.close();
  }

  if (only === "both" || only === "wizard") {
    const admin = await crm.offerAdmin();
    await crm.ensureEntityProfile(admin);
    const runId = crm.newRunId();
    const documents = [
      { name: "10-page offer (numbered paragraphs)", kind: "text" },
      { name: "long offer (seeded SLA template, every field answered at length)", kind: "sla" },
    ];
    const rows: unknown[] = [];
    result["wizard"] = rows;
    for (const document of documents) {
      console.log(`wizard (AC-10.4): ${document.name}, the subject edited on the Scope step`);
      const deal = await crm.createDealPastEstimateGate(admin, `perf-${document.kind}`, runId);
      cleanup.push(() => crm.discardDraftViaApi(admin, deal.id));
      if (document.kind === "text") {
        const template = await service.createTemplateOf(admin, "welld_ch", `E2E perf ${paragraphs} paragraphs ${runId}`, service.longTemplateSource(paragraphs));
        cleanup.push(() => crm.archiveTemplateViaApi(admin, template.id));
        const draft = await crm.createDraftViaApi(admin, deal.id, template.id);
        await crm.setFieldViaApi(admin, deal.id, draft, "OGGETTO", "Portale clienti");
      } else {
        const template = await crm.findSeededTemplateNamed(admin, "Progetto a corpo con SLA");
        await crm.createLongDraftViaApi(admin, deal.id, template.id);
      }
      const context = await browser.newContext({ baseURL: shellUrl, viewport: { width: 1440, height: 900 } });
      await crm.signInContext(context, admin);
      const page = await context.newPage();
      await page.goto(`/crm/deals/${deal.id}/offer?step=scope`);
      const region = '[data-testid="crm-wizard-service-preview"]';
      await page.waitForSelector(`${region}[data-state="ready"] figure`, { timeout: 60_000 });
      const field = page.getByRole("tabpanel").getByRole("textbox").first();
      await field.waitFor({ timeout: 30_000 });
      console.log(`  edited field: "${await field.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? "?")}"`);
      const m = await measure("wizard", page, { region, field, mode: "some" });
      rows.push({ document: document.name, ...m });
      if (m.client.p95 >= budgetMs) missed = true;
      await context.close();
    }
  }
} catch (error) {
  console.error(`preview-edits: ${(error as Error).stack ?? error}`);
  process.exitCode = 1;
} finally {
  for (const step of cleanup) await step().catch(() => undefined);
  await browser.close();
}

if (process.exitCode === 1) process.exit(1);
console.log(missed ? `\nOVER BUDGET: a p95 is not under ${budgetMs} ms` : `\nWithin budget: every p95 is under ${budgetMs} ms`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2));
process.exit(missed ? 3 : 0);
