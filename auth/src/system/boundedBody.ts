/**
 * Reads a request body with a hard ceiling (specs/029 US-7, ADR-0086): the two
 * /system endpoints do work for INVALID credentials too (a valid one must be
 * recognised from any source), so what that work reads must be bounded before
 * any parsing. A declared `Content-Length` over the cap is refused without
 * reading a byte; an undeclared (chunked) body is read incrementally and the
 * stream is cancelled at the first byte past the cap.
 */

export const MAX_SYSTEM_BODY_BYTES = 4096;

export type BoundedBody = { ok: true; text: string } | { ok: false };

export async function readBodyCapped(req: Request, maxBytes = MAX_SYSTEM_BODY_BYTES): Promise<BoundedBody> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return { ok: false };
  if (req.body === null) return { ok: true, text: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; detail: string };

/**
 * `readBodyCapped` + JSON.parse, with the 400 `detail` the two /system routes
 * answer. Only a body that says it is JSON is parsed (anything else yields
 * `value: undefined`, which a schema rejects); nothing in a failure repeats the
 * submitted text.
 */
export async function readJsonBody(req: Request): Promise<JsonBody> {
  const body = await readBodyCapped(req);
  if (!body.ok) return { ok: false, detail: "body: too large" };
  if (!/^application\/(?:[\w.+-]*\+)?json\b/i.test(req.headers.get("Content-Type") ?? "")) {
    return { ok: true, value: undefined };
  }
  try {
    return { ok: true, value: JSON.parse(body.text) };
  } catch {
    return { ok: false, detail: "body: malformed JSON" };
  }
}
