import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiProblem } from "../../src/common/problem.js";
import { toProblem } from "../../src/common/problem.filter.js";

describe("toProblem (T021)", () => {
  it("renders an ApiProblem with its code and extras", () => {
    const problem = toProblem(
      new ApiProblem(403, "step_up_required", "Re-authenticate.", {
        methods: ["passkey", "email_otp"],
      }),
    );
    expect(problem).toMatchObject({
      status: 403,
      code: "step_up_required",
      detail: "Re-authenticate.",
      methods: ["passkey", "email_otp"],
    });
  });

  it("maps framework HTTP errors to stable codes", () => {
    expect(toProblem(new NotFoundException())).toMatchObject({ status: 404, code: "not_found" });
  });

  it("answers 404 when row-level security refuses a row (T084)", () => {
    const denied = Object.assign(new Error("Failed query"), {
      cause: { code: "42501", message: "new row violates row-level security policy" },
    });
    expect(toProblem(denied)).toMatchObject({ status: 404, code: "not_found" });
  });

  it("never leaks internal error details", () => {
    const problem = toProblem(new Error('relation "secret_table" does not exist'));
    expect(problem).toEqual({
      type: "https://guidesk.app/problems/internal_error",
      title: "Internal error",
      status: 500,
      code: "internal_error",
    });
  });

  it.each([
    [409, "plan_limit_reached", { limit: 2, used: 2 }],
    [409, "workspace_pending_deletion", undefined],
    [409, "feed_limit_reached", undefined],
    [409, "duplicate_feed", { reason: "same_channel" }],
    [409, "refresh_too_soon", { retryAfterSeconds: 120 }],
    [409, "confirmation_mismatch", undefined],
    [422, "feed_rejected", { reason: "blocked_address" }],
    [422, "invalid_credential", { provider: "beds24", helpUrl: "https://example.test/help" }],
    [429, "extraction_limit_reached", { limit: 10, resetsAt: "2026-11-17T00:00:00.000Z" }],
  ] as const)(
    "renders the feature 002 error %s %s with its body (T026)",
    (status, code, details) => {
      const problem = toProblem(
        new ApiProblem(status, code, undefined, details ? { details } : {}),
      );
      expect(problem).toMatchObject({ status, code, ...details });
      expect(problem.title).toBeTruthy();
      expect(problem.type).toBe(`https://guidesk.app/problems/${code}`);
    },
  );

  it("never lets details replace the standard members", () => {
    const problem = toProblem(
      new ApiProblem(409, "duplicate_feed", undefined, { details: { code: "x", status: 200 } }),
    );
    expect(problem).toMatchObject({ status: 409, code: "duplicate_feed" });
  });
});
