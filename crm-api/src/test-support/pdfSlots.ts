/**
 * Takes places of the PDF check for a test (security L-13), in the order given: the first `maxConcurrent` run, the rest wait. An entry
 * is the owner (the JWT `sub`) that holds the place, or `undefined` for nobody in particular. Returns what gives them all back.
 */

import { ISOLATED_PDF_CHECK, acquireCheckSlot } from "../entity-profiles/isolatedPdfCheck";

export function holdCheckSlots(owners: ReadonlyArray<string | undefined>): () => void {
  const held = owners.map((owner) => acquireCheckSlot(owner));
  return () => {
    // a place given back is handed to the next waiting, which then has to be given back too
    for (const slot of held) void slot.then((s) => s.release());
  };
}

/** Every place of the check and every place of its queue, held by nobody in particular. */
export const FULL_QUEUE: ReadonlyArray<undefined> = Array.from({ length: ISOLATED_PDF_CHECK.maxConcurrent + ISOLATED_PDF_CHECK.maxQueued }, () => undefined);
