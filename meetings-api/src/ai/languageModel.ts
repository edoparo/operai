/**
 * The language-model seam (specs/20261104-meetings plan.md § AI providers and § Summaries
 * and ask-the-meeting; ADR 20261104-meetings-ai-providers-eu-zero-retention, ADR 20261104-ai-output-structured-validated-plain-text; AC-7.10). One real implementation
 * (`vertexClaude.ts`, Claude on Vertex AI in the EU, ADR 20261105-meetings-ai-providers-google-cloud-eu) and a fake
 * (`fakeLanguageModel.ts`); a fallback provider would sit behind the same interface.
 *
 * STRUCTURED OUTPUT ONLY. `complete` offers the model ONE "tool" (not forced, plan H-8), and that
 * tool is the output schema itself: there is no function that reaches anything, so
 * a hostile transcript has no capability to act on (AC-7.10). What comes back is
 * `unknown` on purpose: it is untrusted until a validator (`prompts/*.ts`) has
 * checked it, and the type makes skipping that step impossible to do silently.
 */

export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * A file attached to the meeting, forwarded unparsed (ADR 20261117-meeting-attachments-in-the-audio-bucket-forwarded-unparsed).
 * Its content is untrusted data, like the transcript.
 */
export interface LlmDocument {
  /** The file's name as a person wrote it: a title, never an instruction. */
  readonly name: string;
  readonly mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "text/plain";
  readonly bytes: Uint8Array;
}

export interface LlmRequest {
  /** The fixed system prompt. Never contains meeting content. */
  readonly system: string;
  /** Alternating, starting with `user`. */
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  /** The meeting's attached files, placed before the text of the FIRST user message. */
  readonly documents?: readonly LlmDocument[];
}

/** The forced tool: a name the output is submitted under and the JSON Schema of its input. */
export interface OutputSchema {
  readonly name: string;
  readonly description: string;
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

/** The names of the two forced tools (ADR 20261104-ai-output-structured-validated-plain-text); the prompt builders and the fake share them. */
export const SUMMARY_TOOL = "submit_summary";
export const ANSWER_TOOL = "submit_answer";
/** The title suggestion's tool (specs/20261104-meetings AC-1.9). */
export const TITLE_TOOL = "submit_title";

/** What a caller can tell about a failure without reading provider text. */
export type LanguageModelFailureCode = "provider_unavailable" | "provider_rejected" | "invalid_output";

/**
 * Thrown by a model. `transient` = a later attempt may succeed (throttling, 5xx, timeout,
 * a reply that was not the forced tool call). The message is built from the code and a
 * status only, never provider text, a prompt or a key.
 */
export class LanguageModelError extends Error {
  constructor(
    readonly code: LanguageModelFailureCode,
    readonly transient: boolean,
    readonly status?: number,
  ) {
    super(`language model failed: ${code}${status !== undefined ? ` (HTTP ${status})` : ""}`);
    this.name = "LanguageModelError";
  }
}

export interface LanguageModel {
  /** The tool input the model submitted, unvalidated. */
  complete(request: LlmRequest, outputSchema: OutputSchema, signal?: AbortSignal): Promise<unknown>;
}

/**
 * `complete`, and when a request that carries documents is REFUSED (a non-transient 4xx: a file the provider will not
 * read, too many pages), the same request once more without them: an attachment must never be the reason a summary or
 * an answer fails. Every other outcome is the caller's, unchanged.
 */
export async function completeWithDocuments(model: LanguageModel, request: LlmRequest, outputSchema: OutputSchema, signal?: AbortSignal): Promise<unknown> {
  try {
    return await model.complete(request, outputSchema, signal);
  } catch (error) {
    const refused = error instanceof LanguageModelError && error.code === "provider_rejected" && !error.transient;
    if (!refused || (request.documents ?? []).length === 0) throw error;
    console.warn("[ai] documents refused by the provider, asking again without them");
    return model.complete({ ...request, documents: [] }, outputSchema, signal);
  }
}

let current: LanguageModel | null = null;

/**
 * The model for this process: the fake under `MEETINGS_AI_PROVIDER=fake` (env.ts refuses
 * that in production), otherwise Vertex. Imported lazily so a fake run never loads the
 * Vertex SDK and this file has no import cycle with its implementations.
 */
export async function languageModel(): Promise<LanguageModel> {
  if (current) return current;
  const { env } = await import("../lib/env");
  if (env.MEETINGS_AI_PROVIDER === "fake") {
    const { FakeLanguageModel } = await import("./fakeLanguageModel");
    current = new FakeLanguageModel();
  } else {
    const { createVertexLanguageModelFromEnv } = await import("./vertexClaude");
    current = await createVertexLanguageModelFromEnv();
  }
  return current;
}

/** Tests only: install a model (or `null` to rebuild from the environment). */
export function setLanguageModelForTests(replacement: LanguageModel | null): void {
  current = replacement;
}
