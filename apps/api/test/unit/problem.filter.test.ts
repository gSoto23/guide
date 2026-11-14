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

  it("never leaks internal error details", () => {
    const problem = toProblem(new Error('relation "secret_table" does not exist'));
    expect(problem).toEqual({
      type: "https://guidesk.app/problems/internal_error",
      title: "Internal error",
      status: 500,
      code: "internal_error",
    });
  });
});
