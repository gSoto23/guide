import { type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import { ApiProblem } from "./problem.js";

/** Validates a request body or query with a Zod schema from @guidesk/contracts (T021). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const fields: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      (fields[key] ??= []).push(issue.message);
    }
    throw new ApiProblem(422, "validation_failed", "Some fields are invalid.", { fields });
  }
}
