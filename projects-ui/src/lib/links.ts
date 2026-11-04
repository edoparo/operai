/**
 * Links to the sibling tools the shell mounts next to `/projects` (specs/022). They sit outside this
 * remote's router basepath, so they are plain `<a href>`, never router links; the target tool decides
 * access and shows its own unavailable state (AC-3.2).
 */

/** An estimate in EstimAI (crm-ui `links.ts` precedent). */
export const estimaiEstimateHref = (estimateId: string): string =>
  `/estimai/estimates/${encodeURIComponent(estimateId)}`

/** A deal in the CRM. */
export const crmDealHref = (dealId: string): string => `/crm/deals/${encodeURIComponent(dealId)}`
