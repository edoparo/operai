/**
 * Making a contract: the rules and the row, shared by every way a contract is born (specs/021 T8 by
 * hand, specs/022 T7 from a won deal). The routes own the request, the guards and the answer; this
 * module owns what a contract on a project must satisfy and the data it is stored with, so the
 * by-hand route and the two takes of the to-start queue cannot drift apart.
 */

import { findActiveCompany, orCrmUnavailable } from "../lib/crm";
import type { Prisma } from "../lib/generated/prisma/client";
import { fromDateOnly } from "../lib/http";
import { conflict, unprocessable } from "../lib/problem";
import { isClientType, type ProjectType } from "../projects/projects.schemas";
import { positionRows, termColumns, type Terms } from "./terms";

/** What a project must be for a contract to be added to it (AC-2.1, A27, AC-1.5). */
export interface ContractHost {
  readonly type: ProjectType;
  readonly state: string;
  readonly companyId: string | null;
}

/**
 * 409 unless the project takes a new contract: an `internal` project has no clients, and a
 * `closed` or `cancelled` one takes none until it is reopened. The `detail` is shown to the user.
 */
export function assertTakesContracts(project: Pick<ContractHost, "type" | "state">): void {
  if (project.type === "internal") {
    throw conflict("contracts_not_allowed", "An internal project has no clients and takes no contract");
  }
  if (project.state === "closed" || project.state === "cancelled") {
    throw conflict("project_not_open", `A ${project.state} project takes no new contract`, { state: project.state });
  }
}

const companyMismatch = () =>
  unprocessable("A client project takes contracts for its own company only", { field: "companyId" }, "company_mismatch");

/**
 * The company a contract entered by hand is for (AC-2.2, A12): a client project's own company —
 * another one is a mismatch; any CRM company on a `saas` project, which has none of its own.
 */
export async function resolveCompany(
  project: Pick<ContractHost, "type" | "companyId">,
  requested: string | undefined,
): Promise<string> {
  if (isClientType(project.type)) {
    // A client project always has its company (a CHECK); the default needs no CRM lookup.
    const own = project.companyId!;
    if (requested !== undefined && requested !== own) throw companyMismatch();
    return own;
  }
  if (requested === undefined) {
    throw unprocessable("A company is required for a contract on a saas project", { field: "companyId" }, "company_required");
  }
  if (!(await orCrmUnavailable(findActiveCompany(requested)))) {
    throw unprocessable("The company does not exist in the CRM", { field: "companyId" }, "company_not_found");
  }
  return requested;
}

/**
 * Whether a deal of `dealCompanyId` may join `project` (AC-1.5, A12): a client project takes its
 * own company's deals only, `saas` any company's. The deal's company is the CRM's own record, so
 * it needs no lookup here (unlike a company typed in by hand).
 */
export function assertDealCompanyFits(project: Pick<ContractHost, "type" | "companyId">, dealCompanyId: string): void {
  if (isClientType(project.type) && project.companyId !== dealCompanyId) throw companyMismatch();
}

export interface NewContract {
  readonly type: ProjectType;
  readonly companyId: string;
  readonly startDate: string;
  readonly endDate?: string | null | undefined;
  readonly terms: Terms;
  /** Set when the contract is made from a won deal; absent for one entered by hand. */
  readonly deal?: { readonly dealId: string; readonly estimateId: string | null };
}

/**
 * The columns of a new contract and its T&M positions, without the project: a by-hand or attached
 * contract adds `projectId`, a new project nests it under `contracts.create`. A deal contract is
 * `origin: deal` with the deal's id and estimate id (the two CHECKs of specs/022 hold it to that).
 */
export function contractCreateData(contract: NewContract): Omit<Prisma.ContractUncheckedCreateInput, "projectId"> {
  return {
    type: contract.type,
    companyId: contract.companyId,
    startDate: fromDateOnly(contract.startDate)!,
    endDate: fromDateOnly(contract.endDate) ?? null,
    ...(contract.deal
      ? { origin: "deal" as const, dealId: contract.deal.dealId, estimateId: contract.deal.estimateId }
      : {}),
    ...termColumns(contract.terms),
    positions: { create: positionRows(contract.terms) },
  };
}
