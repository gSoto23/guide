---

description: "Task list for feature 001: workspaces, accounts, roles and invitations"
---

# Tasks: Workspaces, Accounts, Roles and Invitations

**Input**: Design documents from `/specs/001-workspace-accounts/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. The constitution (Principle V) mandates test-first. Within each story, test
tasks come first and must fail before the implementation tasks start.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested
on its own.

> **Gate cleared:** [ADR-0008](../../docs/architecture/adr/0008-authentication-better-auth.md)
> and [ADR-0009](../../docs/architecture/adr/0009-mvp-hosting-and-transactional-email.md) were
> accepted on 2026-11-14 (plan, Constitution Check VII).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Include exact file paths in descriptions

## Path Conventions

This is a monorepo (see [plan.md](plan.md#project-structure)):

- `apps/portal`, `apps/api`, `apps/worker`
- `packages/*`
- `infra/` (SST)
- `e2e/` (Playwright)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo, tooling, CI, local services, and AWS infrastructure as code.

- [X] T001 Create the pnpm workspace and Turborepo config in `package.json`, `pnpm-workspace.yaml`, `turbo.json`, and `.nvmrc` (Node 24)
- [X] T002 [P] Create the shared TypeScript (strict), ESLint, Prettier, and Vitest presets in `packages/config/`
- [X] T003 [P] Scaffold the Next.js App Router portal with `next-intl` in `apps/portal/`
- [X] T004 [P] Scaffold the NestJS API on the Fastify adapter in `apps/api/src/main.ts`
- [X] T005 [P] Scaffold the worker with a pg-boss bootstrap in `apps/worker/src/main.ts`
- [X] T006 [P] Scaffold the packages `domain`, `db`, `contracts`, `integrations`, `emails`, `i18n`, and `ui` (each with `package.json` and `src/index.ts`) under `packages/`
- [X] T007 Create `docker-compose.yml` (PostgreSQL 16 and Mailpit) and `.env.example`, with variable names only and no values
- [X] T008 [P] Create the CI workflow in `.github/workflows/ci.yml`:
  - install with a frozen lockfile;
  - lint, type-check, unit tests, integration tests (PostgreSQL service container), and build;
  - actions pinned by SHA, with least-privilege `permissions` (SEC-12)
- [X] T009 [P] Configure supply-chain controls (SEC-12):
  - an `onlyBuiltDependencies` allowlist and a minimum release age of 3 days in `pnpm-workspace.yaml`;
  - `renovate.json`;
  - `.github/workflows/codeql.yml`
- [X] T010 [P] Create the SST app in `sst.config.ts` (stages `dev`, `staging`, `production`) and the stacks in `infra/` (ADR-0009):
  - `network.ts`: VPC, NAT, and VPC endpoints;
  - `database.ts`: RDS PostgreSQL 16, encrypted, with point-in-time recovery;
  - `services.ts`: ECS cluster, API and worker on Fargate, ALB;
  - `web.ts`: Next.js portal;
  - `edge.ts`: CloudFront routing `/api/*` to the ALB, WAF, and the origin request policy with viewer location headers and the internal secret header;
  - `email.ts`: SES identity and configuration set;
  - `secrets.ts`: Secrets Manager
- [X] T011 [P] Create the deploy workflow with GitHub OIDC roles (no long-lived keys) in `.github/workflows/deploy.yml`: staging deploys on `main`; production deploys manually


**Setup notes (2026-11-14):**

- **Versions:** pnpm 12.18, Turborepo 2.11, TypeScript 6.0, Next.js 16.4, React 19.3, NestJS 12.5,
  pg-boss 12, Vitest 5, ESLint 10, and SST 4.17.
  - TypeScript 7 was tried, but typescript-eslint does not support it yet, so TypeScript is pinned
    to 6.0.
  - pnpm 12 ships native binaries that corepack cannot run. Use `npx pnpm@12.18.0`, or install
    pnpm 12 globally.
- **Supply chain:** pnpm blocks dependency install scripts by default. The `allowBuilds` map in
  `pnpm-workspace.yaml` records each decision (`@parcel/watcher` and `@swc/core` are denied).
- **Next.js 16:** `middleware.ts` is now `proxy.ts`, so T026 uses `apps/portal/proxy.ts`.
- **T010 status:** the infrastructure type-checks against SST's generated platform types
  (`pnpm typecheck:infra`), but nobody has deployed it yet, because it needs the AWS accounts.
  Before the first deploy:
  - set the API and portal domains (production requires them, so CloudFront reaches the ALB over
    HTTPS);
  - add the edge shared-secret header and the viewer-location headers to the `/api` route, which
    the SST Router does not expose directly (research R7, T027);
  - add an S3 gateway endpoint when S3 arrives.
- **Not built yet:** the Dockerfiles are written, but no image has been built.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database, RLS, auth mount, errors, the security log, email, rate limiting,
observability, and test harnesses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T012 Set up Drizzle and the migration runner in `packages/db/drizzle.config.ts` and `packages/db/src/client.ts` (application role, pooled connections)
- [X] T013 Create the database roles migration in `packages/db/migrations/0000_roles.sql`: an application role without `BYPASSRLS`, and a separate migrator role
- [X] T014 Implement `withRlsContext(userId, workspaceId?)` in `packages/db/src/rls.ts`, which runs `SET LOCAL app.user_id` and `app.workspace_id` inside a transaction (research R4), with a unit test in `packages/db/test/rls.test.ts`
- [X] T015 [P] Implement the RLS migration check in `packages/db/scripts/lint-rls.ts`, exposed as `pnpm lint:rls` and run in CI. It fails when a table with `workspace_id` lacks `ENABLE` and `FORCE ROW LEVEL SECURITY`
- [X] T016 Configure Better Auth in `apps/api/src/auth/auth.ts` (ADR-0008):
  - Drizzle adapter;
  - `emailOTP` (10-minute expiry, single use);
  - Google provider;
  - passkey with `userVerification: required`;
  - `twoFactor` (TOTP and backup codes);
  - password sign-in disabled;
  - sessions: 7 days idle, cookie cache ≤ 60 s;
  - trusted origins limited to the portal origin;
  - rate limiting with database storage, if supported (research R8)
- [X] T017 Generate the auth schema with the Guidesk additional fields in `packages/db/src/schema/auth.ts` and `packages/db/migrations/0001_auth.sql`:
  - `user.preferred_language` enum `es|en`, `user.is_staff`, `user.last_workspace_id`, `user.deleted_at`, `user.purge_after`;
  - `session.device_id_hash`, `session.device_label`, `session.approx_location`
- [X] T018 Mount the Better Auth framework-agnostic handler on a Fastify catch-all route `/api/auth/*` in `apps/api/src/auth/auth.route.ts`
- [X] T019 [P] Define `AuthProviderPort` and implement `BetterAuthAdapter` in `packages/integrations/src/auth/`
- [X] T020 Implement the session guard in `apps/api/src/auth/session.guard.ts` (resolves the user and session) and the RLS interceptor in `apps/api/src/common/rls.interceptor.ts` (wraps each handler in `withRlsContext`)
- [X] T021 [P] Implement the problem+json exception filter with the error codes from [contracts/http-api.md](contracts/http-api.md#common-errors) in `apps/api/src/common/problem.filter.ts`, and the Zod validation pipe in `apps/api/src/common/zod.pipe.ts`
- [X] T022 [P] Create the security log in `packages/db/migrations/0002_security_event.sql`:
  - a table partitioned monthly;
  - `INSERT` and `SELECT` grants only;
  - a trigger rejecting `UPDATE` and `DELETE`.

  Add the event catalog enum in `packages/domain/src/security-events.ts` and the writer in `apps/api/src/security-log/security-log.service.ts` (data model §4)
- [X] T023 [P] Define `NotificationPort` and `EmailAdapter` in `packages/integrations/src/email/` and implement:
  - the SES adapter (AWS SDK v3);
  - the SMTP adapter for Mailpit;
  - the base React Email layout (ES/EN) in `packages/emails/src/layout.tsx`
- [X] T024 [P] Implement the PostgreSQL rate limiter: a `rate_limit` table in `packages/db/migrations/0003_rate_limit.sql` and the service in `apps/api/src/common/rate-limit.service.ts`
- [X] T025 [P] Set up OpenTelemetry and Sentry with allowlist-based personal-data scrubbing in `apps/api/src/observability.ts` and `apps/worker/src/observability.ts`
- [X] T026 [P] Create the ES and EN catalogs in `packages/i18n/messages/es.json` and `packages/i18n/messages/en.json`, and the locale proxy in `apps/portal/proxy.ts` (Next.js 16 renamed middleware) (user preference first, then `Accept-Language`)
- [X] T027 [P] Implement the edge header check in `apps/api/src/common/edge-headers.ts`: trust CloudFront viewer location headers only when the internal secret header matches (research R7)
- [X] T028 Implement the portal API client for same-origin `/api` calls in `apps/portal/lib/api.ts`
- [X] T029 Set up the test harnesses:
  - Testcontainers PostgreSQL in `apps/api/test/setup.ts`;
  - Playwright in `e2e/playwright.config.ts`;
  - a Mailpit helper in `e2e/helpers/mailpit.ts`;
  - a virtual WebAuthn authenticator helper in `e2e/helpers/webauthn.ts`

**Checkpoint**: Foundation ready. User stories can begin.


**Foundational notes (2026-11-14):**

- **Migrations:** drizzle-kit generates tables from `packages/db/src/schema/*.ts`. Roles, RLS,
  triggers, and partitions are custom SQL in the same journal:
  - `0000_roles`;
  - `0001_auth_and_rate_limit`, generated, which also holds T024's `rate_limit_bucket`;
  - `0002_security_event`;
  - `0003_auth_grants`, added for least privilege: `guidesk_app` cannot read identity secrets
    and only reads display fields of `user`.
- **RLS mechanics:** each request transaction runs `SET LOCAL ROLE guidesk_app` and sets
  `app.user_id` and `app.workspace_id`. Superusers and table owners therefore never bypass RLS
  inside a request.
  - The API still connects as the database owner.
  - Before production, give it a dedicated login role that is neither owner nor `BYPASSRLS`
    (defense in depth).
- **Better Auth 1.7:**
  - Identity IDs are app-generated UUIDs; `generateId: "uuid"` expects database defaults.
  - Auth route errors are caught and returned as a generic problem+json, so SQL never reaches
    clients.
- **Observability:** moved into a shared `@guidesk/observability` package used by the API and the
  worker. Sentry 11 has no `sendDefaultPii` option; scrubbing is the `beforeSend` allowlist.
- **Test harnesses:**
  - `@guidesk/testing` starts PostgreSQL with Testcontainers for the API suite. `packages/db`
    starts its own, to avoid a package cycle.
  - `e2e/` holds Playwright with the Mailpit and WebAuthn helpers. Browsers are not installed
    yet: run `pnpm --filter @guidesk/e2e exec playwright install chromium`.
- **Verified:** unit tests (27), integration tests (DB 7, API 6: email-code sign-in, an
  `HttpOnly`/`SameSite=Lax` session cookie, the guard, RLS as `guidesk_app`, the rate limiter),
  the RLS check (idempotent), lint, type-check, build, and infra type-check.
- **Open for deployment:**
  - how migrations run in AWS: a one-off ECS task before each deploy, because RDS is private;
  - Docker images not built yet (`pnpm deploy` of workspace packages to verify);
  - the provisional one-time code email is replaced by the template in T040.
- **Local:** `POSTGRES_PORT` overrides the Docker Compose port when 5432 is busy.

---

## Phase 3: User Story 1 - Sign up and get a workspace (Priority: P1) 🎯 MVP

**Goal**: A new person signs up with Google or an email one-time code, gets a workspace as owner,
answers up to three optional questions, and reaches the "create your first property" step.

**Independent Test**: Quickstart V1–V4. A new user signs up on a phone and reaches the first
property step as the owner of a new workspace.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T030 [P] [US1] Unit tests for onboarding path derivation ("`manager` when the bucket is `10_plus` or `3_10` with a PMS; otherwise `individual`") in `packages/domain/test/onboarding.test.ts`
- [X] T031 [P] [US1] Integration test: the first email-code sign-up creates exactly one workspace with an owner membership; an invitation sign-up creates none (FR-004, FR-020). In `apps/api/test/integration/signup.test.ts`
- [X] T032 [P] [US1] Integration test: Google sign-in with an existing email reaches the same account (FR-003). In `apps/api/test/integration/account-linking.test.ts`
- [X] T033 [P] [US1] Integration test: codes expire after 10 minutes and work once; responses are identical for existing and unknown emails (AC-SEC-007). In `apps/api/test/integration/otp.test.ts`
- [X] T034 [P] [US1] Contract tests for `GET /me`, `PATCH /me`, and `GET`/`PUT /me/onboarding` in `apps/api/test/contract/me.contract.test.ts`
- [X] T035 [P] [US1] End-to-end test of email sign-up, onboarding, and the first-property step (V1–V3) in `e2e/us1-signup.spec.ts`

### Implementation for User Story 1

- [X] T036 [P] [US1] Create the tenancy schema and RLS policies in `packages/db/src/schema/tenancy.ts` and `packages/db/migrations/0004_tenancy.sql`:
  - `workspace.name` "text, 1–80 characters";
  - `workspace.status` enum `active|pending_deletion`;
  - `membership.role` enum `owner|admin|agent`;
  - unique `(workspace_id, user_id)`;
  - a partial unique index for exactly one `owner`, plus a deferred check against zero owners
- [X] T037 [P] [US1] Create the `onboarding_profile` schema in `packages/db/src/schema/account.ts` and a migration:
  - `properties_bucket` enum `1_2|3_10|10_plus`, nullable;
  - `pms` enum including `none|other`;
  - `pms_other` "text ≤ 80, only when `pms = other`";
  - `country` ISO 3166-1 alpha-2;
  - `path` enum `individual|manager`
- [X] T038 [US1] Implement `createWorkspaceForNewUser` and `derivePath` in `packages/domain/src/tenancy.ts` and `packages/domain/src/onboarding.ts`
- [X] T039 [US1] Add the auth hook in `apps/api/src/auth/hooks.ts`: on first sign-up (not through an invitation), create a workspace named after the user plus the owner membership, and write `workspace.created`
- [X] T040 [US1] Implement the one-time code sender in `apps/api/src/auth/otp-sender.ts` and the template `auth.signin_code` (ES/EN) in `packages/emails/src/auth/signin-code.tsx`. Codes are sent inline from the API
- [X] T041 [US1] Implement the `/me` controller and service in `apps/api/src/account/me.controller.ts` and `apps/api/src/account/me.service.ts`, with Zod contracts in `packages/contracts/src/me.ts`
- [X] T042 [US1] Implement the onboarding endpoints in `apps/api/src/account/onboarding.controller.ts`
- [X] T043 [P] [US1] Build the portal auth pages (Google, email code entry, passkey sign-in) in `apps/portal/app/[locale]/(auth)/sign-in/page.tsx` and `apps/portal/app/[locale]/(auth)/verify/page.tsx`
- [X] T044 [P] [US1] Build the portal onboarding page (at most 3 questions, all skippable) in `apps/portal/app/[locale]/(app)/onboarding/page.tsx`
- [X] T045 [US1] Build the "create your first property" handoff page (the entry point for feature 002) in `apps/portal/app/[locale]/(app)/properties/new/page.tsx`
- [X] T046 [US1] Implement the aggregate onboarding report (aggregate only, FR-006) in `apps/api/src/account/onboarding-report.ts`

**Checkpoint**: US1 works on its own (sign-up to the first property step).


**US1 notes (2026-11-14):**

- **Migrations:** `0004_tenancy_and_onboarding` (generated) and `0005_tenancy_rls` (custom).
- **RLS model:** see [research R4](research.md#r4-row-level-security), implementation refinement.
  - Request handlers run as `guidesk_app`.
  - The caller's workspace role is derived in the database from their own membership row.
  - Explicit "system" policies give the owner connection full access (auth hooks, worker,
    `SECURITY DEFINER` functions).
  - Request handlers can never insert workspaces or memberships.
- **T031:** sign-ups that send the `x-guidesk-invitation` header get no workspace. US3 (T067,
  T075) validates the invitation token and adds the membership.
- **T032:** covered by an integration test that mocks Google's token endpoint. A real Google
  OAuth client is still needed for manual or staging checks.
- **T035:** the Playwright suite passed in mobile Chromium against the local API, portal,
  Postgres, and Mailpit (4 tests).
- **T040:** the provisional bilingual code email from Phase 2 was replaced by `auth.signin_code`
  (React Email), in the user's language or the request's `Accept-Language`.
- **T043–T045:** styling uses the provisional design tokens as CSS custom properties. Tailwind
  and shadcn/ui (ADR-0004) arrive with the shared UI package.
  - Pages are static.
  - Signed-out visitors are redirected client-side through `/api/v1/me`.
- **Verified:**
  - unit tests: 40;
  - integration tests: DB 15, API 23;
  - end to end: 4;
  - lint, type-check, and build.

---

## Phase 4: User Story 2 - Sign in securely and protect the account (Priority: P1)

**Goal**: Passkeys, the second-factor requirement above the threshold, 10-minute step-up,
new-device alerts, lockouts, and revocable sessions.

**Independent Test**: Quickstart V5–V9.

### Tests for User Story 2 ⚠️

- [X] T047 [P] [US2] Unit tests for `requiresMfa` (staff, or owner or admin with property count > 2) and the 10-minute step-up window in `packages/domain/test/security-policy.test.ts`
- [X] T048 [P] [US2] Integration test: 5 failed code or authenticator checks block attempts for 15 minutes and send `auth.lockout` (AC-SEC-001). In `apps/api/test/integration/lockout.test.ts`
- [X] T049 [P] [US2] Integration test: the step-up guard returns `step_up_required` after 10 minutes; verification updates `strong_auth_at` (FR-011). In `apps/api/test/integration/step-up.test.ts`
- [X] T050 [P] [US2] Integration test: the owner of a workspace with 3 properties (stubbed count) must enroll a second factor before a sensitive action (AC-SEC-005). In `apps/api/test/integration/mfa-threshold.test.ts`
- [X] T051 [P] [US2] Integration test: a revoked session is refused within 60 s; sessions end after 7 days idle and 30 days absolute (FR-013, FR-015). In `apps/api/test/integration/sessions.test.ts`
- [X] T052 [P] [US2] End-to-end test of passkey registration and sign-in (virtual authenticator) and the new-device email (V5, V7) in `e2e/us2-security.spec.ts`

### Implementation for User Story 2

- [X] T053 [P] [US2] Create the `session_assurance` and `known_device` schemas in `packages/db/src/schema/account.ts` and a migration:
  - `session_assurance.method` enum `passkey|totp|email_otp`;
  - `session_assurance.mfa_satisfied` bool;
  - `known_device` unique `(user_id, device_id_hash)`
- [X] T054 [US2] Implement `requiresMfa` and `isStepUpFresh(strongAuthAt, now)` (10 minutes) in `packages/domain/src/security-policy.ts`
- [X] T055 [US2] Define the property-count provider in `packages/domain/src/property-count.ts`. It returns 0 until feature 002 provides real counts
- [X] T056 [US2] Implement the step-up endpoints `POST /me/step-up/challenge` and `POST /me/step-up/verify` (passkey assertion, TOTP, email code) in `apps/api/src/auth/step-up.controller.ts`
- [X] T057 [US2] Implement the `@RequireStepUp()` and `@RequireMfa()` guards in `apps/api/src/auth/step-up.guard.ts` and `apps/api/src/auth/mfa.guard.ts`, and apply them to every route marked SU or MFA in the contract
- [X] T058 [US2] Implement device detection in `apps/api/src/auth/device.service.ts`: a random long-lived `HttpOnly` device cookie, a `known_device` upsert, and the new-device alert job with the template `auth.new_device` in `packages/emails/src/auth/new-device.tsx`
- [X] T059 [US2] Implement lockouts and rate limits for code and authenticator verification, with the template `auth.lockout`, in `apps/api/src/auth/lockout.service.ts`
- [X] T060 [US2] Add the 30-day absolute session lifetime check (from `createdAt`) to `apps/api/src/auth/session.guard.ts`
- [X] T061 [US2] Wire security events for sign-ins, factors, step-up, and sessions in `apps/api/src/auth/hooks.ts`
- [X] T062 [P] [US2] Build the portal security settings (passkeys, authenticator app and recovery codes, session list and revoke) in `apps/portal/app/[locale]/(app)/settings/security/page.tsx`
- [X] T063 [P] [US2] Build the step-up dialog and the MFA enrollment prompt in `apps/portal/components/step-up-dialog.tsx` and `apps/portal/components/mfa-prompt.tsx`
- [X] T064 [P] [US2] Create the template `auth.mfa_changed` in `packages/emails/src/auth/mfa-changed.tsx` and its worker job in `apps/worker/src/jobs/auth-notices.ts`

**Checkpoint**: US1 and US2 together form the minimal pilot-ready account system.


**US2 notes (2026-11-14):**

- **Migrations:** `0006_account_protection` (generated) and `0007_account_protection_grants`.
  `guidesk_app` has no access to these tables.
  - Two tables beyond the data model: `step_up_challenge` (email step-up codes, stored as HMACs)
    and `auth_lockout` (failure counters keyed by hashed email or user ID).
- **Step-up methods** (refines [research R5](research.md#r5-step-up-re-authentication)):
  - **Email code:** `/api/v1/me/step-up/{challenge,verify}`, within the same session.
  - **Passkey:** a fresh passkey sign-in, which creates a new session that is fresh and
    MFA-strength.
  - **TOTP:** Better Auth's `/two-factor/verify-totp` with the current session. Enabling 2FA
    rotates the session, and the hooks follow the new one.
  - Removing a second factor (`/two-factor/disable`, `/passkey/delete-passkey`) is checked for
    step-up in a Better Auth before hook.
- **MFA (FR-009):**
  - Better Auth asks for 2FA only on password sign-ins, so Guidesk enforces it: email and Google
    sessions start without MFA, and `@RequireMfa()` asks for a passkey or TOTP when the
    threshold applies.
  - `/me` now reports `requiresMfaIn`, and `mfa.enabled` is true with either a passkey or TOTP.
- **Lockout:** 5 failures in 15 minutes lock for 15 minutes.
  - Locked and unknown emails get the same 429.
  - Notices go only to existing accounts.
  - Better Auth's own IP rate limit is off when `NODE_ENV=test`.
- **Emails:** `auth.new_device`, `auth.lockout`, and `auth.mfa_changed` are rendered in the API
  and queued in pg-boss (`email.send`); the worker delivers them.
  - The first device of an account does not trigger an alert.
  - One-time codes stay inline.
- **Verified:**
  - unit tests: 54;
  - integration tests: DB 15, API 33 (step-up, MFA with real TOTP enrollment, lockout and its
    queued email, revoked, idle, and 30-day sessions, step-up before disabling 2FA);
  - end to end: 6, including passkey registration and sign-in with a virtual authenticator and
    the new-device email delivered through the worker to Mailpit.
- **Open:**
  - IP hashes are not yet recorded on security events.
  - The authenticator setup shows the secret as text; a QR code would need a QR library.

**Security review of the P1 scope (T103, 2026-11-14):** results in
[checklists/security.md](checklists/security.md). 26 findings (1 critical, 3 high, 10 medium,
12 low) were fixed or reduced, with regression tests in `apps/api/test/integration/security-review.test.ts`
and the existing suites. Changes that affect later tasks:

- **Factor changes:** `/two-factor/enable`, `/two-factor/disable`,
  `/two-factor/generate-backup-codes`, and passkey registration and deletion need step-up within
  10 minutes; once the user has a second factor, that step-up must use it
  (`SECOND_FACTOR_REQUIRED`). Enrolling the authenticator app no longer counts as MFA.
- **Disabled library endpoints:** `/two-factor/get-totp-uri`, the unused email-code flows, and
  `/update-user` (profile changes go through `PATCH /me`).
- **Sessions:** library rotations keep the original sign-in time and assurance; the 30-day limit
  is also enforced on `/api/auth/*`. Removing a factor revokes every other session.
- **Database:** migrations `0008_least_privilege` and `0009_totp_replay`. New tables get no
  default grants to `guidesk_app`: each migration must grant what request handlers need, and
  `pnpm lint:rls` fails on any reachable table without forced RLS. The API uses separate request
  and system pools. Tests run as a non-superuser owner.
- **Requests:** non-GET API calls must come from the portal origin; form bodies are rejected;
  portal and API send security headers, with a nonce-based CSP that makes portal pages render per
  request.
- **Infrastructure:** container secrets come from Secrets Manager (`valueFrom`), RDS requires TLS,
  and the API receives `PORTAL_URL`, email settings, and `TRUSTED_PROXY_HOPS`.
- **Verified:** unit tests 63; integration tests 66 (DB 20, API 46); end to end 6; lint,
  typecheck, build, format, `lint:rls`, and the infrastructure type check.
- **Re-run T103** after US3–US5 for AC-SEC-002, 003, 004, 006, 008, and 009; the open items are
  listed in §9 of the checklist.

---

## Phase 5: User Story 3 - Invite the team with roles (Priority: P2)

**Goal**: Owners and admins invite people by email with the `admin` or `agent` role. Acceptance
needs the matching verified email and never creates a workspace.

**Independent Test**: Quickstart V10–V12.

### Tests for User Story 3 ⚠️

- [X] T065 [P] [US3] Unit tests for the permission matrix (FR-016): admins never target the owner; agents cannot reveal restricted values. In `packages/domain/test/permissions.test.ts`
- [X] T066 [P] [US3] Unit tests for the invitation state machine (`pending` to `accepted`, `revoked`, or `expired`; resend keeps the expiry) in `packages/domain/test/invitation.test.ts`
- [X] T067 [P] [US3] Integration test: `accept_invitation` enforces the email match, single use, and expiry, and creates no workspace (AC-SEC-002, FR-019, FR-020). In `apps/api/test/integration/invitations.test.ts`
- [X] T068 [P] [US3] Integration test: the seat limit blocks invitations (FR-021) in `apps/api/test/integration/seat-limit.test.ts`
- [X] T069 [P] [US3] Contract tests for the invitation endpoints in `apps/api/test/contract/invitations.contract.test.ts`
- [X] T070 [P] [US3] End-to-end test: invite an agent, accept, and confirm the agent cannot invite (V10–V12). In `e2e/us3-invitations.spec.ts`

### Implementation for User Story 3

- [X] T071 [P] [US3] Create the `invitation` schema in `packages/db/src/schema/tenancy.ts` and a migration:
  - email normalized;
  - `role` enum `admin|agent`;
  - `token_hash`;
  - `status` enum `pending|accepted|revoked|expired`;
  - `expires_at` "created + 7 days";
  - unique pending invitation per workspace and email.

  Add the `accept_invitation(token_hash, user_id)` `SECURITY DEFINER` function and the RLS policies
- [X] T072 [US3] Implement the permission map and invitation rules in `packages/domain/src/permissions.ts` and `packages/domain/src/invitation.ts`
- [X] T073 [US3] Implement the seat-limit provider in `packages/domain/src/limits.ts` (configurable per workspace for the pilot; feature 011 later)
- [X] T074 [US3] Implement the invitation endpoints (create, list, resend, revoke) with step-up, MFA, rate limits, and an `Idempotency-Key` in `apps/api/src/tenancy/invitations.controller.ts`
- [X] T075 [US3] Implement the public invitation lookup and the acceptance endpoint in `apps/api/src/tenancy/invitation-accept.controller.ts`
- [X] T076 [US3] Add worker jobs for invitation emails, daily expiry, and the accepted notice in `apps/worker/src/jobs/invitations.ts`, with the templates `team.invitation` and `team.invitation_accepted` in `packages/emails/src/team/`
- [X] T077 [P] [US3] Build the portal members and invitations screen in `apps/portal/app/[locale]/(app)/settings/members/page.tsx`
- [X] T078 [P] [US3] Build the portal invitation acceptance page in `apps/portal/app/[locale]/(auth)/invite/[token]/page.tsx`
- [X] T079 [US3] Write security events for invitations (`invitation.sent`, `invitation.resent`, `invitation.accepted`, `invitation.revoked`, `invitation.accept_denied`) in `apps/api/src/tenancy/invitations.events.ts`

**Checkpoint**: Managers can build their team.

**US3 notes (2026-11-14):**

- **Migrations:** `0010_invitations` (generated: `invitation`, `workspace.seat_limit`),
  `0011_invitations_rls` (RLS, grants, `accept_invitation()`), and `0012_idempotency`
  (`idempotency_key`, system-only).
- **Where things landed:**
  - T070 lives in `e2e/specs/us3-invitations.spec.ts`, next to the other specs.
  - Guards: `@WorkspaceAction({ capability, stepUp, mfa })` in
    `apps/api/src/tenancy/workspace-access.guard.ts` checks membership (404 and a logged denial
    for non-members), then the role (403), then step-up and MFA, in that order.
  - `GET /workspaces/{workspaceId}/members` (read-only) was added for the team screen; role
    changes and removal stay in T092.
- **Decisions:**
  - `team.invitation` is sent inline by the API, like sign-in codes, so the link's token never
    sits in the job queue. If sending fails, the invitation is rolled back. `team.invitation_accepted`
    goes through the outbox and the worker.
  - A resend creates a new link and the old one stops working; the expiry stays the same.
  - The `x-guidesk-invitation` placeholder is gone. The public lookup sets an `HttpOnly`
    `guidesk.invite` cookie on `/api/auth`, and the sign-up hook skips creating a workspace only
    when that token belongs to a pending invitation for the same email. This also covers Google
    sign-ups, which the header could not (security review open item 7).
  - The invitation email names the inviter, or their email when they have no name. The public
    link preview shows the name only.
  - After signing in from a link, the portal returns to it (`sessionStorage`, limited to
    `/{locale}/invite/{token}` paths, so it can't become an open redirect).
  - Pilot seat limit: 10 per workspace unless Guidesk sets `workspace.seat_limit`.
- **Verified:** unit tests 80; integration tests 79 (DB 20, API 59, including the contract
  suite); end to end 8 (V10, V11, V12 added); lint, typecheck, build, format, and `lint:rls`.

---

## Phase 6: User Story 4 - Work across several workspaces (Priority: P2)

**Goal**: One account, several workspaces, a role per workspace, fast switching, and no data
mixing.

**Independent Test**: Quickstart V13–V14.

### Tests for User Story 4 ⚠️

- [ ] T080 [P] [US4] Cross-tenant integration suite in `apps/api/test/integration/cross-tenant.test.ts`: every workspace endpoint returns `404` for another workspace's IDs and logs `access.cross_workspace_denied` (AC-SEC-004)
- [ ] T081 [P] [US4] End-to-end test of switching in under 2 s, with data isolation (V13), in `e2e/us4-switching.spec.ts`

### Implementation for User Story 4

- [ ] T082 [US4] Implement `POST /workspaces` and `GET /workspaces/{workspaceId}` in `apps/api/src/tenancy/workspaces.controller.ts`
- [ ] T083 [US4] Implement `PUT /me/current-workspace` and the sign-in redirect to `last_workspace_id` in `apps/api/src/account/me.controller.ts`
- [ ] T084 [US4] Map RLS-hidden rows to `404 not_found` and log the denial event, in `apps/api/src/common/problem.filter.ts` and `apps/api/src/common/rls.interceptor.ts`
- [ ] T085 [P] [US4] Build the portal workspace switcher (at most two taps; the current workspace always visible) in `apps/portal/components/workspace-switcher.tsx`

**Checkpoint**: Co-hosts use one account across workspaces.

---

## Phase 7: User Story 5 - Manage members, ownership, and personal data (Priority: P3)

**Goal**: Role changes, removal, leaving, ownership transfer, workspace deletion and restore,
email change, data export, account deletion, and the security log views.

**Independent Test**: Quickstart V15–V19.

### Tests for User Story 5 ⚠️

- [ ] T086 [P] [US5] Integration test: a removed member is refused within 60 s in every session (SC-006). In `apps/api/test/integration/removal.test.ts`
- [ ] T087 [P] [US5] Integration test: the owner cannot leave; ownership transfer requires an admin target that satisfies MFA when required. In `apps/api/test/integration/ownership.test.ts`
- [ ] T088 [P] [US5] Integration test: workspace deletion sets `pending_deletion`, restore works, and the purge job runs after 30 days. In `apps/api/test/integration/workspace-deletion.test.ts`
- [ ] T089 [P] [US5] Integration test: account deletion is blocked while the user owns a workspace with members; the export contains the profile, memberships, and own events. In `apps/api/test/integration/account-lifecycle.test.ts`
- [ ] T090 [P] [US5] Integration test: `security_event` rejects `UPDATE` and `DELETE`. In `apps/api/test/integration/security-log.test.ts`
- [ ] T091 [P] [US5] End-to-end test of removal, the owner leaving, and deletion and restore (V15–V17) in `e2e/us5-lifecycle.spec.ts`

### Implementation for User Story 5

- [ ] T092 [US5] Implement the member role-change and removal endpoints (step-up and MFA; never the owner) in `apps/api/src/tenancy/members.controller.ts`, with the templates `team.member_removed` and `team.role_changed`
- [ ] T093 [US5] Implement the leave and ownership-transfer endpoints in `apps/api/src/tenancy/workspaces.controller.ts`, with the template `team.ownership_transferred`
- [ ] T094 [US5] Implement workspace deletion (`confirmName`) and restore, plus the purge job in `apps/worker/src/jobs/purge-workspaces.ts`, with the templates `workspace.deletion_scheduled` and `workspace.restored`
- [ ] T095 [US5] Create the `account_deletion_request` schema, implement `DELETE /me`, and add the purge job that pseudonymizes the actor in `security_event`, in `apps/worker/src/jobs/purge-accounts.ts`
- [ ] T096 [US5] Implement `GET /me/export` (JSON with the profile, memberships, and own security events) in `apps/api/src/account/export.service.ts`
- [ ] T097 [US5] Implement the email-change flow (`POST /me/email-change` and its confirmation, notices, and revoking other sessions) in `apps/api/src/account/email-change.controller.ts`, with the templates `account.email_change_code` and `account.email_changed`
- [ ] T098 [US5] Implement `GET /me/security-events` and `GET /workspaces/{workspaceId}/security-events` in `apps/api/src/security-log/security-log.controller.ts`
- [ ] T099 [P] [US5] Build the portal settings screens under `apps/portal/app/[locale]/(app)/settings/`:
  - workspace: rename, delete and restore, transfer ownership;
  - account: email change, export, deletion;
  - the security log viewer

**Checkpoint**: All five user stories are functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T100 [P] Configure Lighthouse CI budgets (LCP ≤ 2.5 s, CLS ≤ 0.1, with total blocking time as the lab proxy for INP) in `lighthouserc.json`, and add the CI job
- [ ] T101 [P] Add the bundle-size check (≤ 150 KB gzip per auth and onboarding route) in `apps/portal/bundle-budget.json`, and add the CI job
- [ ] T102 [P] Write the k6 script for auth and membership endpoints (p95 ≤ 300 ms) in `perf/k6/auth.js`
- [ ] T103 Review the implementation against AC-SEC-001 to AC-SEC-009 and the OWASP ASVS Level 2 authentication and session items, and record the result in `specs/001-workspace-accounts/checklists/security.md` (P1 pass done 2026-11-14; re-run after US3–US5)
- [ ] T104 [P] Add accessibility checks (axe in Playwright) for the auth, onboarding, and settings screens in `e2e/a11y.spec.ts`
- [ ] T105 Run the quickstart validation V1–V19 on staging and record the results in `specs/001-workspace-accounts/quickstart.md`
- [ ] T106 [P] Update the development setup in `README.md`, and update `docs/architecture/overview.md` if the implementation diverged from it

---

## Dependencies & Execution Order

### Phase Dependencies

- **Gate:** ADR-0008 and ADR-0009 accepted (done 2026-11-14).
- **Setup (Phase 1):** no other dependencies.
- **Foundational (Phase 2):** depends on Setup, and blocks every user story.
- **User stories (Phases 3–7):** depend on Foundational.
- **Polish (Phase 8):** after the stories in scope.

### User Story Dependencies

| Story | Depends on | Why |
|---|---|---|
| US1 (P1) | Foundational | First sign-up and workspace |
| US2 (P1) | US1 | Needs signed-in users |
| US3 (P2) | US1, US2 | Invitations need the step-up and MFA guards |
| US4 (P2) | US1 | A second workspace can come from `POST /workspaces`; US3 isn't required |
| US5 (P3) | US2, US3 | Needs the guards and members to manage |

### Within Each User Story

- Tests are written first and must fail.
- Then schema, domain, services and endpoints, and finally portal screens.
- Commit after each task or logical group, using Conventional Commits.

### Parallel Opportunities

- Phase 1: T002–T006 and T008–T011 in parallel after T001.
- Phase 2: T015, T019, and T021–T027 in parallel after T012–T014.
- Within each story, every test task marked [P] runs in parallel, and the portal screens run in
  parallel with the backend once the contracts exist.
- US4 can run in parallel with US3 after US2.

---

## Parallel Example: User Story 1

```bash
# Tests first, together:
T030 packages/domain/test/onboarding.test.ts
T031 apps/api/test/integration/signup.test.ts
T032 apps/api/test/integration/account-linking.test.ts
T033 apps/api/test/integration/otp.test.ts
T034 apps/api/test/contract/me.contract.test.ts
T035 e2e/us1-signup.spec.ts

# Then the schemas, together:
T036 packages/db/src/schema/tenancy.ts
T037 packages/db/src/schema/account.ts

# Portal pages in parallel with the API work:
T043 apps/portal/app/[locale]/(auth)/...
T044 apps/portal/app/[locale]/(app)/onboarding/page.tsx
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete US1, then validate V1–V4.
3. Complete US2, then validate V5–V9. Both P1 stories are required before any pilot host stores
   an access code (spec, US2 rationale).
4. **Stop and validate.** Deploy to staging and run the security review (T103) for the P1
   scope.

### Incremental Delivery

1. US3 (invitations): needed for the pilot's 3–5 managers.
2. US4 (several workspaces): can run in parallel with US3.
3. US5 (lifecycle and data): before the public launch. Manual handling is acceptable during the
   pilot.
4. Each story ships behind its checkpoint, with its quickstart scenarios passing.

### Summary

- **Total tasks:** 106.
- **By phase:** Setup 11, Foundational 18, US1 17, US2 18, US3 15, US4 6, US5 14, Polish 7.
- **MVP scope:** Setup, Foundational, US1, and US2 (64 tasks).
