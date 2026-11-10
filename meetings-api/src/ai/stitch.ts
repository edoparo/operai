/**
 * Stitching the parts of one transcript (specs/021-meetings plan.md § Amendment 2026-11-05 #2, H-2; AC-6.2,
 * AC-6.13, AC-6.14, AC-6.15, AC-6.17).
 *
 * A long recording is transcribed in OVERLAPPING parts, each with its own speaker numbering. This module turns the
 * chosen words of every part into one list of phrases:
 *
 *   D1  inside a part, speech returned twice is kept once (`findRepetitions`);
 *   D2  inside the overlap of parts k and k+1, speech returned by both is kept once (part k's version). The two
 *       versions are aligned WORD BY WORD (A11, 2026-11-10): an order-preserving alignment that pairs equal words,
 *       near-equal words (`NEAR_SIMILARITY`, an edit distance) and, between them, words the two versions heard
 *       differently, but only words whose times are within `PAIR_TIME_MS`. A stretch of the alignment with at least
 *       `PASSAGE_WORDS` equal or near-equal pairs, not cut by `PASSAGE_BREAK` consecutive other columns, is a passage:
 *       the same audio transcribed twice, so every pair in it is the same speech whatever its words and labels
 *       (AC-6.13, A8, A9: a label disagreement there is the provider's diarization jitter). A word found in only one
 *       version is KEPT, inside a passage where the alignment put it, outside in time order, so no speech present in
 *       either version is dropped. (Until A11 a passage was a run of 8 EQUAL words: one word heard differently every
 *       few words left both versions in the transcript, alternating between the two parts' labels.) Within a part (D1)
 *       and the untimed tail the stricter rule applies: same speaker or unlabelled;
 *   J   a label of part k+1 is JOINED to a label of part k only on the evidence of the equal and near-equal pairs of
 *       the passages (a pair of different words is never evidence), and only when
 *       it is MUTUAL (A9, 2026-11-09): the later label has at least `MATCH_WORDS` aligned words, at least
 *       `AGREEMENT` of them attributed to one earlier label, and at least `AGREEMENT` of that earlier label's aligned
 *       words are this later label's. A few words under the other label at a turn change no longer refuse a join
 *       (the first production recording: 0 of 9 labels joined, 11 labels for 2 people); a label that is split
 *       between two (the provider confused the voices) still stays separate. Anything else stays separate. Nothing
 *       else - position, number, order, a default, a silence in the overlap - ever joins or refuses.
 *
 * AC-6.17: the whole decision is a pure function of the words, labels and times the transcription returned. The
 * input type has no field for anything else and this file imports nothing that could supply it (a static test in
 * stitch.test.ts reads this source). No voice characteristic exists anywhere in the pipeline. Deterministic: no
 * randomness, no clock, no locale-dependent comparison, every sort has a total order.
 *
 * Nothing here is logged with content; `StitchStats` carries counts only.
 */

import { REPEAT_GAP_MS, findRepetitions } from "./completeness";
import type { Phrase } from "./segments";
import { effectiveSpans, tokensOf, type Interval, type PartWords, type Token } from "./words";

/** Match bound (AC-6.14): matched words a later label needs to be joined. */
export const MATCH_WORDS = 20;
/**
 * Agreement bound (AC-6.14, A9): the share of the aligned words that must agree, in BOTH directions. Recorded Chirp 3
 * seams (test-fixtures/google-speech): clean 100 %, a seam with a lost passage 97 %, a 3-voice file the provider
 * separated badly 74 % and a seam where it mislabelled the voices 62 %. 80 % joins the first two and refuses the last
 * two.
 */
export const AGREEMENT = 0.8;
/**
 * Overlap alignment bounds (AC-6.13, A11). Two words are near-equal when both have at least `NEAR_MIN_LENGTH`
 * characters after normalisation and their similarity (1 - edit distance / longer length) is at least
 * `NEAR_SIMILARITY` ("progetto"/"progetti", "dell"/"della"). A passage is a stretch of the alignment with at least
 * `PASSAGE_WORDS` equal or near-equal pairs, cut wherever `PASSAGE_BREAK` consecutive columns are not one.
 */
export const NEAR_SIMILARITY = 0.75;
export const NEAR_MIN_LENGTH = 4;
export const PASSAGE_WORDS = 5;
export const PASSAGE_BREAK = 3;
/**
 * The time bound of a pair: the two versions place the same word up to this far apart. Measured on the recorded seams:
 * the first words of a part come back up to 2.5 s off the earlier part's times for the same words.
 */
export const PAIR_TIME_MS = 5_000;
/** Bounds the alignment's table (a real overlap is a few hundred words a side); beyond it nothing is aligned. */
const MAX_ALIGN_CELLS = 16_000_000;

