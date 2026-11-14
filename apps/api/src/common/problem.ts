import { HttpException } from "@nestjs/common";

/** Stable error codes from contracts/http-api.md (Common errors). */
export type ProblemCode =
  | "unauthenticated"
  | "forbidden"
  | "step_up_required"
  | "mfa_enrollment_required"
  | "not_found"
  | "conflict"
  | "gone"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  fields?: Record<string, string[]>;
  methods?: string[];
}

/** An application error rendered as application/problem+json (T021). */
export class ApiProblem extends HttpException {
  constructor(
    status: number,
    readonly code: ProblemCode,
    detail?: string,
    readonly extra: Pick<ProblemBody, "fields" | "methods"> = {},
  ) {
    super(detail ?? code, status);
  }
}
