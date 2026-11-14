/**
 * The English counterparts of the seven Italian seed templates (specs/20261102-crm-offer-document
 * AC-2.3), in the same order and with the same structure, markup and
 * placeholders as `defaultTemplates.ts`. Client-facing contract text: a
 * faithful, professional British-English rendering of the Italian originals,
 * not a paraphrase. Section numbers cited inside the texts ("section 3",
 * "section 6") match the nine-section skeleton.
 *
 * `[n]` marks a figure the salesperson fills in per offer.
 */

import type { OfferSection, OfferTemplateContent } from "./contract";

// ─── English building blocks ─────────────────────────────────────────────────

const OPENING_EN =
  "Further to our discussions, we are pleased to submit our best offer for the supply described below.\n\n" +
  "This contract is entered into between {issuer}, hereinafter the ‘Supplier’, and {client}, hereinafter the ‘Client’.";

const DEF_FIXED_EN =
  "**Fixed price:** work carried out by the Supplier at its own premises or at a location managed by it, and invoiced on the basis of the delivery of a product or service.";

const DEF_TIME_EN =
  "**Time and materials:** work carried out by the Supplier at its own premises or at the Client’s, at the Client’s request, and invoiced on the basis of a work execution sheet.";

const DEF_FULL_EN = `${DEF_FIXED_EN}\n\n${DEF_TIME_EN}`;

const SLA_FULL_EN = [
  "Application maintenance is offered on the basis of an SLA (Service Level Agreement) governing the response to issues reported on the application.",
  "**The SLA includes:**",
  "a. The availability of qualified staff to take charge of and analyse tickets within the times stated below.\n" +
    "b. The time actually spent resolving the reported issues, up to a maximum of 25 working hours per year.",
  "**The SLA excludes:**",
  "a. Issues that are not reported through the ticketing system provided.\n" +
    "b. Requests that amount to significant changes to the initial requirements (*Change Requests*) in the maintained system (e.g. new features, sections or requirements). The reference is the functional perimeter (that is, the features developed and available to the end user) at the first go-live of the system. In these cases the Supplier informs the Client, who may choose between:\n" +
    "  a. Requesting a separate estimate and quotation for the work concerned;\n" +
    "  b. Accepting the estimated intervention times, confirmed in writing, at the rate of 140 {currency}/hour excluding VAT.\n" +
    "c. Support and handover activities in the event of termination of the service.",
  "### Other SLA conditions",
  "The SLA provides for tickets/reports sent through the system supplied by the Supplier to be taken in charge within:",
  "a. High-priority tickets (serious fault, system unavailable): 1 working day from the report.\n" +
    "b. Normal-priority tickets (minor faults, system otherwise available): 3 working days from the report.",
  "A working day covers the time between 9.00 and 18.00 CET. Working days are those set by the Official Calendar of the Republic and Canton of Ticino. The SLA carries no penalties or fixed resolution times, as these depend closely on the type of issue reported. The time to take charge is tracked by an automatic system provided by the Supplier.",
].join("\n\n");

const NO_SLA_EN = "No SLA is provided for the supply described here.";

const SUPPLY_STD_EN =
  "The work will normally be carried out at the Supplier’s premises and – for coordination activities only – at the premises indicated by the Client.\n\n" +
  "Licences for specific software are the Client’s responsibility.\n\n" +
  "The supply excludes anything not expressly stated.";

const SUPPLY_ONSITE_EN =
  "The work will normally be carried out at the premises indicated by the Client, if in the Canton of Ticino. Travel costs are included in the total price of the order.\n\n" +
  "Licences for specific software or third-party tools are the Client’s responsibility.\n\n" +
  "The supply excludes anything not expressly stated.";

const TRAVEL_EN =
  "### Travel\n\n" +
  "The costs in section 6 include travel within the Canton of Ticino, Switzerland. Any other travel, approved in writing by the Client, will be charged to the Client at cost together with the supporting receipts.";

const SUPPLY_FIXED_EN = (infrastructure: string) =>
  "The supply is on a fixed-price basis.\n\n" +
  `Licences for specific software, to be agreed in advance, are the Client’s responsibility, as are the costs of the production infrastructure${infrastructure}.\n\n` +
  "The supply excludes anything not expressly stated.\n\n" +
  TRAVEL_EN;

const RESOURCES_SHORT_EN =
  "The technical resources allocated by the Supplier to the supply have the skills and qualifications appropriate to the tasks assigned.";

const RESOURCES_EN = `${RESOURCES_SHORT_EN} Resources may change during the course of the supply.`;

