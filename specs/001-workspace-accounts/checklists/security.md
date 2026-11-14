# Security Review: Workspaces, Accounts, Roles and Invitations

**Task**: T103 · **Feature**: [spec.md](../spec.md) · **Date**: 2026-11-14

| | |
|---|---|
| **Scope** | P1 implementation: Setup, Foundational, US1 (sign-up and onboarding), US2 (secure sign-in). US3–US5 are not built yet |
| **State reviewed** | Branch `001-workspace-accounts`, uncommitted, not deployed |
| **Baseline** | Spec abuse cases AC-SEC-001 to AC-SEC-009; OWASP ASVS 5.0 Level 2, chapters V3, V6, V7, V8 and V16; controls SEC-xx in the [security architecture](../../../docs/architecture/security.md) |
| **Result** | 26 findings (1 critical, 3 high, 10 medium, 12 low). All 26 were fixed or reduced and have regression tests where testable; 9 open items remain before the pilot or production (§9) |

## Method

- **Three reviews.**
  - The main review.
  - Two independent adversarial code reviews: one of authentication and sessions, one of the data layer, worker, emails, portal, and infrastructure.
  - Library behavior was checked against the installed Better Auth 1.7.21 source, not assumed.
- **Automated checks.**
  - `pnpm audit --prod` and a secret scan of the repository.
  - The RLS lint.
  - Unit tests (63) and integration tests (66: database 20, API 46). The database tests now run as a non-superuser owner, like RDS.
  - 6 Playwright end-to-end tests on mobile Chromium against a production build of the portal.
- **Not covered.**
  - A deployed environment: nothing is deployed. Infrastructure changes were type-checked only.
  - A penetration test (SEC-19, before the public launch).
  - Features of US3–US5.

**Legend:** ✅ met, with evidence · ⚠️ partly met, or the mechanism exists but the feature that uses it is not built · ⏳ deferred to a later story · ❌ open.

## 1. Abuse cases (spec)

| ID | Status | Evidence | Notes |
|---|---|---|---|
| AC-SEC-001 | ✅ | `lockout.test.ts`, `step-up.test.ts`, `security-review.test.ts` | Email sign-in codes, email step-up codes, authenticator codes, and recovery codes all count toward the lock (5 failures in 15 minutes lock for 15 minutes). The counter is atomic. The owner gets a notice email, at most one per hour |
| AC-SEC-002 | ✅ | `invitations.test.ts`, `us3-invitations.spec.ts` | Added with US3: another email gets `403 email_mismatch`, the invitation stays open for its owner, the attempt is logged as `invitation.accept_denied`, and the page shows only the workspace name. The public lookup returns only the workspace name, the inviter's display name, and the role |
| AC-SEC-003 | ⚠️ | `tenancy.test.ts` | Request handlers cannot write memberships at all. The owner invariant (deferred trigger, now `SECURITY DEFINER`) and the one-owner index hold. Role and ownership endpoints come with US4 |
| AC-SEC-004 | ⚠️ | `tenancy.test.ts`, `mfa-threshold.test.ts` | RLS hides other workspaces even with a guessed ID. The MFA guard answers `404` and logs `access.cross_workspace_denied`. Workspace routes come with US4 |
| AC-SEC-005 | ⚠️ | `mfa-threshold.test.ts` | The MFA guard works, and enrolling a factor no longer counts as an MFA check. Door codes arrive in specs 002–003. No product route uses the guard yet |
| AC-SEC-006 | ⚠️ | `sessions.test.ts` | Sessions are read from the database on every request (no cookie cache), and the caller's role is re-derived in every transaction. The removal flow is US4 |
| AC-SEC-007 | ✅ | `otp.test.ts`, `lockout.test.ts`, `security-review.test.ts` | Same answer for known and unknown emails. Library endpoints that leaked timing (password reset, verify-email) are disabled. The per-email limit counts unknown emails too |
| AC-SEC-008 | ✅ | `lockout.test.ts`, `rate-limit.test.ts`, `invitations.test.ts` | Sign-in codes: 5 per hour per email and 20 per hour per IP. Step-up codes: 5 per hour per user. Invitations (US3): 20 emails per workspace per hour and 3 resends per invitation per day |
| AC-SEC-009 | ⏳ | — | No restricted values exist yet (spec 002 onward) |

