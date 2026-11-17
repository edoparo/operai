/**
 * A title suggested by the AI (specs/20261104-meetings AC-1.9).
 *
 *   POST /meetings/:id/title-suggestion    creator control, `ready` with speech, one AI request of the hourly limit
 *
 * The creator asks; the model reads the meeting's transcript and its agenda's point titles and proposes one title
 * (`prompts/title.ts`). NOTHING IS WRITTEN: the answer is `{ title }`, the UI puts it in the edit field, and the person
 * saves it (or not) through `PATCH /meetings/:id`, so a host notice, the list and the audit of a title change all stay
 * on the one path they already use. The suggestion is never logged.
 *
 * Failures: 409 `not_ready` / `no_speech` (aiGate), 429 `ai_rate_limited`, 503 `title_suggestion_failed` for a timeout,
 * an outage, a refusal or output that is not a valid title after one resample.
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { LanguageModelError, languageModel } from "../ai/languageModel";
import { requireAiRequest } from "../ai/rateLimit";
import { buildTitleRequest, validateTitleOutput } from "../ai/prompts/title";
import type { AuthzVariables } from "../auth/authz.middleware";
import { db } from "../lib/db";
import { IdParams, commonErrors } from "../lib/http";
import { ProblemError, validationHook } from "../lib/problem";
import { readyForAi } from "./aiGate";
import { callerOf, creatorControl } from "./caller";
import { promptSegmentsOf, speakerNamesFor } from "./promptSegments";
import { assertCreatorControl, openMeeting } from "./visibility";

/** The route waits at most this long for the model. */
export const titleConfig = { timeoutMs: 45_000 };
/** Invalid output gets one more sample, as everywhere else. */
const OUTPUT_TRIES = 2;

const SuggestionSchema = z.object({ title: z.string() });

const suggestRoute = createRoute({
  method: "post",
  path: "/meetings/{id}/title-suggestion",
  tags: ["Meetings"],
  summary: "Propose a title from the transcript (creator; nothing is saved)",
  middleware: creatorControl,
  request: { params: IdParams },
  responses: {
    200: { description: "The proposed title", content: { "application/json": { schema: SuggestionSchema } } },
    ...commonErrors,
    403: { description: "creator_only, frozen or meetings_access_required" },
    404: { description: "Not found" },
    409: { description: "not_ready or no_speech" },
    429: { description: "ai_rate_limited" },
    503: { description: "title_suggestion_failed, identity_unavailable, or auth is unavailable" },
  },
});

const failed = (): ProblemError =>
  new ProblemError({ status: 503, code: "title_suggestion_failed", detail: "No title could be suggested right now. Try again later." });

class TitleTimeout extends Error {}

export const titleRouter = new OpenAPIHono<{ Variables: AuthzVariables }>({ defaultHook: validationHook });

titleRouter.openapi(suggestRoute, async (c) => {
  const { id } = c.req.valid("param");
  const caller = callerOf(c);
  const { meeting, role } = await openMeeting(id, caller);
  await assertCreatorControl(role, caller, meeting.creatorUserId);
  const ready = await readyForAi(id);
  await requireAiRequest(db, caller.userId, "title");

  const isText = ready.source === "text";
  const [rows, names, agenda] = await Promise.all([
    db.transcriptSegment.findMany({ where: { meetingId: id }, orderBy: { ordinal: "asc" } }),
    isText ? Promise.resolve({}) : speakerNamesFor(db, id, caller.authorization),
    db.agendaPoint.findMany({ where: { meetingId: id }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { title: true } }),
  ]);
  if (rows.length === 0) throw failed();
  const input = { language: ready.language, segments: promptSegmentsOf(rows, isText, names), agendaTitles: agenda.map((p) => p.title) };
  const { request, schema } = buildTitleRequest(input);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TitleTimeout());
    }, titleConfig.timeoutMs);
  });
  try {
    const title = await Promise.race([
      (async () => {
        const model = await languageModel();
        for (let sample = 1; sample <= OUTPUT_TRIES; sample++) {
          try {
            const checked = validateTitleOutput(await model.complete(request, schema, controller.signal), input);
            if (checked.ok) return checked.value;
          } catch (error) {
            if (error instanceof LanguageModelError && error.code === "invalid_output") continue;
            throw error;
          }
        }
        return null;
      })(),
      expired,
    ]);
    if (title === null) throw failed();
    return c.json({ title }, 200);
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    // A code or a class name only: an error message can carry content.
    console.error("[title] suggestion failed:", error instanceof LanguageModelError ? error.code : error instanceof TitleTimeout ? "timed_out" : error instanceof Error ? error.name : "unknown");
    throw failed();
  } finally {
    clearTimeout(timer);
  }
});
