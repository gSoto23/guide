import { describeError } from "@guidesk/observability";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
  Optional,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SecurityLogService } from "../security-log/security-log.service.js";
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
  owner_must_transfer: "Transfer ownership first",
  target_not_admin: "The new owner must be an admin",
  target_mfa_required: "The new owner needs a second factor",
  owns_shared_workspace: "Owns a workspace with other members",
  email_in_use: "Email already in use",
  workspace_pending_deletion: "Workspace scheduled for deletion",
  plan_limit_reached: "Property limit reached",
  feed_limit_reached: "Calendar feed limit reached",
  duplicate_feed: "Calendar feed already added",
  refresh_too_soon: "Refreshed too recently",
  confirmation_mismatch: "The typed name does not match",
  feed_rejected: "Calendar link rejected",
  invalid_credential: "The PMS rejected the credential",
  extraction_limit_reached: "Daily extraction limit reached",
  provider_unavailable: "The PMS did not answer",
  section_changed: "The section changed since you opened it",
  not_ready_to_publish: "The property's core facts are not confirmed",
  locked_field_referenced: "A published version uses this locked field",
  interview_active: "An interview is already in progress",
  section_limit: "Section limit reached",
  item_limit: "Media limit for this section reached",
  text_too_long: "The section is too long",
  invalid_document: "The content has unsupported formatting",
  benefit_required: "Say whether you get a benefit from this business",
  wifi_only: "Only the Wi-Fi password can be public",
  shared_block_limit: "Shared block limit reached",
  storage_limit_reached: "Media storage limit reached",
  ai_limit_reached: "Daily AI limit reached",
  reveal_limit_reached: "Reveal limit reached",
  unavailable: "Guide not available",
  no_session: "No stay session",
  not_in_window: "Outside the stay window",
  verification_required: "Confirmation code required",
  invalid_code: "Wrong confirmation code",
  verification_locked: "Too many tries",
  guide_not_published: "Guide not published",
  stay_not_eligible: "Stay not eligible",
  message_too_long: "Message too long",
  chat_paused: "Chat paused",
  draft_closed: "Draft already handled",
  reply_warnings: "Reply needs review",
  settings_changed: "Settings changed meanwhile",
  time_zone_required: "Property time zone required",
  instructions_invalid: "Instructions can't be saved",
  tests_paused: "Too many tests",
  conversation_done: "Conversation already done",
  copilot_paused: "Too many copilot drafts",
  push_unavailable: "Push alerts aren't available",
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

/**
 * True for a database refusal caused by row-level security or missing grants (SQLSTATE 42501),
 * for example an insert into another workspace. Such a row is "not there" for the caller.
 */
export function isRlsDenial(exception: unknown): boolean {
  const e = exception as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42501" || e?.cause?.code === "42501";
}

export function toProblem(exception: unknown): ProblemBody {
  if (isRlsDenial(exception)) {
    // Never confirm that another workspace's row exists (AC-SEC-004, T084).
    return {
      type: "https://guidesk.app/problems/not_found",
      title: TITLES.not_found,
      status: 404,
      code: "not_found",
    };
  }
  if (exception instanceof ApiProblem) {
    const status = exception.getStatus();
    const { details, retryAfterSeconds: _retryAfter, ...extra } = exception.extra;
    return {
      // Details first, so they can never replace the standard members.
      ...details,
      type: `https://guidesk.app/problems/${exception.code}`,
      title: TITLES[exception.code],
      status,
      code: exception.code,
      // No detail when none was given, so every 404 has the same body (AC-SEC-004, T103).
      ...(exception.message !== exception.code ? { detail: exception.message } : {}),
      ...extra,
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

  constructor(@Optional() private readonly securityLog?: SecurityLogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const problem = toProblem(exception);
    if (problem.status >= 500) {
      this.logger.error(describeError(exception));
    }
    if (isRlsDenial(exception)) {
      void this.recordDenial(host.switchToHttp().getRequest<FastifyRequest>());
    }
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const retryAfter =
      exception instanceof ApiProblem ? exception.extra.retryAfterSeconds : undefined;
    if (retryAfter !== undefined) void reply.header("retry-after", String(Math.ceil(retryAfter)));
    void reply
      .status(problem.status)
      .header("content-type", "application/problem+json")
      .send(problem);
  }

  /** The database refused a row in the request's context: log it as a cross-workspace attempt. */
  private async recordDenial(request: FastifyRequest): Promise<void> {
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    await this.securityLog?.record({
      type: "access.cross_workspace_denied",
      outcome: "denied",
      actorUserId: request.auth?.user.id ?? null,
      workspaceId: params.workspaceId ?? null,
      metadata: {
        route: `${request.method} ${request.routeOptions.url ?? ""}`,
        source: "database",
      },
    });
  }
}