const WARRANTY_EN = (months: number) =>
  `${RESOURCES_EN}\n\n` +
  `Where the subject of the supply includes the development of software, it is released with a __${months}-month warranty from the date of first release to production__. The warranty covers the resolution of application defects (bugs) and does not carry a specific Service Level Agreement.\n\n` +
  "Any work after go-live that falls outside the scope of the warranty or of a specific maintenance contract will be invoiced on a time-and-materials basis at a rate of 140 {currency}/hour, or will be the subject of a new offer.\n\n" +
  "Maintenance is to be defined in a separate contract.";

const NOTE_VAT_EN = "**Notes:**\n\n- Costs are stated excluding VAT.";

const RENEWAL_EN =
  "All cost items that recur over time or have a maximum capacity (hours) may be terminated by either Party with 3 (three) calendar months’ notice, given by registered letter. Failing notice of termination, the item is renewed for the duration/capacity stated in item 6 (COSTS).";

const NO_RENEWAL_EN = "No renewals or terminations are provided for.";

const VALIDITY_EN = "This offer is valid for {validityDays} calendar days.";

const ESTIMATE_DISCLAIMER_EN =
  "This estimate is subject to change as the work progresses, it being understood that the Client is guaranteed regular visibility of the progress of the work.";

const GENERAL_EN = (withOwnership: boolean) =>
  [
    "In addition to the above, the following General Conditions of supply apply.",
    "### Limitation of liability",
    "The Supplier declares that it exercises direct control over the resources supplied. The liability of the Supplier and of its resources is limited to the performance of the supply described here, which is carried out in a workmanlike manner and in accordance with the specifications agreed with the Client.",
    "### Employment law",
    "The Supplier’s staff work in full compliance with employment law. Should the Client need documentation in this respect, the Supplier will provide it.",
    "### Confidentiality and ownership",
    "The Supplier undertakes to maintain the strictest confidentiality with regard to the use of documents, drawings and information of which it becomes aware by virtue of the supply contract.",
    ...(withOwnership
      ? [
          "The proprietary rights, including intellectual property rights, whether registrable or not, in everything developed under this contract will belong to the Client.",
        ]
      : []),
    "The Supplier warrants that what is supplied under this agreement does not infringe the intellectual or industrial property rights of third parties.",
    "### Privacy and processing of personal data",
    "The Client and the Supplier each warrant compliance with the privacy rules in force. The Client is authorised to disclose the Supplier’s data to third parties for operations connected with the supply described here. By accepting this contract, the Client likewise accepts the Privacy Policy of {issuer}, the full text of which is provided on request or attached.",
    "### Jurisdiction",
    "For any dispute arising in connection with this supply contract, the competent court is that of Lugano (Switzerland).",
    "### Severability",
    "Should any provision of this contract subsequently prove ineffective for any legal reason, the validity of the remaining provisions shall not be affected. In place of the ineffective provision, the legally valid rule that comes closest to the meaning and purpose of the ineffective provision and of the contract as a whole shall be deemed intended and declared, having regard to good faith, commercial practice and the customs and usages of the sector. Any gaps in the contract shall be treated in the same way.",
  ].join("\n\n");

/** The nine sections, in the examples' order; section 6 carries the cost table. */
function sectionsEn(parts: {
  definitionsHeading?: string;
  definitions: string;
  object: string;
  thirdHeading?: string;
  third: string;
  supply: string;
  resourcesHeading?: string;
  resources: string;
  notes: string;
  duration: string;
  billing: string;
  general: string;
}): OfferSection[] {
  return [
    { heading: parts.definitionsHeading ?? "Definitions", body: parts.definitions, costs: false },
    { heading: "Subject of the supply", body: parts.object, costs: false },
    { heading: parts.thirdHeading ?? "SLA (Service Level Agreement)", body: parts.third, costs: false },
    { heading: "Terms of supply", body: parts.supply, costs: false },
    { heading: parts.resourcesHeading ?? "Resources", body: parts.resources, costs: false },
    { heading: "Costs", body: parts.notes, costs: true },
    { heading: "Term, renewal and termination", body: parts.duration, costs: false },
    { heading: "Invoicing", body: parts.billing, costs: false },
    { heading: "General conditions", body: parts.general, costs: false },
  ];
}

// ─── The seven English templates ─────────────────────────────────────────────