export interface StitchInput {
  /** Every part's chosen words, in order; `part` is 1-based and consecutive parts overlap. */
  readonly parts: readonly PartWords[];
  /** The final gaps of the meeting (AC-6.12): a segment never spans one. Meeting time, merged, ascending. */
  readonly gaps: readonly Interval[];
}

export interface StitchStats {
  readonly removedWithinPart: number;
  readonly removedInOverlap: number;
  readonly joined: number;
  /** Labels of later parts that stayed separate. */
  readonly separate: number;
  /** Why they stayed separate (counts; their sum is `separate`). */
  readonly refused: RefusalCounts;
}

export interface RefusalCounts {
  /** Fewer than `MATCH_WORDS` aligned words (no speech in the overlap included). */
  readonly fewWords: number;
  /** Its aligned words are split between earlier labels. */
  readonly mixed: number;
  /** Its earlier label's aligned words are split between later labels. */
  readonly contested: number;
}

export interface StitchResult {
  readonly phrases: Phrase[];
  readonly stats: StitchStats;
}

interface Item {
  readonly part: number;
  readonly text: string;
  readonly label: string;
  readonly unlabelled: boolean;
  readonly norm: string;
  readonly span: Interval | null;
  readonly eff: Interval;
}

const itemsOf = (part: PartWords): Item[] => {
  const tokens = tokensOf(part.words);
  const eff = effectiveSpans(tokens, part);
  const removed = new Set<number>();
  for (const r of findRepetitions(tokens)) for (let i = r.fromToken; i < r.toToken; i += 1) removed.add(i);
  const out: Item[] = [];
  tokens.forEach((token: Token, i) => {
    if (removed.has(i)) return;
    out.push({ part: part.part, text: part.words[token.wordIndex]!.text, label: token.label, unlabelled: token.unlabelled, norm: token.norm, span: token.span, eff: eff[i]! });
  });
  return out;
};

const removedWithin = (part: PartWords): number => {
  let n = 0;
  for (const r of findRepetitions(tokensOf(part.words))) n += r.toToken - r.fromToken;
  return n;
};

/** Similarity of two normalised words: 1 - edit distance / longer length (0 when either is empty). */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i += 1) {
    const cur = [i];
    for (let j = 1; j <= m; j += 1) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return 1 - prev[m]! / Math.max(n, m);
}

/** How two words of the overlap compare (A11). */
type Kind = "exact" | "near" | "other";
const kindOf = (a: Item, b: Item): Kind => {
  if (a.norm === b.norm) return "exact";
  return Math.min(a.norm.length, b.norm.length) >= NEAR_MIN_LENGTH && wordSimilarity(a.norm, b.norm) >= NEAR_SIMILARITY ? "near" : "other";
};
/** Two words can be the same speech only when their times are within `PAIR_TIME_MS` of each other. */
const near = (a: Interval, b: Interval): boolean => b.startMs - a.endMs <= PAIR_TIME_MS && a.startMs - b.endMs <= PAIR_TIME_MS;

/** One column of the alignment: a pair (p and q), or a word of one version only. */
interface Column {
  readonly p: number | null;
  readonly q: number | null;
  readonly kind: Kind | null;
}

const SCORE: Record<Kind, number> = { exact: 3, near: 2, other: -1 };
const GAP = -1;

/**
 * D2 (A11): the order-preserving, word-by-word alignment of P and Q (both in token order) that maximises the score
 * (equal word +3, near-equal +2, different word -1, a word of one version only -1). Two words can form a pair only when
 * their times are near (`near`); a pair of different words is the same audio heard differently. Deterministic: on a
 * tie the trace prefers a pair, then a word of P only, then a word of Q only.
 */
