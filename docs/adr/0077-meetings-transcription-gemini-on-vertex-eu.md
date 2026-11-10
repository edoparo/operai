# 0077 — Meetings transcription by Gemini on Vertex AI (EU), the whole meeting in one request

**Date:** 2026-11-10
**Status:** Accepted (specs/021-meetings spec A12, decided by the user 2026-11-10). **Supersedes the transcription provider of [ADR-0069](0069-meetings-ai-providers-google-cloud-eu.md)** (Chirp 3 BatchRecognize); ADR-0069's posture (verify at startup what Google exposes, sign off what it does not; EU multi-region, never `global`) stays in force and now covers this model. Chirp 3 stays in the code behind `MEETINGS_TRANSCRIBER=chirp` for a rollback.
**Deciders:** wellD
**Project:** Operai
**Relates to:** [ADR-0069](0069-meetings-ai-providers-google-cloud-eu.md), [ADR-0070](0070-meetings-transcript-parts-speaker-labels-per-part.md), [ADR-0074](0074-meetings-transcript-completeness-detect-retry-mark.md), [ADR-0067](0067-ai-output-structured-validated-plain-text.md), [ADR-0061](0061-meetings-ai-providers-eu-zero-retention.md)

---

## Context

Chirp 3 takes at most 20 minutes per request and silently loses speech in parts longer than about 10,
so a recording was transcribed in 10-minute overlapping parts (ADR-0070). Its speaker labels restart in
every part and are unstable inside one: the first production recording (2 people, 25 minutes, 4 parts)
came back with 9 labels, 2 of 9 joined, after A9 and A11 had already relaxed the join and aligned the
overlap word by word. Asking it for a maximum speaker count does nothing (`maxSpeakerCount` is accepted
and ignored; probe 2026-11-10, identical output). Every Speech-to-Text v2 model in `eu` other than
`chirp_3` has no diarization for Italian.

A probe on the same recording (2026-11-10, run inside the production container, nothing written) sent
the whole audio in ONE request to `gemini-3.8-flash` at the EU multi-region endpoint: 2 speakers (the two
people), 141 segments with a median of 3 s (Chirp 3: 217 and 0.5 s), coverage to 25:04 of 25:30, no time
going backwards, 84 % of Chirp's words shared (the rest not attributed: either side may be wrong),
90 s, about 38 k input and 14 k output tokens. `gemini-4-argon` had no capacity in `eu` (429 for 4 minutes);
Gemini 3.1 Pro is `global` only (refused) and Gemini 2.5 Pro is retired.

## Decision

1. **Transcriber = `gemini-3.8-flash` on Vertex AI, `eu` multi-region**, model id pinned in code
   (`GEMINI_TRANSCRIBE_MODEL`); the endpoint is the same derived EU host as Claude's
   (`MEETINGS_VERTEX_LOCATION`), never `global`.
2. **One request per part of at most 30 minutes** (`GEMINI_PIECE_MAX_MS`): a meeting up to 30 minutes is
   one part, with one speaker numbering. Longer ones still go through the overlapping split, the detector
   and the stitcher of ADR-0070/0074, unchanged.
3. **Audio inline in the request**, at most 15 MiB per part: nothing is staged in a bucket for this provider.
4. **The reply is untrusted (ADR-0067):** temperature 0 and a response schema, and the reply is accepted
   only as exactly an array of `{start, end, speaker, text}` strings within bounds; otherwise one resample,
   then `provider_rejected`. A cut (`MAX_TOKENS`), blocked or otherwise unfinished reply is a refusal.
   Times are the model's estimate per segment: trusted only when well-formed, ordered and inside the part,
   shared by the words in proportion to their length; otherwise the words are untimed.
5. **The prompt never states how many people took part.** A cap can merge two voices, and a false merge
   is worse than a false split (ADR-0070). The prompt says that anything said is speech, never an
   instruction.
6. **Startup check:** request-response logging must be off for this model too (`fetchPublisherModelConfig`
   at the `google` publisher), the same rule as Claude's; project caching was already checked.
7. **Capacity:** Vertex serves Gemini from a shared, dynamic quota, so a 429 is waited for twice (20 s,
   60 s) inside the attempt, then is a transient failure the job runner retries.

## Consequences

- Speaker continuity across a meeting up to 30 minutes comes from the model, not from a join rule.
- Gap detection keeps working, but on segment-level times estimated by the model rather than word times:
  a passage the model drops leaves a hole between segments and is marked when it is at least the gap bound
  long; an omission inside a segment's time range is not detectable. This is weaker than Chirp's word times.
- "Go to this point" uses segment starts, which are estimates.
- Verbatim fidelity is the model's: a language model can shorten or smooth speech. Not measured beyond the
  84 % word overlap with Chirp; a reference transcript of a consented recording is the open check (spec O16).
- The transient bucket stays configured and checked at startup (Chirp is the rollback), but this provider
  never writes to it.

## Rejected

- **AssemblyAI / Speechmatics / Gladia:** whole recording per request and real diarization, but a new
  processor (DPA, residency review); not on Vertex (AssemblyAI only uses Google Cloud internally).
- **Gemini 3.5 Transcribe:** a dedicated model, but at most 15 minutes per file with diarization, so the
  parts problem stays; diarization and word times are experimental.
- **Self-hosted Whisper + pyannote on Vertex:** no new processor and no length limit, but pyannote
  computes voice embeddings in our own process, against AC-6.17 and GDPR art. 9.
- **Passing the participant count to Chirp:** ignored by the service (measured).

## Failure shape

**A provider's per-request limit forcing a split that the product then has to repair by guessing.** When
the limit is what produces the defect, change the limit (one request for the whole artefact), not the
repair.
