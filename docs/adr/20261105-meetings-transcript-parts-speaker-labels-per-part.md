# 20261105 — A long recording is transcribed in parts, and speaker labels are numbered per part, never carried over

**Date:** 2026-11-05
**Status:** Accepted, amended 2026-11-05 (specs/20261104-meetings plan amendment #2, spec A7, T107 findings): parts overlap, and labels are joined only on clear text evidence. Amended 2026-11-09 (spec A9): clear evidence is mutual 80 % agreement, not unanimity, and a silence in the overlap no longer refuses. Amended 2026-11-10 (spec A11): the overlap is aligned word by word, so the same audio heard differently is still recognised as the same speech. Part size is 10 min (measured by spike T107), not 60.
**Deciders:** wellD
**Project:** Operai
**Relates to:** [ADR 20261105-meetings-transcript-completeness-detect-retry-mark](20261105-meetings-transcript-completeness-detect-retry-mark.md), [ADR 20261105-meetings-ai-providers-google-cloud-eu](20261105-meetings-ai-providers-google-cloud-eu.md), [ADR 20261104-meetings-api-reads-audio-bytes-third-reader](20261104-meetings-api-reads-audio-bytes-third-reader.md), [ADR 20261104-ai-output-structured-validated-plain-text](20261104-ai-output-structured-validated-plain-text.md)

---

## Context

Google documents Chirp 3 batch recognition as good for audio "1 minute to 1 hour in general, but up to
20 minutes with word-level timestamp enabled", while meetings run to 3 h + 60 s. The recording is
therefore split into parts (default `PIECE_MAX_MS` = 60 min, cut in the longest silence of at least
0.5 s within the 90 s before the mark, stream copy with no re-encode), each transcribed as its own
request. Diarization labels are consistent only within one file, so nothing tells us whether part 2's
"speaker 1" is part 1's "speaker 1". Speaker names appear in the transcript, the download and every
summary built from it (AC-6.2).

## Decision

We will number speaker labels per part and never carry them across: the adapter emits
`speaker = "p<n>:<label>"`, the existing mapping numbers keys by first appearance across the whole
meeting (part 2's voices become "Speaker 4", "Speaker 5", ...), and the creator **merges by renaming**
two labels to the same participant or text, which the data model already allows. Part start offsets
are stored (`transcriptPartStartsMs`), `GET /meetings/:id/transcript` returns `parts`, and the UI shows
a non-blocking banner and a "Part n" divider only when there is more than one part.

## Amendment 2026-11-05: overlapping parts, joined on text evidence, separable by the creator

The spike (T107) showed Chirp 3 silently loses words on long files, so parts are 10 min, not 60,
and **Option D below became the decision**. This replaces the Decision paragraph's "never carry
them across"; the principle behind it stands.

- **Overlapping parts.** Each part overlaps the next by about 90 s (chosen in a pause between 60 s
  and 120 s); both edges of a part fall in a pause where one exists. Words in the overlap are
  deduplicated by alignment: runs of at least 8 equal normalised words whose times agree are kept
  once, everything unmatched in either version is kept.
  **Refined by spec A8 (2026-11-05):** within a part, duplicates are removed only when both passages carry
  the same speaker label (or one has none); in the overlap of two consecutive parts they are removed
  unless each label is joined to a different earlier label. Untimed repeated tails are removed by
  content. Per-part tries are suspended (tries = 1, ADR 20261105-meetings-transcript-completeness-detect-retry-mark), so the "tries" below currently number one.
- **A label joins a previous part's label only on text evidence (AC-6.14).** Over the aligned
  overlap words, a label of part k+1 joins a label of part k only when at least 20 matched words
  map to that label and to no other, in both directions (it is one-to-one, with no conflicting
  match). Position, number, order of appearance and defaults never join. Nothing joins at a
  boundary where either version has a stretch of at least 20 s with no timed word that touches
  the overlap (J0), a text-and-time condition that is a superset of "the overlap affected by a
  detected gap". The join depends only on the words, their labels and their trusted times, never
  on the audio (AC-6.17); the same outputs join identically whatever the audio.
- **The creator can separate (AC-6.16).** A joined label shows where it spans parts, and the
  creator may "Separate by part", which splits it into one label per part, each keeping the
  name the joined label had (an unnamed "Speaker n" keeps reading so, via `defaultIndex`, and
  the UI shows each label's part). A false join therefore has a visible, cheap repair, like a
  false split always had.
- **Evidence thresholds enforce the principle.** "Never assert identity" is no longer a blanket
  "never join"; it is "join only when the transcript itself proves it". The failure shape is
  unchanged, and the asymmetry (a false merge is silent and corrupts everything derived, a false
  split costs one rename) still decides every tie towards separate. A watch item: the rule is
  applied word by word, so one mis-attributed word blocks a join; that is the safe direction.
  The target is zero false joins; O14's measurement on real recordings was dropped by the user
  (2026-11-08), so a false join reported from use is a defect like any other.
- **Per-part results.** "No per-part result is stored between attempts" now reads: per-part
  tries live **in memory within one job claim** (ADR 20261104-durable-job-runner-work-queued-state-derived) and nothing is at rest in the database
  until the single commit; a retry of the job replaces, never appends. Part ends are stored too
  (`transcriptPartEndsMs`), and each segment carries its `part`.
- **Rejected:** joining by position or number (the failure shape); voice embeddings (biometric
  data, GDPR art. 9); a majority vote instead of the one-to-one rule (it tolerates a false
  merge); using the audio-based gap for J0 (it would make joins depend on the audio and break
  AC-6.17).

## Amendment 2026-11-09: mutual agreement instead of unanimity

The first production recording (2 people, 25 minutes, 4 parts) came back with 11 labels: 0 of 9
later labels joined. Unanimity cannot survive real diarization, which gives a few words to the
other speaker at every turn change, and a 20 s silence in a 90 s overlap (people waiting for a
command to finish) blocked whole seams although a silence carries no evidence. The rule is now:
a later label joins an earlier one when at least 80 % of its matched words go to that label AND
at least 80 % of that label's matched words are its own, with at least 20 matched words; a stretch
without words in the overlap no longer matters; aligned overlap words are removed once whatever
their labels. On the recorded seams of the real service, 100 % and 97 % agreement join, 62 %
(voices confused by the provider) and 74 % (three voices badly separated) stay separate. The
principle stands: text evidence only, never position, number or voice, and a false join stays
repairable with "Separate by part". Refusals are logged by cause (few words, mixed, contested) so
the bound can be revisited with production data.

## Amendment 2026-11-10: the overlap is aligned word by word

Naming the speakers of the same production recording, the user found one person under two names
where parts overlap. A passage of the overlap counted as the same speech only with 8 consecutive
EQUAL words, so one word heard differently every few words ("dei rischi" / "del rischio") left both
versions in the transcript, alternating between the two parts' labels. (Asking the provider for at
most N speakers does not help: Chirp 3 accepts `maxSpeakerCount` and ignores it, verified on that
recording.) The two versions are now aligned word by word, in order: equal words, near-equal words
(edit distance, at least 75 % similar, at least 4 letters) and words heard differently pair up when
their times are within 5 s; a stretch with at least 5 equal or near-equal pairs, not interrupted by
3 other columns, is the same speech and appears once. A word in one version only is still kept, so
the "no speech present in either version is dropped" guarantee stands. Only equal and near-equal
pairs are evidence for a join; a pair of different words never is, so the principle holds: text
evidence, never voice. Rejected: one cut in the middle of the overlap (simpler, but drops speech the
kept version silently omitted, below the 60 s gap bound nobody would be told), and a character
distance between the last seconds of a segment and the first of the next (a single number gives no
word-to-word mapping, and segments are already split by the labels in question).

## Failure shape

**A system asserting an identity relationship it cannot establish, where the assertion is then
consumed as fact downstream.** Two voices that merely share a label in two independent runs are not
known to be the same person. Treating them as one puts a person's words in another's mouth, and the
error does not stay in the transcript: every summary, citation and answer built from it repeats it
with full confidence. The costs are asymmetric: a false merge corrupts everything derived from it and
is invisible, while a false split costs one visible rename.

Mirror positions. **Merge and split:** prefer the error that is visible and cheap to repair over the
one that is silent. **Across parts, across meetings, across retries:** any place where independently
produced labels, ids or clusters are joined by position or ordinal (diarization of a second file,
speaker identity across two meetings, entity resolution across batches) has the same shape.
**Inference and biometrics:** the tempting fix, matching voices by embedding, is itself a new kind of
processing of personal data (biometric-adjacent) that the spec never asked for. Recognise it whenever
code equates two things because they sit at the same index.

## Options considered

### Option A (chosen) - Per-part labels, merge by renaming
**Pros:** never a false attribution; no new processing; no new endpoint (rename already merges); the code handles N >= 1 parts identically, so if the spike shows one 3 h file diarizes acceptably there is one part and nothing to stitch.
**Cons:** one person can appear under two labels on long meetings; the user sees a banner and part dividers.

### Option B - Carry labels across parts by ordinal
Rejected: part 2's "1" is not part 1's "1"; it would put one person's words in another's mouth in the transcript and every summary, which is worse than one person under two labels.

### Option C - Voice-embedding matching across parts
Rejected: new processing of voice characteristics (biometric-adjacent personal data) that the spec never asked for.

### Option D - Overlapping parts and aligning the overlap's words
**Adopted 2026-11-05** (see the amendment above): 90 s overlap, join only on text evidence. It was the named follow-up; the spike's omissions and the A7 spec amendment triggered it.

### Option E - One whole-meeting request regardless of Google's guidance
The spike (T107) decides; the code allows it by raising `PIECE_MAX_MS` to the whole meeting.

## Consequences

**Positive:**
- No false attribution in transcripts or summaries.
- Merging reuses the existing rename path; the only API change is the additive `parts` field.

**Negative / trade-offs:**
- Long meetings show more speaker labels than people until renamed.
- A segment's times are at result granularity (never later than the speech) unless word offsets are enabled; part offsets come from the splitter's `parts.csv`.
- A retry re-runs all parts and replaces `transcriptPartStartsMs` (replace, never append); no per-part result is stored between attempts, since that would be a partial transcript at rest.

**Risks:**
- R20: label splits confuse readers and summaries. Mitigation: never-merge rule, banner, part dividers, merge by rename, possible removal of splitting by the spike, overlap alignment as follow-up. An AC-6.2 clarification for parts (plan A5) is the PO's to decide.

Note on the original options: Option A's "never a false attribution" is now "no join without text evidence, and a join the creator can undo"; Options B and C stay rejected.

## Compliance notes

- GDPR / data-protection impact: low. No new data is processed; voice-embedding matching was rejected to avoid biometric-adjacent processing.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
