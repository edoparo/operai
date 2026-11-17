import { describe, expect, it } from "bun:test";
import { ProblemError, problem, problemBody } from "./problem";

describe("problem titles", () => {
  it("titles a 410 Gone (the retired letterhead upload routes answer it)", async () => {
    expect(problemBody({ status: 410, code: "letterhead_upload_retired", detail: "retired" }, "/x")).toMatchObject({
      status: 410,
      title: "Gone",
      code: "letterhead_upload_retired",
    });
    const response = problem({ status: 410, detail: "retired" }, "/x");
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ title: "Gone" });
    expect(new ProblemError({ status: 410, detail: "retired" }).toResponse("/x").status).toBe(410);
  });

  it("still falls back to `Error` for a status it has no title for", () => {
    expect(problemBody({ status: 418, detail: "teapot" }, "/x")["title"]).toBe("Error");
  });
});
