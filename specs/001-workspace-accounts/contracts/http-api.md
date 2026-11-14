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
| `POST /me/step-up/challenge` | any | rate limit | `{ method }`; starts a passkey or email-code challenge | 200, 429 |
| `POST /me/step-up/verify` | any | rate limit | `{ method, response }`; returns `strongAuthAt` | 200, 403, 429 |
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
| `GET /workspaces/{workspaceId}/invitations` | ✓ | ✓ | — | — | Pending and recent invitations | 200 |
| `POST /workspaces/{workspaceId}/invitations` | ✓ | ✓ | — | SU, MFA, seat limit, rate limit | `{ email, role }`; 7-day expiry (FR-018, FR-021) | 201, 409 (already a member or pending), 422, 429 |
| `POST /workspaces/{workspaceId}/invitations/{invitationId}/resend` | ✓ | ✓ | — | rate limit | Expiry unchanged | 202, 410, 429 |
| `DELETE /workspaces/{workspaceId}/invitations/{invitationId}` | ✓ | ✓ | — | — | Revoke | 204, 410 |
| `GET /invitations/{token}` | **public** | | | rate limit | Workspace name, inviter display name, role, status only (AC-SEC-002) | 200, 410 |
| `POST /invitations/{token}/accept` | any signed-in user | | | email must match | Adds the membership; never creates a workspace (FR-019, FR-020) | 200, 403 (`email_mismatch`), 410 |

## Workspace security log

| Method and path | O | A | Ag | Purpose | Responses |
|---|---|---|---|---|---|
| `GET /workspaces/{workspaceId}/security-events` | ✓ | ✓ | — | Cursor-paginated events, filterable by type and date (FR-030) | 200, 403 |

## Cross-cutting guarantees

- **Isolation:** every workspace-scoped query runs under RLS. A guessed ID from another
  workspace returns `404 not_found` and writes `access.cross_workspace_denied` (AC-SEC-004).
- **CSRF:** cookie-authenticated state changes require same-origin requests (the library's
  origin checks plus `SameSite=Lax`).
- **Idempotency:** `POST` invitation and acceptance endpoints accept an `Idempotency-Key`
  header, so retries never double-send.
- **Agents and restricted values:** later features that reveal restricted values must reject
  the `agent` role and log `restricted_value.reveal_denied` (AC-SEC-009).