## 2. ASVS 5.0 Level 2: V6 Authentication

| Section | Status | How it is met |
|---|---|---|
| V6.1 Documentation | ✅ | ADR-0008; research R1 and R5–R8; this checklist |
| V6.2 Password security | N/A | Sign-in is passwordless (FR-001). The library's password endpoints are disabled, so no password can be set |
| V6.3 General authentication security | ✅ | Lockout plus rate limits, keyed on a client IP the API derives itself from trusted proxy hops. MFA is available to everyone and required for staff and for owners and admins above the property threshold. Responses are consistent. There are no default accounts |
| V6.4 Factor lifecycle and recovery | ✅ ⚠️ | Adding or removing a passkey or the authenticator app, or regenerating recovery codes, needs a re-authentication within 10 minutes. If the user already has a second factor, that re-authentication must use it, so an email code alone cannot swap factors. Every change emails the owner, and a removal ends every other session. ⚠️ No procedure yet for a user who loses every second factor and the recovery codes (§9) |
| V6.5 General multi-factor requirements | ✅ | Each authenticator code and recovery code works only once (`used_totp_code`). Recovery codes are generated randomly and stored encrypted by the library. Failures lock the account |
| V6.6 Out-of-band (email codes) | ✅ | 6 digits, 10-minute expiry, single use, stored hashed, at most 5 guesses per code, rate-limited. An email code never counts as a second factor |
| V6.7 Cryptographic authentication (passkeys) | ✅ | User verification is required. The relying-party ID and origin are pinned to the portal. Challenges work once. Registration cannot start a new session |
| V6.8 Identity provider (Google) | ✅ ⚠️ | Accounts are linked only when Google reports a verified email; an unverified email can create no account. State and PKCE are handled by the library. ⚠️ Tested only against a mocked Google token endpoint |

## 3. ASVS 5.0 Level 2: V7 Session management

| Section | Status | How it is met |
|---|---|---|
| V7.1 Documentation | ✅ | FR-015; research R5–R7 |
| V7.2 Fundamental session security | ✅ | Sessions are server-side and checked against the database on every request. Tokens come from the library. Every sign-in creates a new session. A library rotation keeps the original sign-in time and assurance |
| V7.3 Session timeout | ✅ | 7 days idle and 30 days absolute. The cap is enforced by the API's session guard and on the library's own endpoints, and a rotation cannot reset it (`sessions.test.ts`, `security-review.test.ts`) |
| V7.4 Session termination | ✅ ⏳ | Sign-out; revoking one session or all others; removing a factor ends every other session. ⏳ An email change ending sessions comes with US5 (FR-029) |
| V7.5 Defenses against session abuse | ✅ | Re-authentication before sensitive changes. The session list shows device and approximate location. New-device alerts can no longer be suppressed with a crafted cookie |
| V7.6 Federated re-authentication | N/A | Google is used only to sign in; step-up uses Guidesk's own factors |

## 4. ASVS 5.0 Level 2: V8 Authorization (tenant isolation)

| Check | Status | Notes |
|---|---|---|
| RLS forced on every tenant table, on `user`, and on every table or partition `guidesk_app` can reach | ✅ | The CI lint (`pnpm lint:rls`) now also fails on grants without forced RLS, partitions included |
| Least privilege for request transactions | ✅ | `guidesk_app` can only rename a workspace (owner and admin), read memberships, manage its own onboarding answers, read security events through the parent table, and read user display fields (itself; workspace members for owners and admins). It cannot write memberships or security events, change workspace status, or touch rate-limit buckets. New tables get no default grants |
| Tests behave like production | ✅ | Migrations and tests run as a non-superuser owner. A superuser bypasses forced RLS and had hidden two policy gaps |
| Separation between request and system database access | ⚠️ | Requests still log in as the owner and switch to `guidesk_app` with `SET LOCAL ROLE`, so RLS protects only code that uses the request transaction. A separate request pool is in place (`DATABASE_APP_URL`); the dedicated login role is open (§9) |

## 5. ASVS 5.0 Level 2: V3 Web frontend and V4 API

