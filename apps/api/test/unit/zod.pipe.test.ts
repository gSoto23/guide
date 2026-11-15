import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiProblem } from "../../src/common/problem.js";
import { ZodValidationPipe } from "../../src/common/zod.pipe.js";

describe("ZodValidationPipe (T021)", () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1).max(80) }));

  it("returns parsed data", () => {
    expect(pipe.transform({ name: "Casa Colibrí" })).toEqual({ name: "Casa Colibrí" });
  });

  it("throws validation_failed with field messages", () => {
    try {
      pipe.transform({ name: "" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiProblem);
      expect((error as ApiProblem).code).toBe("validation_failed");
      expect((error as ApiProblem).extra.fields?.name?.length).toBe(1);
    }
  });
});
