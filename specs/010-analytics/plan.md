# Implementation Plan: Basic Analytics

**Branch**: `010-analytics` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-analytics/spec.md`

## Summary

Members see Analytics for a property or the whole workspace over 7, 30, or 90 days, compared with the
previous period: guide views and stays that opened the guide; guest questions by outcome with the
automated resolution rate; topics and escalation reasons; unanswered questions linking to their
conversations; Explore opens and partner clicks; add-on requests by status and the attach rate. The
founder gets a command-line report of the six pilot metrics across workspaces.

Technical approach: read the records and daily counts that already exist (no analytics store), with
one new column on `stay` (first guide open) and two indexes; pure period and rate helpers in the
domain; two member routes; two portal screens drawn with plain markup; a report module and CLI in the
db package ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages.

**Storage**: PostgreSQL 16: `stay.guide_opened_at` and two indexes (migration `0034`)
([data model](data-model.md)).

**Testing**: Vitest (domain helpers, integration with Testcontainers), Playwright on the phone viewport,
axe.

**Target Platform**: API (ECS Fargate), portal; the report runs where migrations run.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: analytics routes p95 ≤ 500 ms for 50 properties and 90 days; portal routes
≤ 150 KB gzip of initial JavaScript.

**Constraints**: no new personal data, no guest tracking; tests and copilot runs never counted; the
report never reachable from the portal or API; aggregates only in its output.

**Scale/Scope**: 2 portal screens plus a card and a header link, 2 endpoints, 1 CLI report.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`2e11017`) with 7 clarifications under the standing authorization; checklist complete | [x] |
| II. Platform Compliance | PC-03 (stays counted, never identified), PC-10 (copilot excluded) | [x] |
| III. Guest Trust and Human-in-the-Loop | Unanswered questions lead hosts to improve the guide; nothing automated acts on guests | [x] |
| IV. Channel-Agnostic Core | Period and rate rules are pure domain code; sources are channel-neutral records | [x] |
| V. Test-First and Eval-Driven | Tests first per story against seeded records; no model behavior changes, so no new evals | [x] |
| VI. Security and Privacy | SEC-05 (members only), SEC-07 (bounded periods and pages), SEC-14 (RLS, cross-tenant tests), SEC-20 (no new personal data; report aggregates only) | [x] |
| VII. Simplicity | No new dependency, table, or job; on-request reads with indexes | [x] |
| VIII. Observability | Route spans as usual; the report logs counts only | [x] |
| IX. International | Spanish and English; numbers, percentages, and dates per locale; property time zones | [x] |
| Performance | Budget below; timing and bundle tests | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Analytics routes (API) | Latency, 50 properties × 90 days | p95 ≤ 500 ms | Integration timing test |
| Unanswered list (API) | Latency, same data | p95 ≤ 300 ms | Integration timing test |
| Analytics screens (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |

## Project Structure

```text
packages/domain/src/analytics/         # periods, changes, rates, question outcomes
packages/contracts/src/analytics.ts    # query schemas and response shapes
packages/db/src/schema/stays.ts        # + guide_opened_at; migration 0034 (column, backfill, indexes)
packages/db/src/reports/pilot.ts       # pilot metrics; src/cli/pilot-report.ts (report:pilot)
apps/api/src/analytics/                # routes and service
apps/api/src/guest/                    # stay-session exchange sets guide_opened_at
apps/portal/app/[locale]/(app)/analytics/, properties/[propertyId]/analytics/, components/analytics/,
apps/portal/lib/analytics.ts           # constants for the client
e2e/specs/analytics-us1, analytics-us3, a11y
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `stay.guide_opened_at` | Stay links and sessions are deleted 30 days after checkout, so they can't answer "stays that opened the guide" over 90 days | A daily stay count can't be summed into distinct stays |
