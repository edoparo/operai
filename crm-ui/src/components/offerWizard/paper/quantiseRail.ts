/**
 * The rail's heights as the browser will keep them (QE D24). A browser holds a float's height in 1/64 px
 * (`LayoutUnit`) and drops what does not fit, so a rail of N breaks drawn with the planned heights loses up to 1/64 px
 * per break and the text of page N lands N/64 px above its page's frame (1.06 px by page 111 of 136 at 320 px, where
 * the page height is not a multiple of 1/64; pages are placed from absolute numbers, so only the text drifted).
 * Here every boundary of the rail is rounded to 1/64 px from its ABSOLUTE planned position, and each height is the
 * difference of two such boundaries: the error never accumulates and stays within 1/64 px of the plan at any length.
 * Pure numbers, no DOM.
 */
export const LAYOUT_UNIT = 1 / 64

export interface RailStep {
  /** Height of the zero-width float up to where the dead zone starts. */
  run: number
  /** Height of the full-width float: the dead zone, the gap between two pages. */
  dead: number
}

/**
 * `rail` is the plan (`run`, then `dead`, each measured from the end of the step before). The result draws the same
 * rail with heights in whole 1/64 px: the dead zone starts at least `eps` later than planned, minus the 1/64 rounding
 * (a line that ends exactly where the zone begins must not be pushed down), and ends within 1/64 px of where planned.
 */
export function quantiseRail(rail: readonly RailStep[], eps: number): RailStep[] {
  let planned = 0 // where the previous step ends in the plan
  let placed = 0 // where it ends as drawn
  return rail.map(({ run, dead }) => {
    const start = Math.floor((planned + run + eps) / LAYOUT_UNIT) * LAYOUT_UNIT
    planned += run + dead
    const end = Math.max(start, Math.round(planned / LAYOUT_UNIT) * LAYOUT_UNIT)
    const step = { run: start - placed, dead: end - start }
    placed = end
    return step
  })
}
