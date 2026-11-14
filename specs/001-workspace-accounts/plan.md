# Implementation Plan: Workspaces, Accounts, Roles and Invitations

**Branch**: `001-workspace-accounts` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-workspace-accounts/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Hosts and managers sign up without passwords (Google, passkey, or an email one-time code) and get
a workspace in which they are the owner. They answer up to three onboarding questions, invite
teammates with roles, and switch between several workspaces.

Account protection:

- a second factor above the 2-property threshold;
- re-authentication within 10 minutes for sensitive actions;
- new-device alerts and revocable sessions;
- an append-only security log.

Technical approach:

- **Authentication:** Better Auth runs inside the NestJS API, behind the portal's same-origin
  proxy ([ADR-0008](../../docs/architecture/adr/0008-authentication-better-auth.md)).
- **Tenancy:** workspaces, memberships, and invitations are Guidesk domain tables, enforced by a
  policy map in code and by PostgreSQL RLS.
- **Email:** Amazon SES through `NotificationPort`, with React Email templates in ES and EN.
- **Hosting:** AWS in `us-east-1`: CloudFront and WAF, OpenNext on Lambda for the portal, ECS
  Fargate for the API and worker, RDS PostgreSQL, all defined with SST
  ([ADR-0009](../../docs/architecture/adr/0009-mvp-hosting-and-transactional-email.md)).

