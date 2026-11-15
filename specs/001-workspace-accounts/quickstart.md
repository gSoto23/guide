# Quickstart and Validation: Workspaces, Accounts, Roles and Invitations

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **API**: [contracts/http-api.md](contracts/http-api.md) · **Emails**: [contracts/emails.md](contracts/emails.md)

This guide proves the feature works end to end, with the repository's own scripts.

## Prerequisites

- Node.js 24 LTS, pnpm, and Docker.
- Local services from `docker-compose.yml`: PostgreSQL 16 and Mailpit (the email inbox at
  `http://localhost:8025`).
- Environment variables, from the committed `.env.example`. Real values never go in the
  repository:
  - database URL;
  - auth secret;
  - Google OAuth client ID and secret (a development client);
  - email transport (Mailpit's SMTP locally; Amazon SES in AWS stages);
  - portal and API URLs;
  - internal proxy secret.

## Setup

```bash
cp .env.example .env
```

Fill in `BETTER_AUTH_SECRET` (at least 32 characters, for example from `openssl rand -hex 32`).
If port 5432 is busy, set `POSTGRES_PORT` and use the same port in `DATABASE_URL`.

```bash
docker compose up -d postgres mailpit
```

```bash
pnpm install
```

```bash
pnpm db:migrate
```

```bash
pnpm build
```

```bash
pnpm dev
```

Open the portal at `http://localhost:3000`. Build with `API_PROXY_URL` set (as in
`.env.example`): Next.js fixes the `/api` rewrite at build time, and `turbo.json` passes the
variable through to the build.

## Validation scenarios

Each scenario maps to a user story and its acceptance criteria in the [spec](spec.md).

| # | Scenario | Steps | Expected outcome |
|---|---|---|---|
| V1 | Email sign-up (US1) | Sign up with a new email; read the code in Mailpit; enter it | Signed in; workspace created with you as owner; onboarding questions shown |
| V2 | Skip onboarding (US1) | Skip all three questions | You land on "create your first property"; language matches the browser |
| V3 | Manager path (US1) | Answer "10+" and a PMS | The manager path is shown (FR-006) |
| V4 | Expired code (US1) | Enter a code after 10 minutes or twice | Rejected; a new code can be requested |
| V5 | Passkey (US2) | Register a passkey; sign out; sign in with it | Signed in without email (FR-008) |
| V6 | Step-up (US2) | Wait 10+ minutes; try to invite a member | `step_up_required`; after re-authenticating, the action succeeds (FR-011) |
| V7 | New device (US2) | Sign in from a fresh browser profile | `auth.new_device` email in Mailpit (FR-012) |
| V8 | Revoke session (US2) | Revoke the other browser's session | That browser is signed out on its next request |
| V9 | Lockout (US2) | Enter 5 wrong codes | Further attempts are blocked; `auth.lockout` email sent (AC-SEC-001) |
| V10 | Invitation (US3) | Owner invites an agent; the invitee accepts with the invited email | The invitee joins with role `agent`; no new workspace created (FR-020) |
| V11 | Wrong email (US3) | Open the invitation signed in with another email | Refused with `email_mismatch`; only the workspace name is shown (AC-SEC-002) |
| V12 | Agent limits (US3) | As the agent, try to invite or change settings | `403 forbidden` |
| V13 | Switching (US4) | Join a second workspace; switch between them | Only the current workspace's data is shown; under 2 s (SC-007) |
| V14 | Cross-workspace ID (US4) | Request a member ID from the other workspace | `404 not_found`; `access.cross_workspace_denied` logged (AC-SEC-004) |
| V15 | Removal (US5) | Remove a member who is signed in elsewhere | Their next request after ≤ 60 s is refused (SC-006) |
| V16 | Owner leaving (US5) | As the owner, try to leave | `409`; transfer ownership first (FR-026) |
| V17 | Workspace deletion (US5) | Delete with step-up and the typed name; then restore | Members notified; restore works within 30 days (FR-027) |
| V18 | Export (US5) | Download personal data after step-up | A JSON file with profile, memberships, and own security events |
| V19 | Security log | Open the workspace security log as owner | Events for V5–V17 appear within 1 minute (SC-008) |

## Automated checks

```bash
pnpm test
```

Runs the unit tests: the policy matrix, `requiresMfa`, step-up windows, and invitation states.

```bash
pnpm test:integration
```

Runs the Testcontainers PostgreSQL tests: RLS cross-tenant checks, invitation acceptance,
removal propagation, and the append-only log.

```bash
pnpm test:e2e
```

Runs Playwright for V1–V3, V5, V7, V10–V13, and V15–V17, plus the axe accessibility check. Local runs share one IP, so repeated runs can hit the 20-codes-per-hour IP limit; clear the counters with `docker compose exec postgres psql -U guidesk -d guidesk -c "TRUNCATE rate_limit, rate_limit_bucket;"`. Build the portal with `API_PROXY_URL` set: Next.js fixes rewrites at build time. It uses Chromium's virtual WebAuthn
authenticator and Mailpit.

```bash
pnpm lint:rls
```

Runs the migration check that fails if a tenant table lacks forced RLS.

### Performance and accessibility (T100–T102, T104)

```bash
pnpm --filter @guidesk/portal bundle:check
```

Starts the production build and fails if a route's initial JavaScript is over 150 KB gzip
(`apps/portal/bundle-budget.json`).

```bash
pnpm perf:lighthouse
```

Lighthouse CI on a local production build (`lighthouserc.json`): LCP ≤ 2.5 s, CLS ≤ 0.1, total
blocking time ≤ 200 ms, accessibility ≥ 0.95. Stop anything on port 3000 first. Reports go to
`.lighthouseci/`. CI runs both checks in the `performance` job.

The accessibility check (`e2e/specs/a11y.spec.ts`, axe with WCAG 2.2 A and AA rules) runs with
`pnpm test:e2e`.

```bash
docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 -e ORIGIN=http://localhost:3000 -e MAILPIT_URL=http://host.docker.internal:8025 grafana/k6:1.8.2 run - < perf/k6/auth.js
```

The k6 load test for the auth and membership endpoints (p95 ≤ 300 ms). Against staging, pass
`BASE_URL` and `SESSION_COOKIES` from test accounts instead of Mailpit. From one machine, keep
`VUS` at 8 or less: `/get-session` allows 600 requests per minute per IP.

## Validation results

### Local (2026-11-15)

Production builds of the portal, API, and worker against Docker Compose, after the US3–US5
security review. Staging (T105) is still to do: it needs the first AWS deployment.

| # | Result | Evidence |
|---|---|---|
| V1–V3 | ✅ | `e2e/specs/us1-signup.spec.ts` |
| V4 | ✅ | `otp.test.ts` (expired and reused codes) |
| V5, V7 | ✅ | `e2e/specs/us2-security.spec.ts` |
| V6 | ✅ | `step-up.test.ts`; invitations and member changes answer `step_up_required` without it |
| V8 | ✅ | `sessions.test.ts` |
| V9 | ✅ | `lockout.test.ts` |
| V10–V12 | ✅ | `e2e/specs/us3-invitations.spec.ts`, `invitations.test.ts` |
| V13 | ✅ | `e2e/specs/us4-switching.spec.ts` (switch under 2 s) |
| V14 | ✅ | `cross-tenant.test.ts`, `security-review-us3-us5.test.ts` |
| V15–V17 | ✅ | `e2e/specs/us5-lifecycle.spec.ts`, `removal.test.ts`, `workspace-deletion.test.ts` |
| V18 | ✅ | `account-lifecycle.test.ts` |
| V19 | ✅ | `security-log.test.ts` (events appear at once; no queue in between) |
| Budgets | ✅ | Initial JavaScript 137–143 KB gzip per route; Lighthouse LCP about 0.77 s, TBT ≤ 41 ms, CLS 0; k6 p95 45–75 ms with 8 virtual users |
| Accessibility | ✅ | axe: no WCAG 2.2 A or AA violations on the 11 screens checked |

### Staging

⏳ Not run yet (T105).
