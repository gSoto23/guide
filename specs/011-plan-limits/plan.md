# Implementation Plan: Plan Limits

**Branch**: `011-plan-limits` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-plan-limits/spec.md`

## Summary

Every workspace gets a plan (Free, Pro, Business) whose limits on active properties, monthly AI
replies, and seats are enforced on every path, with optional custom limits per workspace. The founder
assigns plans with a command-line tool (no billing yet), recorded in the security log. Owners and
admins see "Plan and limits" with usage, a banner at 80% and 100% of the month's AI replies, and
threshold emails.

Technical approach: the plan catalog and effective-limit rules are pure domain code; the workspace
row stores the plan and custom limits (migration `0035`); monthly AI usage is summed from the daily
counts the worker already keeps; the existing budget check gains a monthly limit with its own reason;
a 5-minute worker job sends threshold emails once; one read-only route and one portal screen; a CLI
in the db package ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages.

**Storage**: PostgreSQL 16: three `workspace` columns and `plan_usage_notice` (migration `0035`)
([data model](data-model.md)).

**Testing**: Vitest (domain rules; integration with Testcontainers for API, worker, db), Playwright on
the phone viewport, axe.

**Target Platform**: API and worker (ECS Fargate), portal; the founder tool runs where migrations run.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: plan route p95 ≤ 300 ms for 50 properties and a month of usage; the budget
check adds one indexed sum to the reply path; portal routes ≤ 150 KB gzip of initial JavaScript.

**Constraints**: no route writes plans or custom limits; nothing is removed above a limit; the daily
budgets keep working; no guest data.

**Scale/Scope**: 1 portal screen, 1 banner, 1 endpoint, 1 worker job, 2 CLI commands; limit checks on
5 property paths, invitations, guide chat, copilot, and tests.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec with 7 clarifications under the standing authorization; checklist complete | [x] |
| II. Platform Compliance | No guest data; limits change nothing guests see except the existing holding reply | [x] |
| III. Guest Trust and Human-in-the-Loop | At the limit the conversation goes to the host instead of silence | [x] |
| IV. Channel-Agnostic Core | Plan and limit rules are pure domain code used by API and worker | [x] |
| V. Test-First and Eval-Driven | Tests first per story; no prompt or model change, so no new evals | [x] |
| VI. Security and Privacy | SEC-05 (owners and admins see plans), SEC-07 (monthly AI limit), SEC-14 (RLS, cross-tenant test), SEC-15 (founder tool only), SEC-16 (plan changes logged) | [x] |
| VII. Simplicity | No new dependency or service; one small table; reuse of the daily counts | [x] |
| VIII. Observability | Job span with counts; plan changes in the security log | [x] |
| IX. International | Spanish and English; dates in the member's time zone; numbers per locale | [x] |
| Performance | Budget below; timing and bundle tests | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Plan route (API) | Latency, 50 properties, a month of usage | p95 ≤ 300 ms | Integration timing test |
| Plan screen (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |
| Banner | Not in initial JavaScript of any route | loaded on demand | Portal bundle check |

## Project Structure

```text
packages/domain/src/plans/              # catalog, effective limits, derived basis, month bounds
packages/contracts/src/plans.ts         # plan response; PropertyLimits.limit and seat limit nullable
packages/db/src/schema/tenancy.ts       # + plan, plan_changed_at, ai_reply_monthly_limit; plan_usage_notice
packages/db/migrations/0035_plan_limits.sql
packages/db/src/plan-limits.ts          # workspaceLimitInputs, monthly AI usage
packages/db/src/cli/plan.ts             # plan:set, plan:show
packages/emails/src/plans/              # plan.ai_usage (80%, 100%)
apps/api/src/plans/                     # GET plan
apps/api/src/properties, imports, pms, extractions, guides, tenancy   # effective limits
apps/worker/src/jobs/assistant-pipeline.ts, copilot-draft.ts, assistant-test.ts  # monthly check
apps/worker/src/jobs/plan-usage-tick.ts # threshold emails; retention of notices
apps/portal/app/[locale]/(app)/settings/plan/, components/plan/
e2e/specs/plan-us1, plan-us4, a11y
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `plan_usage_notice` | Threshold emails must go once per month (SC-005) | Columns on `workspace` would need one pair per threshold and reset logic each month |
