/**
 * The calls crm-api makes to estimai-api and to auth's user directory for the
 * estimate flow (specs/018 US-3/US-4). Every call carries the CALLER's own JWT
 * (forwarded): the salesperson creates, shares and reads the estimate as
 * themselves, so no new trust between services exists and estimai-api keeps
 * applying its own record-level rules (ADR-0036/0037).
 *
 * Failures map to problems the UI can explain:
 *   ESTIMAI_API_URL unset      → 503 estimai_unconfigured
 *   estimai-api 401/403        → 403 estimai_access_required (the caller lacks EstimAI)
 *   estimai-api 404            → 404 estimate_unavailable (deleted, or no longer shared)
 *   network error / other 5xx  → 503 estimai_unavailable
 */

import { env } from "./env";
import { ProblemError } from "./problem";

const REQUEST_TIMEOUT_MS = 10_000;

interface CallerSource {
  req: { header(name: string): string | undefined };
}

/** The slice of an EstimAI estimate an offer needs (estimai-api EstimateContentSchema). */
export interface EstimateDocument {
  id: string;
  name: string;
  content: {
    /**
     * The estimate's model parameters (estimai-ui `Parameters`). The grid may
     * store them as strings; absent or non-numeric ones fall back to the
     * documented defaults (AGENTS.md § Estimation model).
     */
    params: {
      aiGain?: number | string;
      parallelism?: number | string;
      sprintDays?: number | string;
      workingDaysMonth?: number | string;
      qaDeployDays?: number | string;
      qaTestDays?: number | string;
      pmDays?: number | string;
    };
    releases: { id: string; name: string; fte?: number | string }[];
    acts: {
      id: string;
      epic?: string;
      act?: string;
      o?: number | string;
      ml?: number | string;
      p?: number | string;
      risk?: number | string;
      aiGain?: number | string;
      release?: string;
    }[];
  };
}

function baseUrl(): string {
  if (!env.ESTIMAI_API_URL) {
    throw new ProblemError({ status: 503, code: "estimai_unconfigured", detail: "EstimAI is not configured for the CRM" });
  }
  return env.ESTIMAI_API_URL.replace(/\/$/, "");
}

async function estimai(c: CallerSource, method: string, path: string, body?: unknown): Promise<Response> {
  const url = `${baseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: c.req.header("Authorization") ?? "",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[estimai] request failed:", method, path, error instanceof Error ? error.message : error);
    throw unavailable();
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProblemError({
      status: 403,
      code: "estimai_access_required",
      detail: "You need access to EstimAI (and to this estimate) to do this",
    });
  }
  if (res.status === 404) {
    throw new ProblemError({
      status: 404,
      code: "estimate_unavailable",
      detail: "The estimate no longer exists in EstimAI, or it is no longer shared with you",
    });
  }
  if (res.status >= 500) {
    console.error("[estimai] answered", res.status, "to", method, path);
    throw unavailable();
  }
  return res;
}

const unavailable = () =>
  new ProblemError({ status: 503, code: "estimai_unavailable", detail: "EstimAI is unavailable; try again shortly" });

/** Creates an empty estimate owned by the caller. */
export async function createEstimate(c: CallerSource, name: string): Promise<{ id: string; name: string }> {
  const res = await estimai(c, "POST", "/estimates", {
    name: name.slice(0, 500),
    author: "",
    content: { params: {}, releases: [], acts: [] },
  });
  if (!res.ok) throw unexpected(res.status, "create the estimate");
  const created = (await res.json()) as { id: string; name: string };
  return { id: created.id, name: created.name };
}

/**
 * Grants `email` editor access to the estimate (specs/013). A 422 means
 * estimai-api refused the person (they cannot use EstimAI).
 */
export async function shareAsEditor(c: CallerSource, estimateId: string, email: string): Promise<void> {
  const res = await estimai(c, "POST", `/estimates/${encodeURIComponent(estimateId)}/collaborators`, {
    email,
    accessLevel: "editor",
  });
  if (res.status === 422 || res.status === 400) {
    throw new ProblemError({
      status: 422,
      code: "technician_not_estimai_user",
      detail: "The technical contact cannot use EstimAI; ask an admin to grant it",
      extras: { field: "technicalUserId" },
    });
  }
  if (!res.ok) throw unexpected(res.status, "share the estimate");
}

/** Best effort: removes an estimate the flow created and could not finish setting up. */
export async function deleteEstimateQuietly(c: CallerSource, estimateId: string): Promise<void> {
  try {
    await estimai(c, "DELETE", `/estimates/${encodeURIComponent(estimateId)}`);
  } catch (error) {
    console.error("[estimai] could not remove an orphaned estimate:", estimateId, error instanceof Error ? error.message : error);
  }
}

export async function getEstimate(c: CallerSource, estimateId: string): Promise<EstimateDocument> {
  const res = await estimai(c, "GET", `/estimates/${encodeURIComponent(estimateId)}`);
  if (!res.ok) throw unexpected(res.status, "read the estimate");
  return (await res.json()) as EstimateDocument;
}

const unexpected = (status: number, what: string) => {
  console.error(`[estimai] unexpected ${status} trying to ${what}`);
  return unavailable();
};

/**
 * The email of an active user who holds `(appId, "access")`, from auth's user
 * directory (ADR-0047/0053/0055; the caller holds `deal:manage`, which opens it).
 * `null` when the person is not in that filtered list.
 */
export async function directoryEmail(c: CallerSource, userId: string, appId: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${env.AUTH_BASE_URL}/authz/users/directory?appId=${encodeURIComponent(appId)}`, {
      headers: { Authorization: c.req.header("Authorization") ?? "" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[directory] request failed:", error instanceof Error ? error.message : error);
    throw identityUnavailable();
  }
  if (res.status === 403) {
    throw new ProblemError({ status: 403, detail: "You cannot look up colleagues (deal:manage is required)" });
  }
  if (!res.ok) throw identityUnavailable();
  const body = (await res.json()) as { users?: { id: string; email: string }[] };
  return body.users?.find((user) => user.id === userId)?.email ?? null;
}

const identityUnavailable = () =>
  new ProblemError({
    status: 503,
    code: "identity_unavailable",
    detail: "The identity service is unavailable; the person could not be checked",
  });
