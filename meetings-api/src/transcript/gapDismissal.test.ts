import { describe, expect, it } from "bun:test";
import { NOT_IN_MEETING, NOT_IN_MEETING_INCOMPLETE } from "../ai/prompts/answer";
import { NOT_DISCUSSED, NOT_FOUND_INCOMPLETE } from "../ai/prompts/summary";
import { CREATOR, OTHER, call, db, json, kit, mkMeeting, useKit } from "../test-support/captureKit";
import { answerWithoutCaveat, withoutDismissed } from "./gapDismissal";

// specs/021 A10: the creator marks a possible gap "no speech here" after listening; it is then ignored everywhere,
// and the caveats the service wrote because of it are withdrawn (service-written text only).

useKit();

const GAP = { startMs: 164_000, endMs: 200_000 };
const OTHER_GAP = { startMs: 700_000, endMs: 800_000 };
const dismiss = (id: string, body: unknown = GAP, user = CREATOR) => call("POST", `/meetings/${id}/transcript/gaps/dismiss`, { user, body });
const transcriptGaps = async (id: string) => (await json<{ gaps: unknown[] }>(await call("GET", `/meetings/${id}/transcript`, { user: CREATOR }))).gaps;

async function readyWith(gaps = [GAP]) {
  const m = await mkMeeting({ status: "ready", transcriptVersion: 1, processingStartedAt: new Date() });
  await db.transcriptSegment.create({ data: { meetingId: m.id, ordinal: 0, startMs: 0, endMs: 4_000, speakerKey: "s1", text: "Hello" } });
  await db.transcriptGap.createMany({ data: gaps.map((g) => ({ meetingId: m.id, ...g })) });
  return m;
}

describe("the pure rewrites", () => {
  it("a summary loses the dismissed range; with none left its service-written 'may be incomplete' sections read 'not discussed'", () => {
    const sections = [
      { heading: "Decisions", body: NOT_FOUND_INCOMPLETE.it, notDiscussed: true },
      { heading: "Topics", body: "Il modello ha scritto questo.", notDiscussed: false },
    ];
    const out = withoutDismissed({ transcriptGaps: [GAP], sections, language: "it" }, [GAP])!;
    expect(out.transcriptGaps).toEqual([]);
    expect(out.sections).toEqual([{ ...sections[0], body: NOT_DISCUSSED.it }, sections[1]]);
  });

  it("with another gap still open the sections keep their caveat; an unrelated summary is not touched", () => {
    const sections = [{ heading: "Decisions", body: NOT_FOUND_INCOMPLETE.en, notDiscussed: true }];
    const out = withoutDismissed({ transcriptGaps: [GAP, OTHER_GAP], sections, language: "en" }, [GAP])!;
    expect(out).toEqual({ transcriptGaps: [OTHER_GAP], sections });
    expect(withoutDismissed({ transcriptGaps: [OTHER_GAP], sections, language: "en" }, [GAP])).toBeNull();
  });

  it("an edited section is never rewritten: only the exact service sentence is", () => {
    const sections = [{ heading: "Decisions", body: `${NOT_FOUND_INCOMPLETE.en} (checked)`, notDiscussed: true }];
    expect(withoutDismissed({ transcriptGaps: [GAP], sections, language: "en" }, [GAP])!.sections).toEqual(sections);
  });

  it("an answer drops its caveat, and the fixed 'may be incomplete' sentence becomes the plain one", () => {
    expect(answerWithoutCaveat({ text: NOT_IN_MEETING_INCOMPLETE.it, citations: [], notInMeeting: true, possiblyIncomplete: true })).toEqual({
      text: NOT_IN_MEETING.it,
      citations: [],
      notInMeeting: true,
      possiblyIncomplete: false,
    });
    expect(answerWithoutCaveat({ text: "Model text", citations: ["x"], notInMeeting: false, possiblyIncomplete: true })!.text).toBe("Model text");
    expect(answerWithoutCaveat({ text: "Model text", citations: [], notInMeeting: false, possiblyIncomplete: false })).toBeNull();
    expect(answerWithoutCaveat(null)).toBeNull();
  });
});

