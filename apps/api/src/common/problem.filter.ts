import { describeError } from "@guidesk/observability";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ApiProblem, type ProblemBody, type ProblemCode } from "./problem.js";

const TITLES: Record<ProblemCode, string> = {
  unauthenticated: "Unauthenticated",
  forbidden: "Forbidden",
  step_up_required: "Re-authentication required",
  mfa_enrollment_required: "Second factor required",
  not_found: "Not found",
  conflict: "Conflict",
  gone: "Gone",
  validation_failed: "Validation failed",
  rate_limited: "Too many requests",
  internal_error: "Internal error",
  seat_limit_reached: "Seat limit reached",
  already_member: "Already a member",
  already_invited: "Already invited",
  email_mismatch: "Email does not match the invitation",
  idempotency_conflict: "Idempotency key conflict",
};

const CODE_BY_STATUS: Record<number, ProblemCode> = {
  400: "validation_failed",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "gone",
  422: "validation_failed",
  429: "rate_limited",
};

export function toProblem(exception: unknown): ProblemBody {
  if (exception instanceof ApiProblem) {
    const status = exception.getStatus();
    return {
      type: `https://guidesk.app/problems/${exception.code}`,
      title: TITLES[exception.code],
      status,
      code: exception.code,
      detail: exception.message,
      ...exception.extra,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? "internal_error" : "validation_failed");
    return { type: `https://guidesk.app/problems/${code}`, title: TITLES[code], status, code };
  }
  // Never leak internal details (stack traces, SQL) to clients.
  return {
    type: "https://guidesk.app/problems/internal_error",
    title: TITLES.internal_error,
    status: 500,
    code: "internal_error",
  };
}

/** Renders every error as application/problem+json (T021). */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger("ProblemFilter");

  catch(exception: unknown, host: ArgumentsHost): void {
    const problem = toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(describeError(exception));
    }
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    void reply
      .status(problem.status)
      .header("content-type", "application/problem+json")
      .send(problem);
  }
}
