/** EstimAI is a sibling tool under the shell, outside crm-ui's `/crm` router basepath: a plain link, not a router one. */
export const estimaiEstimateHref = (estimateId: string): string => `/estimai/estimates/${encodeURIComponent(estimateId)}`