describe("POST /meetings/:id/transcript/gaps/dismiss", () => {
  it("the creator marks it: the transcript no longer lists it, the others stay, and it is recorded who and when", async () => {
    const m = await readyWith([GAP, OTHER_GAP]);
    const res = await dismiss(m.id);
    expect(res.status).toBe(200);
    expect((await json<{ gaps: unknown[] }>(res)).gaps).toEqual([OTHER_GAP]);
    expect(await transcriptGaps(m.id)).toEqual([OTHER_GAP]);
    const row = await db.transcriptGap.findFirstOrThrow({ where: { meetingId: m.id, startMs: GAP.startMs } });
    expect(row.dismissedBy).toBe(CREATOR);
    expect(row.dismissedAt).not.toBeNull();
  });

  it("withdraws the caveats already written: summaries lose the range, answers lose the label once no gap is left", async () => {
    const m = await readyWith();
    const summary = await db.summary.create({
      data: {
        meetingId: m.id,
        authorUserId: CREATOR,
        template: {},
        language: "en",
        status: "ready",
        attemptId: "a",
        transcriptVersion: 1,
        transcriptGaps: [GAP],
        sections: [{ heading: "Risks", body: NOT_FOUND_INCOMPLETE.en, notDiscussed: true }],
      },
    });
    const turn = await db.conversationTurn.create({
      data: { meetingId: m.id, userId: OTHER, question: "Q?", status: "answered", answer: { text: NOT_IN_MEETING_INCOMPLETE.en, citations: [], notInMeeting: true, possiblyIncomplete: true }, transcriptVersion: 1 },
    });
    expect((await dismiss(m.id)).status).toBe(200);
    const after = await db.summary.findUniqueOrThrow({ where: { id: summary.id } });
    expect(after.transcriptGaps).toEqual([]);
    expect(after.sections).toEqual([{ heading: "Risks", body: NOT_DISCUSSED.en, notDiscussed: true }]);
    expect(after.version).toBe(summary.version); // no content of the author's changed: an open editor is not made stale
    expect((await db.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } })).answer).toEqual({
      text: NOT_IN_MEETING.en,
      citations: [],
      notInMeeting: true,
      possiblyIncomplete: false,
    });
  });

  it("answers keep their caveat while another gap is still open", async () => {
    const m = await readyWith([GAP, OTHER_GAP]);
    const turn = await db.conversationTurn.create({
      data: { meetingId: m.id, userId: CREATOR, question: "Q?", status: "answered", answer: { text: "A", citations: [], notInMeeting: false, possiblyIncomplete: true }, transcriptVersion: 1 },
    });
    await dismiss(m.id);
    expect((await db.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } })).answer).toMatchObject({ possiblyIncomplete: true });
  });

  it("an unknown range, or one already marked, is 404; a meeting not ready is 409 not_ready", async () => {
    const m = await readyWith();
    expect((await dismiss(m.id, { startMs: 1, endMs: 2 })).status).toBe(404);
    expect((await dismiss(m.id)).status).toBe(200);
    expect((await dismiss(m.id)).status).toBe(404);
    const processing = await readyWith();
    await db.meeting.update({ where: { id: processing.id }, data: { status: "processing" } });
    const res = await dismiss(processing.id);
    expect(res.status).toBe(409);
    expect((await json<{ code: string }>(res)).code).toBe("not_ready");
  });

  it("only the creator: a participant is 403 creator_only, a stranger 404, and nothing changes", async () => {
    const m = await readyWith();
    expect((await dismiss(m.id, GAP, OTHER)).status).toBe(404);
    await db.meetingParticipant.create({ data: { meetingId: m.id, userId: OTHER, addedBy: CREATOR } });
    const res = await dismiss(m.id, GAP, OTHER);
    expect(res.status).toBe(403);
    expect((await json<{ code: string }>(res)).code).toBe("creator_only");
    kit.identities.set(CREATOR, "deleted");
    expect((await json<{ code: string }>(await dismiss(m.id))).code).toBe("frozen");
    kit.identities.clear();
    expect(await transcriptGaps(m.id)).toEqual([GAP]);
  });

  it("validates the body: a missing or negative range is 422", async () => {
    const m = await readyWith();
    expect((await dismiss(m.id, {})).status).toBe(422);
    expect((await dismiss(m.id, { startMs: -1, endMs: 5 })).status).toBe(422);
  });
});
