import { describe, it, expect } from "bun:test";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { zodIssuesHook } from "./zodHook";

const app = new OpenAPIHono({ defaultHook: zodIssuesHook });
app.openapi(
  createRoute({
    method: "post",
    path: "/x/{id}",
    request: {
      params: z.object({ id: z.string().min(1, "id is required") }),
      body: {
        content: {
          "application/json": { schema: z.object({ title: z.string().min(1, "title is required") }) },
        },
      },
    },
    responses: { 200: { description: "ok" } },
  }),
  (c) => c.json({ ok: true }, 200),
);

const post = (body: unknown) =>
  app.request("/x/abc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("zodIssuesHook — the 400 body @hono/zod-openapi 0.x produced", () => {
  it("answers { success: false, error: { issues, name: 'ZodError' } } and nothing else", async () => {
    const res = await post({ title: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { name: string; issues: { path: unknown[]; message: string; code: string }[] };
    };
    expect(Object.keys(body).sort()).toEqual(["error", "success"]);
    expect(Object.keys(body.error).sort()).toEqual(["issues", "name"]);
    expect(body.success).toBe(false);
    expect(body.error.name).toBe("ZodError");
    expect(body.error.issues[0]?.path).toEqual(["title"]);
    expect(body.error.issues[0]?.message).toBe("title is required");
    expect(typeof body.error.issues[0]?.code).toBe("string");
  });

  it("a JSON body sent with another Content-Type is 415 (@hono/zod-openapi 1.x media-type gate), no longer a validation error", async () => {
    const res = await app.request("/x/abc", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ title: "a" }),
    });
    expect(res.status).toBe(415);
  });

  it("lets a valid request through", async () => {
    expect((await post({ title: "a" })).status).toBe(200);
  });
});
