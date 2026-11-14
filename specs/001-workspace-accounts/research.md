# Research: Workspaces, Accounts, Roles and Invitations

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-14

Each decision lists what was chosen, why, and the alternatives considered. Vendor-level
decisions are recorded as ADRs, both accepted by the founder on 2026-11-14:
[ADR-0008](../../docs/architecture/adr/0008-authentication-better-auth.md) (authentication) and
[ADR-0009](../../docs/architecture/adr/0009-mvp-hosting-and-transactional-email.md) (AWS hosting
and email).

**Context update 2026-11-14:** the founder decided that Guidesk runs on **AWS**. R2, R4, R7, R9,
R10, and R15 reflect that decision.

## R1. Authentication library

- **Decision:** Better Auth (open source, self-hosted, TypeScript). Use core sessions plus:
  - the email one-time-code plugin (`emailOTP`) for passwordless email sign-in;
  - the Google social provider;
  - the passkey plugin (`@better-auth/passkey`), with user verification required;
  - the two-factor plugin (`twoFactor`) for authenticator-app codes and backup codes.

  Passwords stay disabled (FR-001).
- **Rationale:**
  - **Data stays in our PostgreSQL**, so memberships and RLS policies join users directly.
    Removing a member applies at once (FR-025, SC-006), and no third party holds host
    identities (SEC-19 subprocessor list).
  - **No per-user or per-organization fees** as workspaces grow.
  - **It covers every sign-in requirement** in the spec through maintained plugins.
- **Alternatives considered:**
  - **Clerk:** hosted and fast to integrate. Its free plan reportedly covers 50,000 monthly
    retained users after a February 2026 change, but MFA and passkeys sit on Pro (about $25 per
    month), and organizations beyond 100 per app cost extra (third-party sources; verify at
    clerk.com/pricing). Identities would live outside our database and reach RLS only through
    webhook sync, which is eventually consistent. Rejected for tenancy coupling and cost at scale.
  - **Auth.js:** weaker passkey, OTP, and two-factor support out of the box.
  - **Supabase Auth or WorkOS:** add another platform or vendor without a clear benefit here.