function alignWords(p: readonly Item[], q: readonly Item[]): Column[] {
  const n = p.length;
  const m = q.length;
  if (n === 0 || m === 0 || n * m > MAX_ALIGN_CELLS) {
    return [...p.map((_, i) => ({ p: i, q: null, kind: null })), ...q.map((_, j) => ({ p: null, q: j, kind: null }))];
  }
  // 0 = pair, 1 = p only, 2 = q only
  const move = new Uint8Array((n + 1) * (m + 1));
  const kinds = new Uint8Array((n + 1) * (m + 1)); // 0 exact, 1 near, 2 other
  let prev = new Float64Array(m + 1);
  for (let j = 1; j <= m; j += 1) {
    prev[j] = j * GAP;
    move[j] = 2;
  }
  for (let i = 1; i <= n; i += 1) {
    const cur = new Float64Array(m + 1);
    cur[0] = i * GAP;
    move[i * (m + 1)] = 1;
    for (let j = 1; j <= m; j += 1) {
      const at = i * (m + 1) + j;
      let best = prev[j]! + GAP;
      let how = 1;
      if (near(p[i - 1]!.eff, q[j - 1]!.eff)) {
        const kind = kindOf(p[i - 1]!, q[j - 1]!);
        const diagonal = prev[j - 1]! + SCORE[kind];
        if (diagonal >= best) {
          best = diagonal;
          how = 0;
          kinds[at] = kind === "exact" ? 0 : kind === "near" ? 1 : 2;
        }
      }
      const left = cur[j - 1]! + GAP;
      if (left > best) {
        best = left;
        how = 2;
      }
      cur[j] = best;
      move[at] = how;
    }
    prev = cur;
  }
  const columns: Column[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const at = i * (m + 1) + j;
    const how = i === 0 ? 2 : j === 0 ? 1 : move[at]!;
    if (how === 0) {
      columns.push({ p: i - 1, q: j - 1, kind: kinds[at] === 0 ? "exact" : kinds[at] === 1 ? "near" : "other" });
      i -= 1;
      j -= 1;
    } else if (how === 1) {
      columns.push({ p: i - 1, q: null, kind: null });
      i -= 1;
    } else {
      columns.push({ p: null, q: j - 1, kind: null });
      j -= 1;
    }
  }
  return columns.reverse();
}

const isMatch = (c: Column): boolean => c.kind === "exact" || c.kind === "near";

/**
 * The passages of the alignment that are the same speech (A11): the alignment is cut wherever `PASSAGE_BREAK` or more
 * consecutive columns are not an equal or near-equal pair, and a piece is a passage when it holds at least
 * `PASSAGE_WORDS` equal or near-equal pairs. Returns, per column, whether it lies in a passage.
 */
function passagesOf(columns: readonly Column[]): boolean[] {
  const inPassage = new Array<boolean>(columns.length).fill(false);
  let from = 0;
  const close = (to: number) => {
    // trim the piece to its first and last match: the columns around it are not anchored on both sides
    let a = from;
    let b = to - 1;
    while (a <= b && !isMatch(columns[a]!)) a += 1;
    while (b >= a && !isMatch(columns[b]!)) b -= 1;
    let matches = 0;
    for (let k = a; k <= b; k += 1) if (isMatch(columns[k]!)) matches += 1;
    if (matches >= PASSAGE_WORDS) for (let k = a; k <= b; k += 1) inPassage[k] = true;
  };
  let misses = 0;
  for (let k = 0; k < columns.length; k += 1) {
    if (isMatch(columns[k]!)) {
      misses = 0;
      continue;
    }
    misses += 1;
    if (misses === PASSAGE_BREAK) {
      close(k - PASSAGE_BREAK + 1);
      from = k + 1;
    } else if (misses > PASSAGE_BREAK) from = k + 1;
  }
  close(columns.length);
  return inPassage;
}

/** Two sequences merged by effective start time, the first sequence's item first on a tie. Each stays in order. */
function mergeByStart(first: readonly Item[], second: readonly Item[]): Item[] {
  const out: Item[] = [];
  let a = 0;
  let b = 0;
  while (a < first.length || b < second.length) {
    if (b >= second.length || (a < first.length && first[a]!.eff.startMs <= second[b]!.eff.startMs)) out.push(first[a++]!);
    else out.push(second[b++]!);
  }
  return out;
}

