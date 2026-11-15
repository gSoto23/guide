# Security Review: Workspaces, Accounts, Roles and Invitations

**Task**: T103 · **Feature**: [spec.md](../spec.md) · **Dates**: 2026-11-14 (P1), 2026-11-15 (US3–US5)

| | |
|---|---|
| **Scope** | First pass (2026-11-14): Setup, Foundational, US1 (sign-up and onboarding), US2 (secure sign-in). Second pass (2026-11-15): US3 (invitations), US4 (several workspaces), US5 (members, ownership, personal data) |
| **State reviewed** | Branch `001-workspace-accounts`, not deployed. Second pass on top of commit `a796b72` |
| **Baseline** | Spec abuse cases AC-SEC-001 to AC-SEC-009; OWASP ASVS 5.0 Level 2, chapters V3, V6, V7, V8 and V16; controls SEC-xx in the [security architecture](../../../docs/architecture/security.md) |
| **Result** | First pass: 26 findings (1 critical, 3 high, 10 medium, 12 low), all fixed or reduced. Second pass: 19 findings (1 high, 7 medium, 11 low). 17 fixed, 1 partly fixed (F-37), 1 tracked as an open item (F-45). Regression tests wherever testable. 10 open items remain before the pilot or production (§9) |

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
- **Second pass (US3–US5).**
  - Two independent read-only reviews: one of the database layer (migrations 0010–0014, RLS, `SECURITY DEFINER` functions, worker purges), one of the API and portal (guards, invitations, members, lifecycle, account, security log, idempotency).
  - Every finding was checked against the code before fixing.
  - Automated checks after the fixes: unit tests (87), integration tests (113: database 20, API 93, of which 12 in `security-review-us3-us5.test.ts`), 11 Playwright tests including the axe accessibility check, the RLS lint, the bundle-size check, Lighthouse CI, and a local k6 run.

**Legend:** ✅ met, with evidence · ⚠️ partly met, or the mechanism exists but the feature that uses it is not built · ⏳ deferred to a later story · ❌ open.

## 1. Abuse cases (spec)

| ID | Status | Evidence | Notes |
|---|---|---|---|
| AC-SEC-001 | ✅ | `lockout.test.ts`, `step-up.test.ts`, `security-review.test.ts` | Email sign-in codes, email step-up codes, authenticator codes, and recovery codes all count toward the lock (5 failures in 15 minutes lock for 15 minutes). The counter is atomic. The owner gets a notice email, at most one per hour |
| AC-SEC-002 | ✅ | `invitations.test.ts`, `us3-invitations.spec.ts` | Added with US3: another email gets `403 email_mismatch`, the invitation stays open for its owner, the attempt is logged as `invitation.accept_denied`, and the page shows only the workspace name. The public lookup returns only the workspace name, the inviter's display name, and the role. Second pass: an invitation works only while its inviter is still an owner or admin (`accept_invitation`, migration 0015) |
| AC-SEC-003 | ✅ | `removal.test.ts`, `ownership.test.ts`, `tenancy.test.ts` | Added with US5: admins can't change or remove the owner (refused with `403` and logged as `denied`), and only the owner can transfer ownership. RLS policies and the ownership functions refuse the same in the database. Second pass: every role refusal is logged as `access.role_denied`, including an admin attempting an owner-only action (`security-review-us3-us5.test.ts`) |
| AC-SEC-004 | ✅ | `cross-tenant.test.ts`, `tenancy.test.ts`, `us4-switching.spec.ts` | Added with US4: every workspace endpoint, and every resource ID from another workspace, answers the same `404` as a missing one and logs `access.cross_workspace_denied`. Database refusals (`42501`) are mapped to `404` and logged too. Second pass: both 404 bodies are byte-identical, and a foreign ID is logged in the owning workspace's log, so the caller can't read their own log to learn that a guessed ID exists |
| AC-SEC-005 | ⚠️ | `mfa-threshold.test.ts` | The MFA guard works, and enrolling a factor no longer counts as an MFA check. Door codes arrive in specs 002–003. No product route uses the guard yet |
| AC-SEC-006 | ✅ | `removal.test.ts`, `us5-lifecycle.spec.ts` | Added with US5: a removed member's every session loses the workspace on its next request, because the role is re-derived from the membership row in every transaction. Second pass: a removed, departing, or demoted admin's open invitations are revoked, and the database refuses them anyway. Non-owners get no request role while the workspace is pending deletion |
| AC-SEC-007 | ✅ | `otp.test.ts`, `lockout.test.ts`, `security-review.test.ts` | Same answer for known and unknown emails. Library endpoints that leaked timing (password reset, verify-email) are disabled. The per-email limit counts unknown emails too |
| AC-SEC-008 | ✅ | `lockout.test.ts`, `rate-limit.test.ts`, `invitations.test.ts` | Sign-in codes: 5 per hour per email and 20 per hour per IP. Step-up codes: 5 per hour per user. Invitations (US3): 20 emails per workspace per hour and 3 resends per invitation per day. Second pass: resends count toward the workspace limit; 5 invitation emails per address per day across all workspaces, so revoking and inviting again can't reset it; email-change codes are limited to 3 per hour per target address; IDs are canonicalized, so a different letter case can't open a new bucket |
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
| V7.4 Session termination | ✅ | Sign-out; revoking one session or all others; removing a factor ends every other session; an email change ends every other session (US5, FR-029); account deletion ends all of them |
| V7.5 Defenses against session abuse | ✅ | Re-authentication before sensitive changes. Changing the sign-in email and deleting the account need the second factor when the user has one, as factor changes do (V7.5.1, second pass). The session list shows device and approximate location. New-device alerts can no longer be suppressed with a crafted cookie |
| V7.6 Federated re-authentication | N/A | Google is used only to sign in; step-up uses Guidesk's own factors |

