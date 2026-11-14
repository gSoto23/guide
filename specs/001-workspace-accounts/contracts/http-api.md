# HTTP API Contract: Workspaces, Accounts, Roles and Invitations

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

The browser calls these endpoints only through the portal's origin (`/api/*`, proxied to the
API; research R2). Request and response bodies are JSON, validated with Zod schemas in
`packages/contracts`, which also generate the OpenAPI document. Errors use
`application/problem+json` with a stable `code`.

## Conventions

- **Auth:** a session cookie, set by the auth endpoints. Every endpoint below requires a session
  unless marked **public**.
- **Workspace scope:** workspace routes take `{workspaceId}` in the path. The API sets
  `app.user_id` and `app.workspace_id` for RLS (research R4).
- **Roles:** columns use **O** (owner), **A** (admin), and **Ag** (agent).
- **Step-up:** **SU** means the session must have re-authenticated within 10 minutes (FR-011).
  **MFA** means the caller must satisfy `requiresMfa` where it applies (FR-009).
- **Rate limits:** `429` responses carry `Retry-After` (research R8).

## Common errors

| HTTP | `code` | When |
|---|---|---|
| 401 | `unauthenticated` | No valid session |
| 403 | `forbidden` | The role does not allow the action |
| 403 | `step_up_required` | Re-authentication needed. The body lists `methods: ["passkey", "totp", "email_otp"]` |
| 403 | `mfa_enrollment_required` | The caller must enroll a second factor first |
| 404 | `not_found` | The resource does not exist **or belongs to another workspace** (AC-SEC-004; never 403) |
| 409 | `conflict` | For example: already a member, owner cannot leave, invalid transfer target, workspace owned with members |
| 410 | `gone` | Invitation expired, revoked, or already used |
| 422 | `validation_failed` | Invalid input, with a `fields` map |
| 429 | `rate_limited` | Too many requests |

## Authentication endpoints (Better Auth, mounted at `/api/auth/*`)

The library provides these. Exact paths follow the pinned library version, and contract tests
fix them in CI.

| Capability | Notes |
|---|---|
| Send an email one-time code | **Public.** Same response whether or not the email exists (AC-SEC-007). Limited to 5 per hour per email and 20 per hour per IP |
| Verify the email code and sign in or sign up | **Public.** Creates the user on first use. Locks out after 5 failures (AC-SEC-001) |
| Sign in with Google | **Public.** Links to an existing account with the same verified email (FR-003) |
| Register a passkey / sign in with a passkey | User verification required (R6) |
| Enroll or verify an authenticator app; generate backup codes | Two-factor plugin (FR-009, FR-010) |
| List and revoke sessions; sign out | FR-013 |

Adding or removing a sign-in factor (`/two-factor/enable`, `/two-factor/disable`,
`/two-factor/generate-backup-codes`, `/passkey/generate-register-options`,
`/passkey/verify-registration`, `/passkey/delete-passkey`) needs step-up within 10 minutes
(FR-010, FR-011, security review T103):

- otherwise these endpoints return `403` with `STEP_UP_REQUIRED`;
- once the user has a passkey or the authenticator app, the step-up must use one of them, or the
  endpoints return `403` with `SECOND_FACTOR_REQUIRED`;
- removing a factor revokes every other session.

Other library rules (T103):

- Only `type: "sign-in"` codes can be sent; they are limited to 5 per hour per email, with the
  same `429` for unknown emails.
- Guesses count toward the lockout only while a code is pending. Authenticator and recovery-code
  failures count toward the user lockout; a locked user gets `429`.
- Each authenticator code works once.
- Disabled (`404`): `/two-factor/get-totp-uri`, `/two-factor/send-otp`, `/two-factor/verify-otp`,
  the email-code password-reset, verify-email, and change-email flows, `/update-user` (use
  `PATCH /me`), `/link-social`, and `/unlink-account`.

Guidesk hooks on these endpoints:

- create the workspace and default onboarding profile on first sign-up (FR-004);
- run new-device detection (R7);
- write security events (data model §4).

## Account (`/api/v1/me`)

| Method and path | Roles | Guards | Purpose and body | Responses |
|---|---|---|---|---|
| `GET /me` | any | — | Profile, memberships (workspace ID, name, role, status), `lastWorkspaceId`, MFA status, `requiresMfaIn` (workspace IDs) | 200 |
| `PATCH /me` | any | — | `{ name?, preferredLanguage? }` | 200, 422 |
| `GET /me/onboarding` | any | — | Current answers | 200 |
| `PUT /me/onboarding` | any | — | `{ propertiesBucket?, pms?, pmsOther?, country?, skipped? }`; returns `path` (FR-005, FR-006) | 200, 422 |
| `PUT /me/current-workspace` | any | must be a member | `{ workspaceId }`; records the last used workspace (FR-024) | 204, 404 |
| `POST /me/step-up/challenge` | any | rate limit | `{ method: "email_otp" }`; emails a step-up code (passkey and TOTP step-up use `/api/auth/passkey/*` and `/api/auth/two-factor/verify-totp`) | 202, 429 |
| `POST /me/step-up/verify` | any | rate limit, lockout | `{ method: "email_otp", code }`; returns `strongAuthAt` | 200, 403, 429 |
| `POST /me/email-change` | any | SU | `{ newEmail }`; sends a code to the new address | 202, 409, 422 |
| `POST /me/email-change/confirm` | any | — | `{ code }`; notifies the old address; revokes other sessions (FR-029) | 200, 410 |
| `GET /me/export` | any | SU | JSON download of personal account data (FR-028) | 200 |
| `DELETE /me` | any | SU | Schedules deletion in 30 days | 202, 409 (owns a workspace with members) |
| `GET /me/security-events` | any | — | Own account events, cursor-paginated | 200 |

