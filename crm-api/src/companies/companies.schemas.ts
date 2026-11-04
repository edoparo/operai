import { z } from "@hono/zod-openapi";
import {
  ArchivedFilterSchema,
  EntitySchema,
  LeadSourceSchema,
  PersonRefSchema,
  optionalText,
  pageOf,
  pageQuery,
  requiredText,
} from "../lib/http";

export const COMPANY_STATUSES = ["prospect", "customer", "former"] as const;
export const CompanyStatusSchema = z.enum(COMPANY_STATUSES);

/** http(s) only: a `javascript:` website rendered as a link would be an XSS vector. */
const WebsiteSchema = z
  .string()
  .max(2048)
  .transform((v) => v.trim())
  .refine((v) => v === "" || /^https?:\/\/[^\s]+$/i.test(v), "Use an http:// or https:// address")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const CountrySchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .refine((v) => v === "" || /^[A-Z]{2}$/.test(v), "Use a two-letter ISO country code")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const editable = {
  name: requiredText(200),
  status: CompanyStatusSchema,
  entity: EntitySchema,
  website: WebsiteSchema,
  industry: optionalText(100),
  city: optionalText(100),
  country: CountrySchema,
  /** The registered name, street and postal code printed in an offer's client block (specs/020 AC-5.1). */
  legalName: optionalText(200),
  street: optionalText(200),
  postalCode: optionalText(20),
  notes: optionalText(10_000),
  /** How the relationship started, and which event or who referred it (US-7). */
  source: LeadSourceSchema.nullable().optional(),
  sourceDetail: optionalText(200),
  ownerUserId: z.string().min(1).max(64),
};

export const CreateCompanySchema = z
  .object({ ...editable, ownerUserId: editable.ownerUserId.optional() })
  .strict();

export const UpdateCompanySchema = z
  .object({
    name: editable.name.optional(),
    status: editable.status.optional(),
    entity: editable.entity.optional(),
    website: editable.website,
    industry: editable.industry,
    city: editable.city,
    country: editable.country,
    legalName: editable.legalName,
    street: editable.street,
    postalCode: editable.postalCode,
    notes: editable.notes,
    source: editable.source,
    sourceDetail: editable.sourceDetail,
    ownerUserId: editable.ownerUserId.optional(),
  })
  .strict();

export const ListCompaniesQuery = z.object({
  q: z.string().max(200).optional(),
  status: CompanyStatusSchema.optional(),
  archived: ArchivedFilterSchema,
  ownerId: z.string().max(64).optional(),
  ...pageQuery(),
});

export const CompanySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The effective status: a lapsed customer reads `former` (specs/017 AC-1.9). */
  status: CompanyStatusSchema,
  /** True when `status` is `former` only because the relationship lapsed. */
  statusLapsed: z.boolean(),
  entity: EntitySchema,
  industry: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  owner: PersonRefSchema,
  archived: z.boolean(),
  contactCount: z.number().int(),
  openDealCount: z.number().int(),
  source: LeadSourceSchema.nullable(),
  sourceDetail: z.string().nullable(),
  updatedAt: z.string(),
});

export const CompanySchema = CompanySummarySchema.extend({
  website: z.string().nullable(),
  legalName: z.string().nullable(),
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});

export const CompanyPageSchema = pageOf(CompanySummarySchema);
