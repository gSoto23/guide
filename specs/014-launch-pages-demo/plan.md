# Implementation Plan: Launch Pages and Demo Workspace

**Branch**: `014-launch-pages-demo` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/014-launch-pages-demo/spec.md`

## Summary

Two independent parts.

- **Public pages.** The portal's root becomes a public home page, and a privacy policy and terms of
  service join it, in Spanish and English.
  - They are server-rendered pages in a `(public)` route group, with texts in their own public catalogs
    (so they never ship with portal screens).
  - The plans section reads plan numbers from the domain package.
  - Search basics: metadata, robots, and a sitemap.
  - A consent line on sign-in and invitations, and a privacy link in the guest guide.
  - The installed app starts at `/start`.
  - The pages are added to the CI budget checks.
- **Demo workspace.** A founder command in the API package (`demo:seed`) builds a demo workspace in one
  transaction.
  - It encrypts the door code and stay links with the vault, like the product does.
  - It creates two Costa Rica properties with published bilingual guides, stays, extras, conversations,
    an open escalation, and 60 days of analytics history.
  - It marks the workspace as demo, so the pilot report ignores it.
  - It refuses production through a new `STAGE` setting.
  - It runs locally, or on staging as a one-off task with the API's role.

## Technical Context

**Language/Version**: TypeScript (Node.js 24), as in ADR-0004.

**Primary Dependencies**:
- Portal: Next.js with next-intl.
- API: NestJS. The command itself uses no Nest context.
- Shared packages: Drizzle ORM (`@guidesk/db`), `@guidesk/vault`, `@guidesk/domain`, `@guidesk/contracts`, `@guidesk/integrations` (KMS factory).
- No new dependency.

**Storage**: PostgreSQL (RDS). One migration: `workspace.demo`. The public texts are JSON catalogs in `packages/i18n/messages/`.

**Testing**:
- vitest (unit) and vitest with Testcontainers (API and DB integration).
- Playwright e2e with axe.
- Lighthouse CI and the bundle-size check in the CI `performance` job.

**Target Platform**:
- The portal on AWS (OpenNext on Lambda behind CloudFront).
- The API container on ECS Fargate, where the command runs as a one-off task.
- The guest guide Lambda.

**Project Type**: Web application in a pnpm monorepo: `apps/portal`, `apps/api`, `apps/guide`, plus `packages/*` and `infra/`.

**Performance Goals**:
- Public pages within the portal budgets (see the budget table below).
- The demo command finishes in under 60 seconds locally and in under 5 minutes on staging, including task start (SC-005).

**Constraints**:
- No third-party origins on the public pages.
- No secrets in output or logs.
- One transaction for the seed.
- No AI or partner calls.
- Spanish and English parity.
- WCAG 2.2 AA.

**Scale/Scope**:
- Public side: 3 public pages × 2 languages, 2 catalogs.
- Demo: one workspace per run, with about 2,000 rows (60 days × 2 properties of counters and questions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec written and validated; no open `[NEEDS CLARIFICATION]` (clarifications answered under the standing instruction) | [x] |
| II. Platform Compliance | PC-01, PC-02, PC-06 to PC-09, PC-12, and trademark use listed in the spec. Demo content and home copy are checked by tests: no deposit, extras optional, Explore disclosure kept, copilot described as copy and paste | [x] |
| III. Guest Trust and Human-in-the-Loop | The demo keeps `draft` as the default autonomy (auto only for Wi-Fi and check-in), shows a mandatory escalation (malfunction) waiting for the host, and audit-logs the run | [x] |
| IV. Channel-Agnostic Core | No new external system; the command reuses the existing KMS port and calls no adapter that reaches out | [x] |
| V. Test-First and Eval-Driven | Tests are listed before implementation (research R18). There is no agent change, so no new evals; the seed never calls the model | [x] |
| VI. Security and Privacy | Security considerations covered. SEC-06: vault encryption in the seed. SEC-11: CSP unchanged, no third-party origins. SEC-14: no new tenant table, and the new column sits on `workspace`. SEC-15: founder-only command that refuses production. SEC-16: security event. SEC-20: the privacy policy. Secrets never printed | [x] |
| VII. Simplicity | No new runtime, datastore, vendor, or dependency. Separate public catalogs and an API-side command are justified in research R2 and R9 | [x] |
| VIII. Observability | The command logs its steps without secrets and records a security event; public pages are covered by the existing request logs and error tracking | [x] |
| IX. International | All public texts in ES and EN with a parity test; dates and money formatted per locale; demo stays computed in each property's time zone | [x] |
| Performance | Budgets declared below and enforced by the CI bundle check and Lighthouse CI on the new routes | [x] |

Post-design re-check (after data-model, contracts, quickstart): no change; all gates pass.

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| `/es`, `/en` (home) | Initial JavaScript, gzip | ≤ 150 KB (measured 139.0 KB: the framework baseline, no client components of their own) | `bundle:check` in CI (`apps/portal/bundle-budget.json`) |
| `/es/privacy`, `/en/terms` | Initial JavaScript, gzip | ≤ 150 KB | `bundle:check` in CI |
| `/es`, `/es/privacy` | LCP, lab (Lighthouse, mobile) | ≤ 2.5 s | Lighthouse CI (`lighthouserc.json`) |
| `/es`, `/es/privacy` | CLS | ≤ 0.1 | Lighthouse CI |
| `/es`, `/es/privacy` | TBT | ≤ 200 ms | Lighthouse CI |
| `/es`, `/es/privacy` | Accessibility score | ≥ 0.95 | Lighthouse CI and axe in e2e |
| Guest guide home with the privacy link | Initial JavaScript | ≤ 100 KB (unchanged) | `size:check` in CI |
| `demo:seed`, local | Wall time | ≤ 60 s | Integration test timing (logged) |

## Project Structure

### Documentation (this feature)

```text
specs/014-launch-pages-demo/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R18
├── data-model.md        # Phase 1: workspace.demo, settings, catalogs, demo dataset
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── public-pages.md  # Routes, metadata, robots, sitemap, settings
│   └── demo-seed-cli.md # Command, arguments, exit codes, output
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/portal/
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx                 # default metadata: robots noindex
│   │   ├── (public)/
│   │   │   ├── layout.tsx             # header (sign-in, language), footer (legal, contact, company)
│   │   │   ├── page.tsx               # home (moved from [locale]/page.tsx)
│   │   │   ├── privacy/page.tsx
│   │   │   └── terms/page.tsx
│   │   └── (auth)/sign-in, invite/[token]  # consent line
│   ├── manifest.ts                    # start_url "/start"
│   ├── robots.ts                      # /robots.txt
│   └── sitemap.ts                     # /sitemap.xml
├── components/public/                 # server components: sections, plans, legal document
├── lib/public/                        # catalogs loader, fill(), settings, plan figures, routes
├── bundle-budget.json                 # + public routes
└── test/                              # unit: robots, sitemap, settings, fill, plans
lighthouserc.json                      # + /es, /es/privacy

packages/i18n/
├── messages/public.es.json, public.en.json   # home, privacy, terms
├── messages/es.json, en.json                 # auth.consent
├── messages/guest.es.json, guest.en.json     # privacy link
└── test/catalogs.test.ts                     # public catalogs parity

apps/guide/src/
├── config.ts                          # portalUrl
└── pages/guide-pages.tsx, components/ # privacy link on home and chat panel

apps/api/
├── src/config/config.ts               # STAGE
├── src/demo/content.ts                # synthetic properties, guide texts, extras, questions
├── src/demo/seed.ts                   # builder (one transaction, vault, history)
├── src/demo/history.ts                # deterministic 60-day generator
├── src/cli/demo-seed.ts               # entry: args, guards, output
├── package.json                       # demo:seed script
└── test/integration/demo-seed.test.ts

packages/db/
├── migrations/0037_workspace_demo.sql (+ meta)
├── src/schema/tenancy.ts              # workspace.demo
├── src/reports/pilot.ts               # exclude demo workspaces
└── test/integration/pilot-report.test.ts

packages/domain/src/security-events.ts # workspace.demo_seeded

infra/
├── config.ts                          # contactEmail, companyName; production needs contactEmail
├── web.ts                             # portal env: PORTAL_URL, CONTACT_EMAIL, COMPANY_NAME
├── guide.ts                           # guide env: PORTAL_URL
└── services.ts                        # STAGE for API and worker
.github/workflows/deploy.yml           # GUIDESK_CONTACT_EMAIL, GUIDESK_COMPANY_NAME
e2e/specs/public-pages.spec.ts, a11y.spec.ts
docs/                                  # pilot-readiness (contact setting, demo command), presentation status
```

**Structure Decision**: the existing monorepo layout. The public pages join the portal app, and the demo
command joins the API package so it has the vault and KMS permission (research R9).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Separate public catalogs with a tiny placeholder helper instead of next-intl messages | Legal texts are long and only three pages need them | Adding them to the main catalogs ships them with every portal screen, and the precompiled ICU setup makes runtime formatting of extra catalogs fragile (R2) |
| The demo command in the API package rather than next to `plan:set` in `packages/db` | It must encrypt with the vault under the API's KMS permission | `packages/db` can't import the vault without a cycle, and AWS lets only the API and worker roles use the key (R9) |