export const DEFAULT_TEMPLATES_EN: readonly OfferTemplateContent[] = [
  {
    // DroneVia 0019/2026r1
    name: "Fixed-price project",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitions: DEF_FULL_EN,
      object:
        "The subject of the supply is:\n\n{epics}\n\nThe breakdown of the effort is given in Annex A, which forms an integral part of this contract.",
      third: SLA_FULL_EN,
      supply: SUPPLY_STD_EN,
      resources: RESOURCES_EN,
      notes:
        `${NOTE_VAT_EN}\n` +
        "- Domains are the Client’s responsibility, as are production infrastructure costs and licences, and are not included in the prices stated above.\n" +
        "- Work on request, excluded from the cost items, is invoiced at 140 {currency}/hour.",
      duration:
        `${RENEWAL_EN}\n\n` +
        "If either Party gives written notice of termination of the service before the hours package has been used up, the Supplier will issue a credit note for the remaining amount.",
      billing:
        "Invoicing follows the plan below, which may be varied by written agreement between Supplier and Client.\n\n" +
        "- Fixed-price parts: 50% at the start of the work, balance on delivery (acceptance testing).\n" +
        "- Recurring parts: as stated in section 6 COSTS.",
      general: GENERAL_EN(true),
    }),
    costLines: [
      { description: "{deal}, fixed price, one-off", kind: "one_off", amount: "deal", quantity: 1 },
      {
        description: "SLA after go-live, as per section 3, per calendar year",
        kind: "yearly",
        amount: { cents: 0 },
        quantity: 1,
      },
    ],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: null,
    annex: true,
  },
  {
    // Lugano Wealth Partners 0017/2026
    name: "One-off + prepaid SLA",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitions: DEF_FULL_EN,
      object:
        "The subject of the supply is the takeover and day-to-day management of {deal}, and in particular:\n\n" +
        "1. Takeover and migration;\n" +
        "2. Annual routine maintenance SLA (see section 3).",
      third: SLA_FULL_EN,
      supply:
        "The work will normally be carried out at the Supplier’s premises and – for coordination activities only – at the premises indicated by the Client.\n\n" +
        "Licences for specific software are the Client’s responsibility.\n\n" +
        "The supply excludes anything not expressly stated (e.g. domain names).",
      resources: RESOURCES_EN,
      notes: NOTE_VAT_EN,
      duration: RENEWAL_EN,
      billing:
        "Invoicing takes place when the service described above starts, in a single payment.\n\n" +
        "Payment within 30 days of the invoice date.",
      general: GENERAL_EN(true),
    }),
    costLines: [
      { description: "Takeover and migration, fixed price, one-off", kind: "one_off", amount: "deal", quantity: 1 },
      { description: "SLA, as above, yearly", kind: "yearly", amount: { cents: 0 }, quantity: 1 },
    ],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: "The Client",
    annex: false,
  },
  {
    // Cornèr Banca 0011/2026
    name: "Training",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitionsHeading: "Definitions, where applicable",
      definitions: DEF_FULL_EN,
      object:
        "The subject of the supply is {deal}.\n\n" +
        "Specifically, the programme comprises **[n] training sessions of [n] days each**, for a maximum of **[n] participants** designated by the Client.\n\n" +
        "The content modules and the specific topics of each may vary in agreement with the Client. The training is scheduled in agreement with the Client.",
      third: NO_SLA_EN,
      supply: SUPPLY_ONSITE_EN,
      resources: RESOURCES_SHORT_EN,
      notes: NOTE_VAT_EN,
      duration: NO_RENEWAL_EN,
      billing:
        "Invoicing follows the plan below, which may be varied by written agreement between Supplier and Client.\n\n" +
        "- 50% at the start of the work, payable on receipt.\n" +
        "- 50% at the end of the work, 30 days from the invoice date.",
      general: GENERAL_EN(false),
    }),
    costLines: [{ description: "{deal}, fixed price", kind: "one_off", amount: "deal", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // AELCO 0005/2026r1
    name: "MVP without maintenance",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitions: DEF_FIXED_EN,
      object: "The subject of the supply is:\n\n{epics}",
      thirdHeading: "Activities and timing",
      third:
        "To deliver the supply described here, the Supplier will carry out the following activities:\n\n{phases}\n\n" +
        "**Estimated timing:**\n\n{timeline}\n\n" +
        ESTIMATE_DISCLAIMER_EN,
      supply: SUPPLY_FIXED_EN(""),
      resourcesHeading: "Resources, warranty and maintenance",
      resources: WARRANTY_EN(3),
      notes: NOTE_VAT_EN,
      duration: VALIDITY_EN,
      billing:
        "Invoicing follows the plan below:\n\n" +
        "- 50% advance at the start of the work\n" +
        "- 50% on delivery of the work\n\n" +
        "Advance invoices are payable **on receipt**, the remainder **30 days from the invoice date**.",
      general: GENERAL_EN(true),
    }),
    costLines: [{ description: "{deal}, as per subject of the supply, fixed price", kind: "one_off", amount: "deal", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // Città di Lugano 0012/2026
    name: "Change request with maintenance package",
    language: "en",
    salutation: "To",
    opening:
      `${OPENING_EN}\n\n` +
      "*The Supplier acknowledges that the general conditions for ICT services issued by the Swiss Conference on Informatics apply to this offer.*",
    sections: sectionsEn({
      definitions:
        "**Fixed price:** work carried out by the Supplier at its own premises or at a location managed by it, and invoiced on the basis of the delivery of a product or service.\n\n" +
        "**Time and materials:** work carried out by the Supplier at its own premises or at the Client’s, at the Client’s request, and invoiced by time on the basis of a work execution sheet.",
      object:
        "The subject of the supply is the analysis and software development work for {deal}.\n\n" +
        "In particular, the following activities are planned:\n\n{epics}",
      third:
        "This offer does not include an SLA. Maintenance and support after go-live will be the subject of a separate contract and offer.",
      supply: SUPPLY_STD_EN,
      resourcesHeading: "Resources, warranty and maintenance",
      resources:
        `${RESOURCES_EN}\n\n` +
        "In accordance with the ICT conditions, the software is released with a 12-month warranty from go-live, covering bugs/defects.\n\n" +
        "Any work outside the scope of the warranty or of a specific maintenance contract will be invoiced on a time-and-materials basis at a rate of 140 {currency}/hour, or will be the subject of a new offer.",
      notes:
        `${NOTE_VAT_EN}\n` +
        "- Costs are fixed-price. Any time-and-materials work – by prior written agreement with the Client – will be invoiced at a rate of 140 {currency}/hour.",
      duration: "This agreement does not provide for renewals or terminations.",
      billing:
        "Invoicing follows this plan: 50% on order, 50% on acceptance testing with the Client.\n\n" +
        "Payment within 30 days of the invoice date.",
      general: GENERAL_EN(true),
    }),
    costLines: [
      { description: "{deal}, fixed price", kind: "one_off", amount: "deal", quantity: 1 },
      {
        description: "Time-and-materials maintenance package, hours",
        kind: "one_off",
        amount: { cents: 14_000 },
        quantity: 1,
      },
    ],
    costColumns: { position: false, unit: true },
    showTotal: true,
    acceptanceLabel: "The Client",
    annex: false,
  },
  {
    // Studio V 0009/2026
    name: "Phased fixed price",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitions:
        `${DEF_FIXED_EN}\n\n` +
        "**Phase:** a major project work package that groups a coherent set of epics and activities.",
      object:
        "The subject of the supply is the design, development and go-live of {deal}.\n\n" +
        "The project is divided into the following phases:\n\n{phases}",
      thirdHeading: "Activities and timing",
      third:
        "To deliver the supply described here, the Supplier will carry out, for each phase, the activities described under the subject of the supply.\n\n" +
        "**Estimated timing:**\n\n{timeline}\n\n" +
        ESTIMATE_DISCLAIMER_EN,
      supply: SUPPLY_FIXED_EN(" (cloud hosting, domains, SSL certificates, other third-party services)"),
      resourcesHeading: "Resources, warranty and maintenance",
      resources: WARRANTY_EN(3),
      notes: NOTE_VAT_EN,
      duration: VALIDITY_EN,
      billing:
        "Invoicing takes place per phase, with an advance and a balance, according to the following plan:\n\n" +
        "**For each phase:**\n\n" +
        "- 30% advance at the start of the phase\n" +
        "- 40% split into monthly instalments, for the months planned for the phase\n" +
        "- 30% balance on completion of the phase, after acceptance testing\n\n" +
        "Advance invoices are payable on receipt, the remainder 30 days from the invoice date.",
      general: GENERAL_EN(false),
    }),
    costLines: [{ description: "{release}", kind: "one_off", amount: "perRelease", quantity: 1 }],
    costColumns: { position: true, unit: false },
    showTotal: false,
    acceptanceLabel: null,
    annex: false,
  },
  {
    // Cornèr Banca 0010/2026
    name: "Consulting by the day",
    language: "en",
    salutation: "To",
    opening: OPENING_EN,
    sections: sectionsEn({
      definitionsHeading: "Definitions, where applicable",
      definitions: DEF_FULL_EN,
      object:
        "The subject of the supply is a bank of days of specialist consulting and technical support for {deal}.\n\n" +
        "Specifically, a total of **{manDays} man-days** is planned, billed on actuals.\n\n" +
        "The details and scheduling of the days are agreed with the Client.",
      third: NO_SLA_EN,
      supply: SUPPLY_ONSITE_EN,
      resources: RESOURCES_SHORT_EN,
      notes: NOTE_VAT_EN,
      duration: NO_RENEWAL_EN,
      billing:
        "Invoicing is based on a statement of days worked, shown on a monthly timesheet attached to the invoice.\n\n" +
        "Payment within 30 days of the invoice date.",
      general: GENERAL_EN(false),
    }),
    costLines: [
      {
        description: "Specialist consulting in man-days",
        kind: "one_off",
        amount: { cents: 120_000 },
        quantity: "manDays",
      },
    ],
    costColumns: { position: true, unit: true },
    showTotal: true,
    acceptanceLabel: null,
    annex: false,
  },
];
