# Quickstart and Validation: Workspaces, Accounts, Roles and Invitations

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **API**: [contracts/http-api.md](contracts/http-api.md) · **Emails**: [contracts/emails.md](contracts/emails.md)

This guide proves the feature works end to end. The commands are the scripts the
implementation will add (see `tasks.md`). Until then, they describe the target.

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
docker compose up -d postgres mailpit
```

```bash
pnpm install
```

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

Open the portal at `http://localhost:3000`.

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

Runs Playwright for V1, V5, V10, V11, V13, and V15. Local runs share one IP, so repeated runs can hit the 20-codes-per-hour IP limit; clear the counters with `docker compose exec postgres psql -U guidesk -d guidesk -c "TRUNCATE rate_limit, rate_limit_bucket;"`. Build the portal with `API_PROXY_URL` set: Next.js fixes rewrites at build time. It uses Chromium's virtual WebAuthn
authenticator and Mailpit.

```bash
pnpm lint:rls
```

Runs the migration check that fails if a tenant table lacks forced RLS.

CI also runs Lighthouse CI and the bundle-size check against the
[Performance Budget](plan.md#performance-budget).
