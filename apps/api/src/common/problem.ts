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
  | "provider_unavailable";

/**
 * Extra members of a problem body, such as `{limit, used}` or `{reason}`. Plain values only, and
 * never a restricted value (AC-SEC-008).
 */
export type ProblemDetails = Record<string, string | number | boolean | null>;

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
