/**
 * Test helper (NOT a test file): pins the body of a schema-validation 400 on the routes that use
 * `zodIssuesHook` — `{ success: false, error: { issues, name: "ZodError" } }`, nothing else.
 * See src/lib/zodHook.ts for why the shape is held stable across zod versions.
 */
import { expect } from "bun:test";

type ZodIssuesBody = {
  success: boolean;
  error: { name: string; issues: { path: (string | number)[]; message: string; code: string }[] };
};

export const expectZodIssuesBody = async (res: Response, firstIssuePath: (string | number)[]) => {
  expect(res.status).toBe(400);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as ZodIssuesBody;
  expect(body.success).toBe(false);
  expect(body.error.name).toBe("ZodError");
  expect(body.error.issues[0]?.path).toEqual(firstIssuePath);
  expect(typeof body.error.issues[0]?.message).toBe("string");
  expect(typeof body.error.issues[0]?.code).toBe("string");
  expect(Object.keys(body).sort()).toEqual(["error", "success"]);
  expect(Object.keys(body.error).sort()).toEqual(["issues", "name"]);
};