As the first code in the repository, this plan also delivers the monorepo foundations from
ADR-0004 ([research R16](research.md#r16-foundations-delivered-with-this-feature)).

## Technical Context

**Language/Version**: TypeScript 5.x (strict) on Node.js 24 LTS

**Primary Dependencies**:

- **Portal:** Next.js (App Router), `next-intl`
- **API:** NestJS with the Fastify adapter; Better Auth with the email-OTP, passkey, and
  two-factor plugins, plus the Google provider
- **Data:** Drizzle ORM and drizzle-kit, Zod (contracts)
- **Worker:** pg-boss
- **Email:** React Email and the AWS SDK v3 SES client
- **Infrastructure:** SST v3 (AWS)
- **Observability:** OpenTelemetry and Sentry

**Storage**: Amazon RDS for PostgreSQL 16 (`us-east-1`) with row-level security. Better Auth tables
are global; Guidesk tenant tables carry `workspace_id`.

**Testing**: Vitest (unit and integration), Testcontainers PostgreSQL, Playwright (end to end,
with a virtual WebAuthn authenticator), Mailpit for email capture, and contract tests for the
email adapter.

**Target Platform**:

- The portal is a mobile-first PWA in current mobile and desktop browsers, served by
  CloudFront with OpenNext on Lambda and S3.
- The API and worker run as Linux containers on ECS Fargate, behind an Application Load
  Balancer.

**Project Type**: Web application in a pnpm and Turborepo monorepo (portal, API, worker, shared
packages).

**Performance Goals**: See the [Performance Budget](#performance-budget). Sign-up to the first
property step takes under 2 minutes (median, SC-001). A workspace switch takes under 2 seconds
(SC-007).

**Constraints**:

- Host-only cookies, with one browser origin through the proxy (SEC-11).
- Member removal and session revocation take effect in 1 minute or less.
- No Redis (performance doc §4).
- No passwords.
- No restricted property values in this feature.

**Scale/Scope**:

- Year-1 design target: about 1,500 workspaces and about 3,000 users (derived from NFR-09's
  5,000 properties).
- About 12 portal screens (see the UX docs) and about 25 API endpoints
  ([contracts](contracts/http-api.md)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`ba9662b`); no open `[NEEDS CLARIFICATION]`; quality checklist passes | [x] |
| II. Platform Compliance | No `PC-xx` applies: host accounts only, no guest or OTA data (spec, Platform Policies) | [x] |
| III. Guest Trust and Human-in-the-Loop | No agent behavior in scope. Audit logging of account and team actions (FR-030) | [x] |
| IV. Channel-Agnostic Core | Identity is behind `AuthProviderPort` (Better Auth adapter) and email behind `NotificationPort` (SES adapter, Postmark fallback), each with contract tests. Tenancy stays in the domain (R3) | [x] |
| V. Test-First and Eval-Driven | Test layers in R14; tasks will list tests first. Evals not applicable (no agent changes) | [x] |
| VI. Security and Privacy | Spec Security Considerations mapped to SEC-05, SEC-11, SEC-14, SEC-16, and SEC-20 (R4–R8, R11). RLS forced on tenant tables with a CI check. No restricted property values; auth secrets in the platform secret store (R15) | [x] |
| VII. Simplicity | New libraries and services have accepted ADRs: Better Auth (ADR-0008) and the AWS service design (ADR-0009), both accepted on 2026-11-14. No Redis, no object storage in this feature | [x] |
| VIII. Observability | OpenTelemetry traces in API and worker, Sentry with personal-data scrubbing, security events in the database (R16, R11) | [x] |
| IX. International | ES and EN for portal and emails, language preference per user (R13). No currency or time-zone logic in this feature | [x] |
| Performance | Budget declared below; Lighthouse CI, bundle check, k6, and Playwright timing in CI | [x] |

**Result:** pass. ADR-0008 and ADR-0009 were accepted on 2026-11-14. No violations need
justification.

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Sign-up, sign-in, and onboarding pages | LCP at p75, mid-range mobile on 4G | ≤ 2.5 s | Lighthouse CI on preview deploys |
| Same pages | INP / CLS at p75 | ≤ 200 ms / ≤ 0.1 | Lighthouse CI, real-user monitoring |
| Same pages | Initial JavaScript per route | ≤ 150 KB gzip | Bundle-size check in CI |
| Auth and membership API endpoints (excluding email delivery) | Latency | p95 ≤ 300 ms | k6 against staging, OpenTelemetry |
| One-time code email | Request to queued / to inbox | ≤ 1 s / p95 ≤ 30 s | Integration test with Mailpit; provider metrics in production |
| Workspace switch | Tap to new workspace rendered | ≤ 2 s (SC-007) | Playwright timing |
| Member removal and session revocation | Time until access is refused | ≤ 60 s (SC-006) | Integration test |

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-accounts/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R16
├── data-model.md        # Phase 1: entities, RLS, state machines, event catalog
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── http-api.md      # Phase 1: REST endpoints, roles, step-up, errors
│   └── emails.md        # Phase 1: transactional emails
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks, not created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/
├── portal/                  # Next.js PWA for hosts (OpenNext on Lambda + S3, behind CloudFront)
│   ├── app/[locale]/(auth)/ # sign-up, sign-in, one-time code, invitation acceptance
│   ├── app/[locale]/(app)/  # onboarding, workspace switcher, members, security settings
│   └── next.config.ts       # Next.js config (CloudFront routes /api/* to the API)
├── api/                     # NestJS + Fastify (ECS Fargate)
│   ├── src/auth/            # Better Auth instance and mount, step-up guard, device detection
│   ├── src/tenancy/         # workspaces, memberships, invitations, policy map
│   ├── src/account/         # profile, onboarding, export, deletion, email change
│   ├── src/security-log/    # security event writer and readers
│   └── test/                # integration (Testcontainers) and contract tests
└── worker/                  # pg-boss jobs: emails, purges, invitation expiry
packages/
├── domain/                  # tenancy rules, roles, requiresMfa, invitation state machine
├── db/                      # Drizzle schema, migrations, RLS policies, migration RLS check
├── contracts/               # Zod schemas and OpenAPI for /api/v1
├── integrations/            # AuthProviderPort and NotificationPort, plus adapters
├── emails/                  # React Email templates (ES/EN)
├── i18n/                    # message catalogs
├── ui/                      # shared components
└── config/                  # tsconfig, eslint, vitest presets
infra/                       # SST stacks: VPC, CloudFront + WAF, Next.js, ECS, RDS, SES, secrets
sst.config.ts                # SST app entry (stages: dev, staging, production)
e2e/                         # Playwright specs (sign-up, passkey, invitations, switching)
docker-compose.yml           # local PostgreSQL and Mailpit
```

**Structure Decision**: This is the target layout from the
[architecture overview](../../docs/architecture/overview.md#8-repository-layout-target), limited
to what feature 001 needs. `apps/guide` and the `evals/` folder arrive with features 004 and
005. A separate `packages/emails` keeps templates renderable by both the API (one-time codes)
and the worker.

## Post-Design Constitution Re-check

The Phase 1 design keeps every check above.

- **Data model:** RLS is forced on `workspace`, `membership`, `invitation`, and workspace-scoped
  `security_event` rows. User-scoped tables use `user_id` policies.
- **Contracts:** the contracts return `404` for other workspaces' resources (AC-SEC-004), and
  `step_up_required` and `mfa_enrollment_required` errors for sensitive actions.
- **Gate closed:** ADR-0008 and ADR-0009 were accepted on 2026-11-14.

## Complexity Tracking

No constitution violations to justify.
