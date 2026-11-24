/**
 * The first v2 text of every seed, for the tests (2026-11-24): the shipped revision 1 of a revised seed (its fixture in
 * this folder), otherwise the seed's current text. A test that stores a row "as seeded before" or rebuilds the first
 * set with `toV1` starts from this, never from `seed.source`.
 */
import type { WizardSeed, WizardSeedCode } from "../welldChIt";
import { welldChItT1TextR1 } from "./welldChIt.T1.r1";
import { welldChItT1T3TextR1 } from "./welldChIt.T1T3.r1";

const REVISION_1: Partial<Record<WizardSeedCode, string>> = { T1: welldChItT1TextR1, "T1+T3": welldChItT1T3TextR1 };

export const firstV2Text = (seed: WizardSeed): string => REVISION_1[seed.code] ?? seed.source;