## Workspaces (`/api/v1/workspaces`)

| Method and path | O | A | Ag | Guards | Purpose and body | Responses |
|---|---|---|---|---|---|---|
| `POST /workspaces` | any user | | | — | `{ name }`; the caller becomes owner (FR-023) | 201 |
| `GET /workspaces/{workspaceId}` | ✓ | ✓ | ✓ | member | Workspace details | 200, 404 |
| `PATCH /workspaces/{workspaceId}` | ✓ | ✓ | — | — | `{ name }` | 200, 403, 404 |
| `DELETE /workspaces/{workspaceId}` | ✓ | — | — | SU, MFA | `{ confirmName }`; sets `pending_deletion`; notifies members (FR-027) | 202, 403, 422 |
| `POST /workspaces/{workspaceId}/restore` | ✓ | — | — | SU | Within 30 days | 200, 404, 410 |
| `POST /workspaces/{workspaceId}/ownership-transfer` | ✓ | — | — | SU, MFA | `{ membershipId }`; the target must be an admin and satisfy MFA if required | 200, 409 |
| `POST /workspaces/{workspaceId}/leave` | — | ✓ | ✓ | — | The owner gets 409 until ownership is transferred (FR-026) | 204, 409 |

## Members

| Method and path | O | A | Ag | Guards | Purpose and body | Responses |
|---|---|---|---|---|---|---|
| `GET /workspaces/{workspaceId}/members` | ✓ | ✓ | — | — | Members with role and join date | 200 |
| `PATCH /workspaces/{workspaceId}/members/{membershipId}` | ✓ | ✓ | — | SU, MFA | `{ role: "admin" or "agent" }`; never the owner's row (AC-SEC-003) | 200, 403, 404 |
| `DELETE /workspaces/{workspaceId}/members/{membershipId}` | ✓ | ✓ | — | SU, MFA | Removes the member; access ends within 60 s (FR-025) | 204, 403, 404 |

## Invitations

| Method and path | O | A | Ag | Guards | Purpose and body | Responses |
|---|---|---|---|---|---|---|
| `GET /workspaces/{workspaceId}/members` | ✓ | ✓ | — | — | Members with name, email, role, and join date (read-only in US3) | 200, 403, 404 |
| `GET /workspaces/{workspaceId}/invitations` | ✓ | ✓ | — | — | Open invitations and those from the last 30 days, plus `seats: { used, limit }` | 200 |
| `POST /workspaces/{workspaceId}/invitations` | ✓ | ✓ | — | SU, MFA, seat limit, rate limit | `{ email, role }`; 7-day expiry (FR-018, FR-021) | 201, 409 (`already_member`, `already_invited`, `seat_limit_reached`), 422, 429 |
| `POST /workspaces/{workspaceId}/invitations/{invitationId}/resend` | ✓ | ✓ | — | rate limit | Sends a new link (the old one stops working); expiry unchanged | 202, 410, 429 |
| `DELETE /workspaces/{workspaceId}/invitations/{invitationId}` | ✓ | ✓ | — | — | Revoke | 204, 410 |
| `GET /invitations/{token}` | **public** | | | rate limit | `{ workspaceName, inviterName, role, status: "pending" }` only (AC-SEC-002). Sets the `guidesk.invite` cookie (see below) | 200, 410 |
| `POST /invitations/{token}/accept` | any signed-in user | | | email must match | Adds the membership; never creates a workspace (FR-019, FR-020). Returns `{ workspaceId, role, result: "joined" or "already_member" }` | 200, 403 (`email_mismatch`), 410 |

Implementation notes (US3):

- Agents get `403 forbidden` on every row above except the two public-link rows; non-members get
  `404` and the attempt is logged (AC-SEC-004).
- Rate limits (research R8): 20 invitation emails per workspace per hour; 3 resends per
  invitation per day; 30 link lookups per IP per 10 minutes.
- Unknown, used, revoked, and expired links all answer `410 gone`, so a link reveals nothing
  about its state.
- **Sign-up from a link:** the lookup sets an `HttpOnly` cookie `guidesk.invite` (path
  `/api/auth`, 1 hour). A sign-up by email code or Google that carries it gets no workspace of
  its own, but only when the token belongs to a pending invitation for that same email; a forged
  cookie changes nothing. Acceptance clears the cookie.
- Both POST rows accept `Idempotency-Key` (8 to 100 characters). A repeated key returns the first
  response; a key still in progress answers `409 idempotency_conflict`; a key reused for another
  route answers `422 idempotency_conflict`.

## Workspace security log

| Method and path | O | A | Ag | Purpose | Responses |
|---|---|---|---|---|---|
| `GET /workspaces/{workspaceId}/security-events` | ✓ | ✓ | — | Cursor-paginated events, filterable by type and date (FR-030) | 200, 403 |

## Cross-cutting guarantees

- **Isolation:** every workspace-scoped query runs under RLS. A guessed ID from another
  workspace returns `404 not_found` and writes `access.cross_workspace_denied` (AC-SEC-004).
- **CSRF:** cookie-authenticated state changes require same-origin requests: the library's
  origin checks, `SameSite=Lax`, and, on the API's own routes, a refused request (`403`) when
  `Origin` or `Sec-Fetch-Site` shows another origin. Form-encoded bodies are rejected (`415`).
- **Headers:** every API response carries `Cache-Control: no-store`, `nosniff`, and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- **Idempotency:** `POST` invitation and acceptance endpoints accept an `Idempotency-Key`
  header, so retries never double-send.
- **Agents and restricted values:** later features that reveal restricted values must reject
  the `agent` role and log `restricted_value.reveal_denied` (AC-SEC-009).
