/**
 * "No speech here" (specs/20261104-meetings A10): the creator listened to a possible gap and marks it as holding no speech. The
 * gap is then ignored everywhere a gap counts (the transcript's notice and markers, a new summary's caveat, a new
 * answer's caveat), and the caveats the service already wrote because of it are withdrawn: the summaries' snapshot
 * loses the range, and once no gap is left the service's own "may be incomplete" sentences go back to the plain ones.
 *
 * Only text the SERVICE wrote is replaced, and only on an exact match: an edited section or anything the model wrote
 * is never touched. Pure: the route reads, calls these and writes in one transaction.
 */

import { NOT_IN_MEETING, NOT_IN_MEETING_INCOMPLETE } from "../ai/prompts/answer";
import { NOT_DISCUSSED, NOT_FOUND_INCOMPLETE } from "../ai/prompts/summary";

export interface Range {
  readonly startMs: number;
  readonly endMs: number;
}

interface Section {
  readonly heading: string;
  readonly body: string;
  readonly notDiscussed?: boolean;
}

const sameRange = (a: Range, b: Range): boolean => a.startMs === b.startMs && a.endMs === b.endMs;

const rangesOf = (raw: unknown): Range[] =>
  Array.isArray(raw)
    ? raw.flatMap((g) => {
        const r = g as Partial<Range> | null;
        return r && typeof r.startMs === "number" && typeof r.endMs === "number" ? [{ startMs: r.startMs, endMs: r.endMs }] : [];
      })
    : [];

/**
 * A summary's snapshot without the dismissed ranges and, when none is left, its "not found, may be incomplete"
 * sections back to "not discussed". `null` when nothing changes.
 */
export function withoutDismissed(
  summary: { transcriptGaps: unknown; sections: unknown; language: string },
  dismissed: readonly Range[],
): { transcriptGaps: Range[]; sections: unknown } | null {
  const before = rangesOf(summary.transcriptGaps);
  const after = before.filter((g) => !dismissed.some((d) => sameRange(d, g)));
  if (after.length === before.length) return null;
  if (after.length > 0 || !Array.isArray(summary.sections)) return { transcriptGaps: after, sections: summary.sections };
  const language = summary.language as keyof typeof NOT_DISCUSSED;
  const incomplete = NOT_FOUND_INCOMPLETE[language];
  const plain = NOT_DISCUSSED[language];
  const sections = (summary.sections as Section[]).map((s) => (s.notDiscussed && incomplete !== undefined && s.body === incomplete ? { ...s, body: plain } : s));
  return { transcriptGaps: after, sections };
}

/**
 * A stored answer once the transcript has no gap left: not "possibly incomplete" any more, and the service's fixed
 * "not in the transcript, which may be incomplete" sentence back to the plain one. `null` when nothing changes.
 */
export function answerWithoutCaveat(answer: unknown): Record<string, unknown> | null {
  if (answer === null || typeof answer !== "object") return null;
  const stored = answer as Record<string, unknown>;
  if (stored.possiblyIncomplete !== true) return null;
  let text = stored.text;
  if (stored.notInMeeting === true) {
    for (const language of Object.keys(NOT_IN_MEETING_INCOMPLETE) as (keyof typeof NOT_IN_MEETING_INCOMPLETE)[]) {
      if (text === NOT_IN_MEETING_INCOMPLETE[language]) text = NOT_IN_MEETING[language];
    }
  }
  return { ...stored, text, possiblyIncomplete: false };
}