| Check | Status | Notes |
|---|---|---|
| Session cookies | ✅ | `HttpOnly`, `Secure` over HTTPS, `SameSite=Lax`, host-only, `__Secure-` prefix |
| CSRF | ✅ | Better Auth checks the origin on its own routes. The API refuses state changes whose `Origin` or `Sec-Fetch-Site` is not the portal's own origin, and no longer parses form bodies (`415`) |
| Portal headers | ✅ | Nonce-based CSP with no `unsafe-inline` for scripts, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (passkeys allowed on the portal only), COOP, and HSTS in production. Pages render per request so every script gets the nonce (verified end to end) |
| API headers | ✅ | `nosniff`, `Cache-Control: no-store`, `default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, CORP, HSTS over HTTPS |
| Personal data in URLs | ✅ | The email being verified is kept in the tab's session storage instead of the `/verify` URL |

## 6. ASVS 5.0 Level 2: V16 Security logging and error handling

| Check | Status | Notes |
|---|---|---|
| Append-only security log | ✅ | Request transactions cannot write events or read partitions. Pseudonymization can only blank an actor or replace it with a `deleted:` value, never re-attribute events to another user |
| No secrets in logs or error reports | ✅ | Errors return a generic `problem+json`. Logs redact database query parameters. Sentry drops query strings, extra data, and breadcrumb payloads. OAuth callbacks are not traced |
| Complete event records | ⚠️ | `ip_hash` is not recorded yet. OpenTelemetry client-address attributes must be scrubbed before trace export is turned on (§9) |

## 7. Configuration, infrastructure and supply chain

| Check | Status | Notes |
|---|---|---|
| Vulnerability scan in CI (SEC-12) | ✅ | `pnpm audit --prod --audit-level high` added to CI. Today: 0 high or critical; 3 moderate and 1 low, all in build or test tooling or with no untrusted input (esbuild 0.18 via drizzle-kit, dev server only; glob and minimatch in tooling; deepmerge via html-to-text with fixed options) |
| No secrets in the repository | ✅ | Scan found only test fixtures. `.env` is ignored and `.env.example` holds no values |
| Container secrets | ✅ | Stored in Secrets Manager and injected with `valueFrom`; no longer plain environment variables in task definitions. The worker receives only the database password |
| Database connections | ✅ ⚠️ | Pools have connection, statement, and idle-transaction timeouts. RDS now requires TLS (`rds.force_ssl=1`). ⚠️ The certificate is not verified yet (`sslmode=no-verify`) |
| Edge protection | ❌ | CloudFront does not yet send the edge secret to the API. In production the API refuses every `/api` request, so it fails closed (§9) |

## 8. Findings and fixes

| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| F-01 | Critical | Anyone holding a session could fetch the authenticator secret (`/two-factor/get-totp-uri`), or generate fresh recovery codes, and then pass as MFA and step-up. They could also register their own passkey | `get-totp-uri` disabled. Factor changes need step-up with the existing second factor. Enrolling no longer counts as MFA | `security-review.test.ts` (unused endpoints; changing factors) |
| F-02 | High | About 10 concurrent signed-in requests could take every pool connection and then wait forever for a second one. The API hung and the health check stayed green | Separate request and system pools, with connection, statement, and idle-transaction timeouts | `security-review.test.ts` (burst of 40 requests) |
| F-03 | High | Library session rotations counted as fresh sign-ins and reset the 30-day limit. Library endpoints never checked the limit | Rotations keep the sign-in time and assurance. The limit is checked in the auth hook too | `security-review.test.ts` (rotation) |
| F-04 | High | Behind CloudFront every client shared one rate-limit bucket, and the per-IP key was client-controlled. The research R8 per-email limit was missing | The API derives the client IP from trusted proxy hops. Sign-in codes are limited to 5 per hour per email | `lockout.test.ts` (send limit) |
| F-05 | Medium | Authenticator and recovery-code failures were counted but never blocked, and sent no notice. Parallel guesses raced the counter, and a late failure could clear a lock | The user lock is checked before every second-factor check. Atomic counter, a 5-guess cap per step-up code, and the notice email | `security-review.test.ts` (lockout; parallel guesses) |
| F-06 | Medium | Unused email-code endpoints allowed timing enumeration, bypassed the lockout, and could set a password | Disabled. Only sign-in codes can be sent | `security-review.test.ts` |
| F-07 | Medium | Removing a factor left other sessions alive | Every other session is revoked | `security-review.test.ts` |
| F-08 | Medium | Google was a "trusted provider", so an unverified Google email could link to an existing account | Trust removed. Accounts require a verified email | `account-linking.test.ts` (unverified email refused) |
| F-09 | Medium | An empty device cookie suppressed the new-device alert | Malformed device IDs are replaced | `device-cookie.test.ts` |
| F-10 | Medium | Wrong guesses without any pending code could keep a victim locked out | Guesses count only while a code is pending | `lockout.test.ts` |
| F-11 | Medium | `guidesk_app` could read security-log partitions directly (no RLS), write rate-limit buckets, and insert events into any workspace | Privileges revoked; RLS lint extended to grants and partitions | `rls.test.ts`, `rls-check.test.ts` |
| F-12 | Medium | None of the SEC-11 headers were set | Portal and API headers, including the nonce-based CSP | `security-review.test.ts`; end-to-end suite |
| F-13 | Medium | Secrets were plain environment variables in ECS task definitions | Secrets Manager with `valueFrom`; the worker gets only what it needs | Infrastructure type check |
| F-14 | Medium | Owner login makes RLS opt-in, and pseudonymization could re-attribute events | Pseudonymization narrowed; separate request pool ready for a dedicated login. The login role is open (§9) | `rls.test.ts` |
| F-15 | Low | Admins could change a workspace's status through RLS | Column-level grant: rename only | `tenancy.test.ts` |
| F-16 | Low | Any request could read every user's email | RLS on `user` | `tenancy.test.ts` |
| F-17 | Low | The owner-invariant trigger ran under the caller's RLS | `SECURITY DEFINER` with a pinned search path | `tenancy.test.ts` |
| F-18 | Low | Database tests ran as a superuser, which bypasses forced RLS | Tests run as a non-superuser owner | All database and API integration tests |
| F-19 | Low | Logs and Sentry could carry query parameters, OAuth codes, or tokens | Scrubbing and redaction | `observability.test.ts` |
| F-20 | Low | Database traffic was plaintext; CloudFront reached the load balancer over HTTP without an API domain | RDS requires TLS (verification open). HTTPS to the load balancer needs the API domain in every stage (§9) | Infrastructure type check |
| F-21 | Low | A form-encoded POST from a same-site origin passed validation (CSRF) | Origin and `Sec-Fetch-Site` check; no form parser | `security-review.test.ts` |
| F-22 | Low | The email was in the `/verify` URL | Session storage | End-to-end suite |
| F-23 | Low | An authenticator code could be replayed within its validity window | Accepted codes are stored for 2 minutes and refused again | `mfa-threshold.test.ts` |
| F-24 | Low | CI had no vulnerability scan (SEC-12) | `pnpm audit` step | CI |
| F-25 | Low | The device service compared the edge secret in non-constant time | Constant-time comparison | `edge-headers.test.ts` |
| F-26 | Low | Infrastructure did not set `PORTAL_URL` or the email settings, so production emails would not be delivered | Set per stage | Infrastructure type check |

## 9. Open items

| # | Item | When |
|---|---|---|
| 1 | Give the request pool a dedicated login role that can only become `guidesk_app`, and keep the owner credentials for migrations only | Before production |
| 2 | Wire CloudFront to the API: origin header with the edge secret, viewer geo headers, the load balancer's security group limited to CloudFront, and HTTPS to the load balancer in every stage | Before the first deploy (T105) |
| 3 | Ship the RDS certificate bundle and switch to `sslmode=verify-full` | Before production |
| 4 | Record `ip_hash` on security events; scrub client addresses from traces before turning on OpenTelemetry export | Before the pilot |
| 5 | Decide how a user who loses every second factor and the recovery codes regains access (support-assisted, feature 015) | Founder decision, before the pilot |
| 6 | Attach `@RequireStepUp` / `@RequireMfa` to product routes as they land, and re-run this review after US3–US5 (AC-SEC-002, 003, 004, 006, 008, 009) | US3–US5, spec 002 |
| 7 | ~~An invited person who signs up with Google still gets a workspace.~~ Fixed in US3: the invitation token travels in an `HttpOnly` cookie and is checked against a pending invitation for the same email | Done (US3) |
| 8 | Validate every infrastructure change on staging | T105 |
| 9 | External penetration test | Before the public launch (SEC-19) |
