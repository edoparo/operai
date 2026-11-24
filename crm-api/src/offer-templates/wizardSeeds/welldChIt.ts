/**
 * The catalog of the seven wizard templates welld_ch ships in Italian (specs/20261115-crm-offer-wizard T24;
 * AC-9.1, DD-10, DD-48, DD-49). Each text is one file beside this one (`welldChIt.<code>.ts`); this file gives
 * it a name, a card description, what it is used for and a `seedKey`, and records where the seed's fields are
 * named differently from the mockup the texts were converted from.
 *
 * The texts are code, not migration data (018's lazy-seed posture): `seedWizardTemplates` (offerTemplates.routes.ts)
 * inserts the ones whose `seedKey` has no row, once. Changing a text here changes nothing already seeded; a new
 * version of the set is a new key prefix: this is the second one (`welld-ch-it-v2:`, DD-59), whose texts name the
 * issuer through the entity profile (`[EMITTENTE]`, `source: issuer`) instead of writing "WellD Sagl". The export keeps
 * its name `WELLD_CH_IT_V1` (renaming it would touch eight files for no behaviour); the first set's texts are
 * recorded as digests (`v1Digests.ts`) and `toV1` (`toV1.ts`) is the inverse of this conversion.
 */

import { welldChItT1Text } from "./welldChIt.T1";
import { welldChItT1T3Text } from "./welldChIt.T1T3";
import { welldChItT2Text } from "./welldChIt.T2";
import { welldChItT3Text } from "./welldChIt.T3";
import { T4_TEXT } from "./welldChIt.T4";
import { T5_TEXT } from "./welldChIt.T5";
import { T6_TEXT } from "./welldChIt.T6";

export type WizardSeedCode = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T1+T3";

export interface WizardSeed {
  readonly code: WizardSeedCode;
  /** The id the mockup gave the template (`T13` for `T1+T3`; the golden fixtures are named by the code). */
  readonly mockupId: string;
  /** `welld-ch-it-v2:<code>`: one row per key per entity, archived rows counting (the partial unique index). */
  readonly seedKey: `welld-ch-it-v2:${WizardSeedCode}`;
  /** The key of the first set's row this text replaces (DD-59, DD-60). */
  readonly previousKey: `welld-ch-it-v1:${WizardSeedCode}`;
  /** The key a first-set row an author had edited keeps, decided once and left as written (DD-60). */
  readonly keptKey: `welld-ch-it-v1-kept:${WizardSeedCode}`;
  /**
   * The shipped revision of this v2 text (1 = as first released). A newer revision replaces a stored row only while
   * that row's text is byte-identical to one of `previousRevisions` (wizardSeeds/revise.ts, ADR 20261115-seeded-content-…).
   */
  readonly revision: number;
  /** SHA-256 of every earlier shipped v2 text of this code, oldest first (empty while `revision` is 1). */
  readonly previousRevisions: readonly string[];
  readonly name: string;
  readonly description: string;
  readonly uses: readonly string[];
  readonly source: string;
}

const seed = (
  code: WizardSeedCode,
  mockupId: string,
  name: string,
  description: string,
  uses: readonly string[],
  source: string,
  history: { revision: number; previousRevisions: readonly string[] } = { revision: 1, previousRevisions: [] },
): WizardSeed => ({
  code,
  mockupId,
  seedKey: `welld-ch-it-v2:${code}`,
  previousKey: `welld-ch-it-v1:${code}`,
  keptKey: `welld-ch-it-v1-kept:${code}`,
  name,
  description,
  uses,
  source,
  ...history,
});

/**
 * Revision 2 of T1 and T1+T3 (2026-11-24): the cost line has its own field, `VOCE_DI_COSTO`, instead of repeating
 * `OGGETTO_A_CORPO` (the object of the supply is descriptive, the cost line short). Revision 1 is the text first
 * released under the v2 keys (commit 33ebd929, the only one in the files' history).
 */
const COST_LINE_SPLIT = (revision1: string) => ({ revision: 2, previousRevisions: [revision1] });

/** The seven seeds, in the mockup's order. */
export const WELLD_CH_IT_V1: readonly WizardSeed[] = [
  seed(
    "T1",
    "T1",
    "Progetto a corpo",
    "Progetti, MVP, PoC ed evolutive a prezzo fisso, con collaudo e garanzia di 6 mesi.",
    ["Sviluppo", "MVP e PoC", "Evolutive"],
    welldChItT1Text,
    COST_LINE_SPLIT("7f01c41c05ef3a74830f6029df2473db1744ee9fbef2c1dc000f7d1f29dfd097"),
  ),
  seed(
    "T2",
    "T2",
    "Risorse a tempo",
    "Consulenza tecnica a giornate: T&M con tetto, accordo annuale FTE o pacchetto giornate prepagato.",
    ["T&M", "FTE", "Pacchetto giornate"],
    welldChItT2Text,
  ),
  seed(
    "T3",
    "T3",
    "Manutenzione e SLA",
    "Canone annuale con pacchetto ore e Allegato SLA completo, nei profili Base, Standard e Premium.",
    ["Canone", "Pacchetto ore", "Allegato SLA"],
    welldChItT3Text,
  ),
  seed(
    "T4",
    "T4",
    "Formazione",
    "Corsi, masterclass e workshop, a corpo o per partecipante, con il programma in allegato.",
    ["Corsi", "Workshop"],
    T4_TEXT,
  ),
  seed(
    "T5",
    "T5",
    "Consulenza e assessment",
    "Analisi, audit e design review a corpo, con un deliverable documentale.",
    ["Assessment", "Analisi"],
    T5_TEXT,
  ),
  seed(
    "T6",
    "T6",
    "Servizi a canone",
    "SaaS, infrastruttura gestita e rivendita di licenze, con Allegato DPA facoltativo.",
    ["SaaS", "Hosting", "Licenze"],
    T6_TEXT,
  ),
  seed(
    "T1+T3",
    "T13",
    "Progetto a corpo con SLA",
    "Un solo contratto per progetto, garanzia e manutenzione, con Allegato SLA.",
    ["Sviluppo", "Canone", "Allegato SLA"],
    welldChItT1T3Text,
    COST_LINE_SPLIT("29eb6e18828c24d79a6b569a28b550a4970bfd6a3a5dc3967b797650a1adab11"),
  ),
];

/** A table column the seed names differently from the mockup's state (DD-48). */
export interface SeedColumnRename {
  readonly table: string;
  /** The column's name in the mockup's state (`rows.<table>[].<from>`). */
  readonly from: string;
  /** The column's name in the seed text. */
  readonly to: string;
}

/**
 * Per code, the renames the T35 fidelity adapter applies to the golden answers (captured from the mockup and
 * kept as captured). A field is a scalar or a column, never both, so T4's hours column cannot be `ORE`.
 */
export const WELLD_CH_IT_V1_RENAMES: Readonly<Partial<Record<WizardSeedCode, readonly SeedColumnRename[]>>> = {
  T4: [{ table: "MODULO", from: "ORE", to: "ORE_MODULO" }],
};
