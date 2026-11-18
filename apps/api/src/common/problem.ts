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
  | "internal_error"
  | "seat_limit_reached"
  | "already_member"
  | "already_invited"
  | "email_mismatch"
  | "idempotency_conflict"
  | "owner_must_transfer"
  | "target_not_admin"
  | "target_mfa_required"
  | "owns_shared_workspace"
  | "email_in_use"
  | "workspace_pending_deletion"
  // Feature 002 (contracts/http-api.md, Feature-specific errors).
  | "plan_limit_reached"
  | "feed_limit_reached"
  | "duplicate_feed"
  | "refresh_too_soon"
  | "confirmation_mismatch"
  | "feed_rejected"
  | "invalid_credential"
  | "extraction_limit_reached"
  | "provider_unavailable"
  // Feature 003 (contracts/http-api.md).
  | "section_changed"
  | "not_ready_to_publish"
  | "locked_field_referenced"
  | "interview_active"
  | "section_limit"
  | "item_limit"
  | "text_too_long"
  | "invalid_document"
  | "benefit_required"
  | "wifi_only"
  | "shared_block_limit"
  | "storage_limit_reached"
  | "ai_limit_reached"
  | "reveal_limit_reached"
  // Feature 004 (contracts/http-api.md).
  | "unavailable"
  | "no_session"
  | "not_in_window"
  | "verification_required"
  | "invalid_code"
  | "verification_locked"
  | "guide_not_published"
  | "stay_not_eligible"
  // Feature 005 (contracts/http-api.md).
  | "message_too_long"
  | "chat_paused"
  | "draft_closed"
  | "reply_warnings"
  // Feature 007 (contracts/http-api.md).
  | "settings_changed"
  | "time_zone_required"
  | "instructions_invalid"
  | "tests_paused"
  // Feature 006 (contracts/http-api.md).
  | "conversation_done"
  | "copilot_paused"
  | "push_unavailable"
  // Feature 008 (contracts/http-api.md).
  | "extra_changed"
  | "not_waiting"
  | "not_confirmed"
  | "not_requestable"
  | "rule_failed"
  | "duplicate"
  | "too_many_requests";

/**
 * Extra members of a problem body, such as `{limit, used}` or `{reason}`. Plain values only, and
 * never a restricted value (AC-SEC-008).
 */
export type ProblemDetails = Record<string, string | number | boolean | null | string[]>;

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  fields?: Record<string, string[]>;
  methods?: string[];
  [extra: string]: unknown;
}

export interface ProblemExtra {
  fields?: Record<string, string[]>;
  methods?: string[];
  /** Spread into the body, for example `{limit, used}` for `plan_limit_reached`. */
  details?: ProblemDetails;
  /** Sent as the `Retry-After` header. */
  retryAfterSeconds?: number;
}

/** An application error rendered as application/problem+json (T021). */
export class ApiProblem extends HttpException {
  constructor(
    status: number,
    readonly code: ProblemCode,
    detail?: string,
    readonly extra: ProblemExtra = {},
  ) {
    super(detail ?? code, status);
  }
}