- **Sources:** [Better Auth plugins](https://better-auth.com/docs/plugins) ·
  [session management](https://better-auth.com/docs/concepts/session-management) ·
  [Clerk pricing explained](https://clerk.com/articles/clerk-pricing-explained)

## R2. Where authentication runs, and the origin model

- **Decision:**
  - Better Auth runs inside the API (NestJS on Fastify). It is mounted at `/api/auth/*` with the
    library's framework-agnostic request handler, not the beta NestJS-Fastify wrapper.
  - CloudFront serves the portal and routes `/api/*` to the API's load balancer, so the browser
    talks only to the portal's origin.
  - Cookies are host-only, `Secure`, `HttpOnly`, and `SameSite=Lax`. The library's trusted
    origins are set to the portal origin.
- **Rationale:**
  - Keeps cookies first-party and host-only (SEC-11) while the API stays a separate service.
  - Avoids depending on the beta wrapper; Better Auth's docs mark its NestJS Fastify support as
    beta.
- **Alternatives considered:**
  - **Auth inside the Next.js portal:** splits identity logic from the API that enforces
    permissions.
  - **A shared parent-domain cookie (`.domain`):** contradicts SEC-11.
  - **Next.js rewrites as the proxy:** works, but it adds a Lambda hop on every API call.
    CloudFront path routing is cheaper and faster.
- **Source:** [Better Auth NestJS integration (v1.6)](https://better-auth.com/docs/1.6/integrations/nestjs)

## R3. Tenancy model

- **Decision:** Workspaces, memberships, and invitations are Guidesk domain tables in the
  Identity and Tenancy module. Better Auth's organization plugin is not used. Roles are `owner`,
  `admin`, and `agent`. The permission matrix (spec FR-016) is a single policy map in code, and
  RLS enforces it again in the database.
- **Rationale:**
  - Constitution, Principle IV: the domain must not depend on a provider. Tenancy is core domain
    and sits behind `AuthProviderPort` only for identity.
  - We need rules the plugin does not model directly: exactly one owner, the seat limits from
    feature 011, step-up checks, the MFA threshold, and security events.
- **Alternative considered:** the organization plugin. Less code, but it couples the core domain
  to the auth library's tables and lifecycle.

## R4. Row-level security

- **Decision:**
  - The application connects as a role without `BYPASSRLS`. Each request runs in a transaction
    that sets `app.user_id` (and `app.workspace_id` for workspace routes) with `SET LOCAL`.
  - Policies:
    - membership rows are visible to their own user;
    - workspace-scoped rows are visible when a membership exists for the current user;
    - writes are additionally limited by role.
  - Invitation acceptance by token runs through a `SECURITY DEFINER` function that checks the
    token hash, the expiry, and that the verified email matches.
  - RLS is enabled and forced on every tenant table. A migration check fails CI if a table with
    `workspace_id` lacks it (SEC-14).
- **Rationale:** a second, independent layer of isolation (constitution, Principle VI). `SET
  LOCAL` is transaction-scoped, so pooled connections never leak a previous request's context.
  The Fargate services keep their own connection pools to RDS; no RDS Proxy is needed because
  the Next.js apps never connect to the database.
- **Alternatives considered:**
  - **Application checks only:** one bug leaks data.
  - **A schema per tenant:** heavy to operate for one developer.

## R5. Step-up re-authentication

- **Decision:**
  - A Guidesk `session_assurance` record stores `strong_auth_at` and the method per session.
  - A re-authentication endpoint verifies one of: a passkey assertion, an authenticator-app code,
    or a fresh email one-time code. It then updates `strong_auth_at`.
  - A guard on sensitive endpoints (spec FR-011) requires `strong_auth_at` within the last 10
    minutes. Otherwise it returns `step_up_required` with the allowed methods.
- **Rationale:**
  - Better Auth's `freshAge` is based on session creation time (since 1.6), so it can only say
    "you signed in recently", not "you re-verified just now".
  - The spec's 10-minute window applies per action. A small custom guard is clearer and easy to
    test.
- **Alternative considered:** setting `freshAge` to 10 minutes and forcing a full new sign-in.
  Rejected: it signs users out of their session context and is heavier on mobile.

## R6. MFA requirement and threshold

- **Decision:**
  - A policy function `requiresMfa(user, workspace)` returns true when the user is Guidesk staff,
    or holds `owner` or `admin` in a workspace with more than 2 properties.
  - A passkey sign-in with user verification satisfies MFA by itself. Email-code and Google
    sign-ins must add a passkey or an authenticator-app code.
  - Enforcement happens at sign-in (prompt) and on every sensitive action (block until
    enrolled).
  - The property count comes from feature 002. Until then the count is 0, so the threshold never
    triggers.
- **Rationale:** matches NFR-13 and SEC-05 without blocking small hosts. Passkeys are
  phishing-resistant.

## R7. Sessions, devices, and approximate location

- **Decision:**
  - Sessions live in the database. The library's cookie cache is disabled, or limited to 60
    seconds, so revocation and member removal apply within 1 minute (FR-025).
  - Lifetimes: 7 days idle and 30 days absolute (a check on the session's creation time).
  - **New-device detection:** a random, long-lived, `HttpOnly` device cookie. A sign-in without a
    device cookie known for that user counts as a new device and triggers the alert email
    (FR-012). Only the device ID's hash is stored.
  - **Approximate location:** CloudFront adds viewer location headers (country, region, city)
    through an origin request policy on the `/api/*` behavior. CloudFront also sends an internal
    secret header that the API requires before trusting them. Store city and country only, plus
    a hashed IP.
- **Rationale:** meets FR-012, FR-013, and FR-015 with no geolocation vendor and minimal personal
  data (SEC-20).
- **Alternative considered:** a MaxMind GeoLite2 database in the API. It adds a data file to
  update, and the edge already provides the data.

## R8. Rate limiting and lockouts

- **Decision:**
  - Use Better Auth's built-in rate limiter for its endpoints, with database storage.
  - Add Guidesk limits in PostgreSQL:
    - one-time code sends: 5 per hour per email and 20 per hour per IP;
    - code and authenticator verifications: 5 failures, then a 15-minute lockout, with an email
      notice to the user;
    - invitation sends: 20 per hour per workspace, and 3 resends per invitation per day.
  - Responses are identical for existing and unknown emails (AC-SEC-007).
- **Rationale:** FR-014 and AC-SEC-001/008 without Redis (performance doc §4).
- **To verify during implementation:** the storage options of the library's rate limiter. If
  database storage is not available, our PostgreSQL limiter covers the auth endpoints too.

## R9. Transactional email

- **Decision:**
  - **Amazon SES** (the AWS decision), with a configuration set for one-time codes and security
    alerts. Sending happens from the worker queue, except one-time codes, which are sent inline
    from the API for speed.
  - **Deliverability:** SPF, DKIM, and DMARC on the sending domain; production access requested
    before the pilot; bounces and complaints handled through SES notifications.
  - **Templates:** React Email, in Spanish and English.
  - **Port:** behind `NotificationPort` (`EmailAdapter`), with a Postmark adapter kept as the
    fallback.
  - **Local development:** Mailpit in Docker Compose.
- **Rationale:** sign-in depends on codes arriving within seconds (SC-001). SES is native to the
  chosen cloud (IAM, one bill, low cost). React Email keeps templates provider-independent, so
  switching to Postmark is a configuration change if SES misses the delivery target.
- **Alternatives considered:**
  - **Postmark:** strong transactional reputation; the fallback.
  - **Resend:** excellent developer experience, but another vendor outside AWS.
- **Pricing:** see ADR-0009 and the budget in `docs/presentation/`.

## R10. Hosting and regions

- **Decision (AWS, `us-east-1`):**
  - CloudFront with AWS WAF in front of everything.
  - The portal (and later the guest guide) on OpenNext: Lambda and S3, deployed with SST.
  - The API and worker as two ECS Fargate services behind an Application Load Balancer.
  - Amazon RDS for PostgreSQL 16: single-AZ for the pilot, Multi-AZ before the public launch,
    with point-in-time recovery (SEC-17).
  - Infrastructure as code with SST v3 (TypeScript), with stages for `dev`, `staging`, and
    `production`.
- **Rationale:** the founder chose AWS. This design keeps one region (performance doc §4), the
  static-first guide on the CDN (performance doc §2), one browser origin (SEC-11), and native
  KMS, WAF, SES, and S3.
- **Risks:**
  - Fixed idle costs: load balancer, NAT gateway, RDS, and Fargate. VPC endpoints reduce NAT
    traffic. The budget shows the totals.
  - No database branches per pull request: previews share the staging database.
  - SST is a third-party tool; AWS CDK is the fallback.
- **Alternatives considered:** Amplify Hosting for Next.js (less control over routing and the
  WAF setup), Lambda for the API (cold starts and a poor fit for the pg-boss worker), App Runner
  (fewer networking controls), and Aurora Serverless v2 (higher minimum cost for the pilot).
- **Sources:** [SST components](https://sst.dev/docs/components/) ·
  [SST Next.js on AWS](https://sst.dev/docs/start/aws/nextjs)

## R11. Security log

- **Decision:**
  - A `security_event` table, partitioned by month. The application role has `INSERT` and
    `SELECT` only, and a trigger rejects `UPDATE` and `DELETE`.
  - Event types and fields are listed in [data-model.md](data-model.md).
  - No secrets or one-time codes are ever stored in events.
  - Retention: 24 months, pending the legal review (OQ-35).
- **Rationale:** FR-030 and SEC-16.

## R12. Workspace deletion, account deletion, and export

- **Decision:**
  - **Workspace deletion** sets `deleted_at` and `purge_after` (+30 days). A daily worker job
    hard-deletes expired workspaces. Restore clears both fields.
  - **Account deletion** follows the same pattern. Security events keep the record with the
    actor pseudonymized.
  - **Personal-data export** is an on-demand JSON download after step-up. It is small enough
    that no object storage is needed.
- **Rationale:** FR-027 and FR-028 with the simplest moving parts.

## R13. Internationalization

- **Decision:** `next-intl` in the portal, ES and EN message catalogs in `packages/i18n`, and
  email templates rendered in the user's preferred language. Language comes first from the
  user's setting, then from the browser's `Accept-Language` header.
- **Rationale:** constitution, Principle IX, and FR-031.

## R14. Testing

- **Decision:**
  - **Unit (Vitest):** the policy matrix, `requiresMfa`, step-up windows, and the invitation
    state machine.
  - **Integration:** Vitest plus Testcontainers PostgreSQL, covering RLS cross-tenant tests
    (AC-SEC-004), the invitation acceptance function, removal propagation, and the append-only
    security log.
  - **Contract:** the `EmailAdapter` against recorded SES responses (and the Postmark fallback).
  - **End to end (Playwright):** sign-up with Mailpit capturing codes; passkeys through
    Chromium's virtual WebAuthn authenticator; invitations; and workspace switching with timing
    (SC-007).
- **Rationale:** constitution, Principle V. Agent evals don't apply (no agent changes).

## R15. Encryption keys (KMS)

- **Decision:** the KMS is **AWS KMS** (ADR-0009), but this feature does not use it yet: no
  restricted property values are stored. Authenticator-app secrets are encrypted by the auth
  library with a secret kept in Secrets Manager. The per-workspace data keys for SEC-06 arrive
  with the first feature that stores restricted property values (003 or 004).
- **Rationale:** YAGNI (constitution, Principle VII), without weakening SEC-06 when it applies.

## R16. Foundations delivered with this feature

- **Decision:** this plan also sets up the monorepo and CI described in ADR-0004, because feature
  001 is the first code:
  - pnpm, Turborepo, and strict TypeScript;
  - GitHub Actions with the SEC-12 controls;
  - Lighthouse CI and the bundle-size check;
  - the RLS migration check;
  - OpenTelemetry and Sentry with personal-data scrubbing.
- **Rationale:** the roadmap's "Foundations" step is folded into spec 001's plan, as agreed.
