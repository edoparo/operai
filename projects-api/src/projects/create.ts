/**
 * Making a project: the rules and the row, shared by every way a project is born (specs/021 T5 by
 * hand, specs/022 T7 from a won deal). The routes own the request, the guards and the answer.
 */

import { findActiveCompany, orCrmUnavailable } from "../lib/crm";
import type { Prisma } from "../lib/generated/prisma/client";
import { unprocessable } from "../lib/problem";
import { isClientType, type ProjectType } from "./projects.schemas";

/**
 * A client project has exactly one company, which the CRM knows and has not archived (the
 * picker never offers an archived one); `saas` and `internal` have none (AC-1.1, D5, D19, D24).
 */
export async function assertCompanyFits(type: ProjectType, companyId: string | undefined): Promise<void> {
  if (!isClientType(type)) {
    if (companyId !== undefined) {
      throw unprocessable("A saas or internal project has no company of its own", { field: "companyId" }, "company_not_allowed");
    }
    return;
  }
  if (companyId === undefined) {
    throw unprocessable("A company is required for this project type", { field: "companyId" }, "company_required");
  }
  if (!(await orCrmUnavailable(findActiveCompany(companyId)))) {
    throw unprocessable("The company does not exist in the CRM", { field: "companyId" }, "company_not_found");
  }
}

export interface NewProject {
  readonly name: string;
  readonly type: ProjectType;
  readonly entity: "welld_ch" | "welld_it";
  readonly companyId: string | null;
  readonly projectManagerId: string;
  readonly createdById: string;
}

/** The columns of a new project: state `planned` and version 1 are the column defaults. */
export const projectCreateData = (project: NewProject): Prisma.ProjectUncheckedCreateInput => ({
  name: project.name,
  type: project.type,
  entity: project.entity,
  companyId: project.companyId,
  projectManagerId: project.projectManagerId,
  createdById: project.createdById,
});