export function stitch(input: StitchInput): StitchResult {
  const parts = input.parts;
  const items = parts.map(itemsOf);

  // The overlap zones: a suffix of part k and a prefix of part k+1, contiguous in token order.
  const suffixStart = parts.map((_, k) => {
    const next = parts[k + 1];
    if (!next) return items[k]!.length;
    const at = items[k]!.findIndex((it) => it.eff.endMs >= next.startMs - REPEAT_GAP_MS);
    return at === -1 ? items[k]!.length : at;
  });
  const prefixEnd = parts.map((_, k) => {
    const before = parts[k - 1];
    if (!before) return 0;
    let last = -1;
    items[k]!.forEach((it, i) => {
      if (it.eff.startMs <= before.endMs + REPEAT_GAP_MS) last = i;
    });
    return last + 1;
  });
  // A short part must not give the same token to both of its zones.
  for (let k = 0; k < parts.length; k += 1) suffixStart[k] = Math.max(suffixStart[k]!, prefixEnd[k]!);

  const join = new Map<string, string>();
  const rootOf = (label: string): string => {
    let at = label;
    for (let guard = 0; join.has(at) && guard < parts.length + 1; guard += 1) at = join.get(at)!;
    return at;
  };

  const sequence: Item[] = [];
  let removedInOverlap = 0;
  let joined = 0;
  const refused = { fewWords: 0, mixed: 0, contested: 0 };
  for (let k = 0; k < parts.length; k += 1) {
    sequence.push(...items[k]!.slice(prefixEnd[k]!, suffixStart[k]!));
    const nextPart = parts[k + 1];
    if (!nextPart) continue;

    const p = items[k]!.slice(suffixStart[k]!);
    const q = items[k + 1]!.slice(0, prefixEnd[k + 1]!);
    const columns = alignWords(p, q);
    const inPassage = passagesOf(columns);

    // J: who is who, from the equal and near-equal pairs of the passages only (AC-6.14, A9, A11).
    const matched = new Map<string, Map<string, number>>(); // L2 -> L1 -> words
    const ofEarlier = new Map<string, number>(); // L1 -> its matched words, whatever the later label
    columns.forEach((c, at) => {
      if (!inPassage[at] || !isMatch(c)) return;
      const l1 = p[c.p!]!.label;
      const l2 = q[c.q!]!.label;
      const row = matched.get(l2) ?? new Map<string, number>();
      row.set(l1, (row.get(l1) ?? 0) + 1);
      matched.set(l2, row);
      ofEarlier.set(l1, (ofEarlier.get(l1) ?? 0) + 1);
    });
    const labels = new Set(items[k + 1]!.map((it) => it.label));
    for (const l2 of [...labels].sort()) {
      const row = matched.get(l2);
      const words = row ? [...row.values()].reduce((a, b) => a + b, 0) : 0;
      if (!row || words < MATCH_WORDS) {
        refused.fewWords += 1;
        continue;
      }
      // The earlier label with the most of them; a tie has no majority, and the share check below refuses it.
      const [l1, agreed] = [...row].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]!;
      if (agreed < AGREEMENT * words) refused.mixed += 1;
      else if (agreed < AGREEMENT * ofEarlier.get(l1)!) refused.contested += 1;
      else {
        join.set(l2, l1);
        joined += 1;
      }
    }

    // The merged overlap. Inside a passage both versions transcribed the SAME audio, so a pair is the same speech
    // whatever its words or labels and is kept once, part k's version (AC-6.13, A8, A9, A11); a word of one version
    // only is kept where the alignment put it. Outside the passages every word of both versions is kept, in time order.
    let restP: Item[] = [];
    let restQ: Item[] = [];
    const flushRest = () => {
      sequence.push(...mergeByStart(restP, restQ));
      restP = [];
      restQ = [];
    };
    columns.forEach((c, at) => {
      if (!inPassage[at]) {
        if (c.p !== null) restP.push(p[c.p]!);
        if (c.q !== null) restQ.push(q[c.q]!);
        return;
      }
      flushRest();
      if (c.p !== null) sequence.push(p[c.p]!);
      else sequence.push(q[c.q!]!);
      if (c.p !== null && c.q !== null) removedInOverlap += 1;
    });
    flushRest();
  }

  // Segments: consecutive words of one root in one part, never across a gap.
  const separated = (a: Item, b: Item): boolean => input.gaps.some((g) => a.eff.startMs < g.startMs && g.startMs <= b.eff.startMs);
  const phrases: Phrase[] = [];
  let run: Item[] = [];
  const flush = () => {
    if (run.length === 0) return;
    // A segment takes the times of its first trusted word and its latest trusted end (G-3: "a run takes its first and
    // last trusted word"); with none it starts where its untimed words are placed and has no length. Never later than
    // the first trusted word, so a click on the time never skips speech (AC-6.5).
    const timed = run.filter((it) => it.span !== null);
    const startMs = timed.length > 0 ? timed[0]!.span!.startMs : Math.min(...run.map((it) => it.eff.startMs));
    const endMs = timed.length > 0 ? Math.max(startMs, ...timed.map((it) => it.span!.endMs)) : startMs;
    phrases.push({ speaker: rootOf(run[0]!.label), startMs, durationMs: endMs - startMs, text: run.map((it) => it.text).join(" "), part: run[0]!.part });
    run = [];
  };
  for (const item of sequence) {
    const last = run[run.length - 1];
    if (last && (rootOf(last.label) !== rootOf(item.label) || last.part !== item.part || separated(last, item))) flush();
    run.push(item);
  }
  flush();

  return {
    phrases,
    stats: {
      removedWithinPart: parts.reduce((sum, part) => sum + removedWithin(part), 0),
      removedInOverlap,
      joined,
      separate: refused.fewWords + refused.mixed + refused.contested,
      refused,
    },
  };
}