## 4. ASVS 5.0 Level 2: V8 Authorization (tenant isolation)

| Check | Status | Notes |
|---|---|---|
| RLS forced on every tenant table, on `user`, and on every table or partition `guidesk_app` can reach | ✅ | The CI lint (`pnpm lint:rls`) now also fails on grants without forced RLS, partitions included |
| Least privilege for request transactions | ✅ | `guidesk_app` can only rename a workspace (owner and admin), read memberships, manage its own onboarding answers, read security events through the parent table, and read user display fields (itself; workspace members for owners and admins). It cannot write memberships or security events, change workspace status, or touch rate-limit buckets. New tables get no default grants |
| Tests behave like production | ✅ | Migrations and tests run as a non-superuser owner. A superuser bypasses forced RLS and had hidden two policy gaps |
| Separation between request and system database access | ⚠️ | Requests still log in as the owner and switch to `guidesk_app` with `SET LOCAL ROLE`, so RLS protects only code that uses the request transaction. A separate request pool is in place (`DATABASE_APP_URL`); the dedicated login role is open (§9). The request context (`app.user_id`, `app.workspace_id`, `app.workspace_role`) is a set of settings that SQL running as `guidesk_app` could change itself. Exploiting that needs SQL injection, and none was found (F-45) |

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
| No secrets in logs or error reports | ✅ | Errors return a generic `problem+json`. Logs redact database query parameters. Sentry drops query strings, extra data, and breadcrumb payloads. OAuth callbacks and public invitation routes are not traced, and invitation tokens are replaced in reported URLs |
| Complete event records | ⚠️ | `ip_hash` is not recorded yet. OpenTelemetry client-address attributes must be scrubbed before trace export is turned on (§9). API-side events (member removed, left, role changed) are written outside the request transaction; they are logged only after the change matched a row, but a rollback at commit could still leave a success event (F-37, §9) |

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

**Second pass (US3–US5, 2026-11-15).** Regression tests are in `security-review-us3-us5.test.ts` unless noted.

| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| F-27 | High | IDs were accepted in any letter case. Each spelling opened a new rate-limit bucket (unlimited resends to one victim) and a new advisory lock (seat limit could be exceeded) | The workspace guard lowercases every UUID path parameter; limits key on stored row IDs; the lock casts to `uuid` | Letter-case resend test |
| F-28 | Medium | Invitation emails could flood one address: resends didn't count toward the workspace limit, and revoking and inviting again reset the per-invitation limit. Email-change codes could go to any address 5 times an hour | Resends count; 5 invitation emails per address per day across workspaces; 3 email-change codes per hour per target address | Revoke-and-reinvite test |
| F-29 | Medium | Changing the sign-in email or deleting the account accepted an email-code step-up even when the user had a passkey or authenticator app | `RequireStepUp({ secondFactor: true })`: the second factor is required when enrolled | Email change with TOTP enrolled |
| F-30 | Medium | A removed admin could rejoin through an invitation they had sent to another of their addresses | Open invitations are revoked when their sender is removed, leaves, or becomes an agent; `accept_invitation` also requires the inviter to still be an owner or admin | Removed-admin test (API and database backstop) |
| F-31 | Medium | Role refusals (403) weren't logged, so an admin's attempts at owner-only actions left no trace (AC-SEC-003) | `access.role_denied` event in the workspace guard | Owner-only action by an admin |
| F-32 | Medium | The invitation update policy allowed reopening revoked, expired, or accepted invitations, and resends without a new token | Policy limited to open invitations; a trigger allows only revoke, expire, or a resend with a new token and one more send | State-machine test as `guidesk_app` |
| F-33 | Medium | Account purge left invitations to the user's email, sign-in codes, and lockout and rate-limit counters. The pseudonym was `md5(user_id)`, and the raw ID stayed in the deletion request and in ownership-transfer metadata | Random pseudonym, also written to the deletion request and `new_owner` metadata; the leftover rows are deleted | Purge test |
| F-34 | Low | The database didn't stop non-owners' writes in a workspace pending deletion; only the guard did, before the transaction started | `app_membership_role()` gives non-owners no role while the workspace is pending deletion | Pending-deletion role test |
| F-35 | Low | An invitation accepted after the owner scheduled account deletion blocked the purge forever, silently. Purge and acceptance could interleave | Scheduling revokes open invitations in the user's workspaces; the purge locks those workspaces; acceptance locks the workspace row; skipped purges are logged | Scheduling test; the races themselves aren't reproduced |
| F-36 | Low | Seats were counted in two statements, so an acceptance in between was missed | One statement | `seat-limit.test.ts` still passes; the race itself isn't reproduced |
| F-37 | Low | Member events were logged as successes without checking that a row changed, and outside the request transaction | Removal, leaving, and role changes answer 404 when no row matched. ⚠️ Events and notice emails are still written outside the transaction (§9) | Existing `removal.test.ts`; the no-row case isn't reachable through the API |
| F-38 | Low | Idempotency keys were bound to the route pattern: reusing a key on another workspace, member, or body replayed the first response | The stored fingerprint is the method, exact path, and a hash of the body; a mismatch answers 422 | Idempotency test |
| F-39 | Low | A foreign ID was logged in the caller's own workspace log, which told the caller the ID existed elsewhere | Logged in the owning workspace's log | Foreign-ID test |
| F-40 | Low | The security log cursor dropped microseconds, so events in the same millisecond as a page's last row were skipped | The cursor carries the database timestamp with microseconds and compares `(occurred_at, id)` as a row | Same-millisecond paging test |
| F-41 | Low | Invitation tokens in URL paths could reach traces and error reports | Public invitation routes are not traced; tokens are replaced in reported URLs | `observability.test.ts` |
| F-42 | Low | The portal put the invitation token from the URL into API paths without checking it | Checked against the token format and encoded | End-to-end suite |
| F-43 | Low | A 404 from the application carried `detail: "not_found"`; a database refusal didn't | No detail unless one is given | Foreign-ID test (identical bodies) |
| F-44 | Low | A passkey step-up wasn't checked to belong to the same user | The portal compares the user after the passkey sign-in and signs out on a mismatch | Manual review (needs two passkeys on one device) |
| F-45 | Medium (defense in depth) | `guidesk_app` can change its own request context settings, and the request pool logs in as the owner | Not fixed: needs SQL injection to exploit, and none was found. Covered by the dedicated login role (§9, item 1) | — |

## 9. Open items

| # | Item | When |
|---|---|---|
| 1 | Give the request pool a dedicated login role that can only become `guidesk_app`, and keep the owner credentials for migrations only | Before production |
| 2 | Wire CloudFront to the API: origin header with the edge secret, viewer geo headers, the load balancer's security group limited to CloudFront, and HTTPS to the load balancer in every stage | Before the first deploy (T105) |
| 3 | Ship the RDS certificate bundle and switch to `sslmode=verify-full` | Before production |
| 4 | Record `ip_hash` on security events; scrub client addresses from traces before turning on OpenTelemetry export | Before the pilot |
| 5 | Decide how a user who loses every second factor and the recovery codes regains access (support-assisted, feature 015) | Founder decision, before the pilot |
| 6 | Attach `@RequireStepUp` / `@RequireMfa` to product routes as they land (AC-SEC-005, AC-SEC-009). The US3–US5 re-run is done (second pass) | Spec 002 |
| 7 | ~~An invited person who signs up with Google still gets a workspace.~~ Fixed in US3: the invitation token travels in an `HttpOnly` cookie and is checked against a pending invitation for the same email | Done (US3) |
| 8 | Validate every infrastructure change on staging | T105 |
| 9 | External penetration test | Before the public launch (SEC-19) |
| 10 | Write API-side security events and notice emails inside the request transaction (an outbox table), so a rollback at commit can't leave a success event or a sent notice (F-37) | Before the pilot |
