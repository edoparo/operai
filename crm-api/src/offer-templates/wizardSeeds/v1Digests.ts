/**
 * The SHA-256 of every first-set (v1) revision of each wizard seed text, oldest first, with the commit that first exported it
 * (specs/20261115-crm-offer-wizard T61; DD-59, DD-60, AC-12.5). AUTHORITATIVE since the squash of 33ebd929: the git history no longer
 * holds the v1 texts, so this file is the only record (`--write` refuses to regenerate it from a history without them). T63's one-time upgrade replaces a stored
 * row only when its text hashes to one of these.
 */

import type { WizardSeedCode } from "./welldChIt";

export interface V1Digest {
  readonly sha256: string;
  /** The first commit (8 characters) whose version of the seed file exported this text. */
  readonly commit: string;
}

export const V1_DIGESTS: Readonly<Record<WizardSeedCode, readonly V1Digest[]>> = {
  "T1": [
    { sha256: "97e4d654d0cf2d2dc4931443f4946307ca7926030a69c467a958178f4460c5da", commit: "f299b3a4" },
    { sha256: "9a40779939182604186bf09b43de805a012e4d09a521d51487e437cdba27f1d6", commit: "a58ff092" },
  ],
  "T2": [
    { sha256: "828bcfbd4992de221df30c74fb7cd30f14f2d80bba5c6183549ec589bb62a735", commit: "f299b3a4" },
    { sha256: "a6d92cf116d55bd7fe773416737bc6225dc3a034832aadb6f756e47b2c3f1718", commit: "c93e824a" },
  ],
  "T3": [
    { sha256: "935645239573bcd77dad3e3b6dafc5ebd1f65331dfc802ca850ad6cc3fc166b5", commit: "44387fa6" },
  ],
  "T4": [
    { sha256: "ca4f5b6e5f305b0072ea9f3c731754f2d248e1e6d00f1bddef7ac1e5261f1e39", commit: "1c3a7e71" },
    { sha256: "16992c4b175fa79581cded1d7c6ec8d50c2cf6ee4a2b2c19b8b71567697edec6", commit: "c93e824a" },
    { sha256: "be5bcbfc51cfbef5b57c805855c8ebaf4daf9e3eb45272ce5b656e4ac2d89e9d", commit: "6561ca70" },
  ],
  "T5": [
    { sha256: "393fab739f24bb5ab30c76db6eb00053a330ad385bd0d3b21e325acda7297d58", commit: "1c3a7e71" },
  ],
  "T6": [
    { sha256: "8b794eee9e9d90d374d6e432c8c423b62504bd7ddf2e07fd208e55ebeee85c65", commit: "449bebdf" },
  ],
  "T1+T3": [
    { sha256: "a385cf2a86883f4a852b75e2bf437f15b6d26a11d0c3640b9dffc83171b399e8", commit: "0f593678" },
  ],
};
