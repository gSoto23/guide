---

description: "Task list for feature 011: plan limits"
---

# Tasks: Plan Limits

**Input**: Design documents from `/specs/011-plan-limits/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story.

> **Production gates (not development gates):** the founder sets `PLAN_CONTACT_EMAIL` and moves pilot
> design partners to Pro or Business with `plan:set`; plan numbers stay open (OQ-10).

## Format: `[ID] [P?] [Story] Description`

Conventions: unlimited is `null`; custom limit ?? plan value; months are UTC; nothing is removed above
a limit; no route writes plans; synthetic test data only.

---

## Phase 1: Setup

- [ ] T001 [P] Portal catalogs: `plan` namespace (screen title, plan names, limits, "unlimited", meters as text, renewal moment, what counts as an AI reply, workspace ID, contact, over-limit note, banner at 80% and 100%), settings link, inbox reason `monthly_limit`, copilot and test outcome `monthly_limited`, limit messages with a link, security log label `workspace.plan_changed` in `packages/i18n/messages/`

## Phase 2: Foundational

- [ ] T002 [P] Domain `packages/domain/src/plans/` with unit tests: `PLANS`, catalog (Free 2/100/1; Pro null/pooled 300 at least 300/3; Business null/pooled/null), `effectiveLimits({plan, custom}, activeProperties)` with sources, `limitBasis(propertyLimit, active)` = limit ?? active + 2 (at least 2), `hasRoom(limit, used)`, `monthBounds(now)` (UTC), `aiUsageLevel(used, limit)` → none/warning (≥ 80%)/reached; `hasFreeSeat` accepts null
- [ ] T003 Schema and migration `0035_plan_limits.sql`: `workspace.plan` text not null default 'free' `IN ('free','pro','business')`, `plan_changed_at`, `ai_reply_monthly_limit` (`> 0`); table `plan_usage_notice (workspace_id, month, threshold IN (80,100), notified_at)` PK `(workspace_id, month, threshold)`, RLS on with no member policy; `packages/db/src/plan-limits.ts`: `workspaceLimitInputs(db, ws)` and `monthlyAiReplies(db, ws, now)`; `lockPropertySlots` returns the plan; db integration test
- [ ] T004 [P] Contracts `packages/contracts/src/plans.ts` (`PlanSummary` per [contracts/http-api.md](contracts/http-api.md)); `PropertyLimits.limit` and the invitations' seat limit nullable; reasons and outcomes `monthly_limit`, `monthly_limited`
- [ ] T005 Replace `propertyLimit(override)` callers with the effective limit and `limitBasis` in the API (properties, extractions, guide limits, CSV and PMS imports) and the worker (CSV, PMS import, guide AI, media); seat provider returns the effective seat limit; existing tests updated for the new defaults (team helpers set the plan they need)

## Phase 3: User Story 1 - AI replies stop at the monthly limit (P1) 🎯 MVP

**Goal**: no model call once the month's AI replies are used up; owners told at 80% and 100%.

**Independent Test**: a Free workspace at 99 replies answers one question, then holds the next with reason `monthly_limit` and no model call.

- [ ] T006 [P] [US1] Worker tests: guide chat at the limit holds with `monthly_limit` and no model call; pooled Pro allowance; copilot `monthly_limited`; test run `monthly_limited`; daily budget still `limit`; month rollover; custom limit
- [ ] T007 [US1] Monthly check in `apps/worker/src/jobs/assistant-pipeline.ts` (`usageToday` also returns the month and the limit), `copilot-draft.ts`, `assistant-test.ts`; reason and outcome values in db schema, domain policy, and analytics reasons
- [ ] T008 [P] [US1] Worker tests `plan-usage-tick.test.ts`: 80% and 100% emails once per month per threshold, owners only, in their language, none below 80%, again next month
- [ ] T009 [US1] Job `apps/worker/src/jobs/plan-usage-tick.ts` (every 5 minutes, registered in `main.ts`), email `plan.ai_usage` in `packages/emails/src/plans/`, retention of notices after 13 months
- [ ] T010 [US1] Portal: inbox reason `monthly_limit`, copilot and assistant-test messages for `monthly_limited` with the renewal moment

## Phase 4: User Story 2 - Properties and seats follow the plan (P1)

**Goal**: every property path and invitation follows the effective limits and explains refusals.

**Independent Test**: Free refuses a third property on each path and any invitation; Pro allows them up to its limits.

- [ ] T011 [P] [US2] API tests `apps/api/test/integration/plan-limits.test.ts`: Free property paths and invitations refused with `{limit, used}`; Pro and Business allow; removed properties don't count; capped imports; 10 concurrent creations and invitations for the last slot → exactly one; pending invitations accepted after a downgrade; over-limit keeps everything
- [ ] T012 [US2] Invitation sending locks the workspace row before counting seats in `apps/api/src/tenancy/invitations.service.ts`; unlimited seats and properties handled in every path
- [ ] T013 [US2] Portal: property limit messages and the members screen show the limit (or "unlimited") and link owners and admins to Plan and limits

## Phase 5: User Story 3 - The founder assigns plans and custom limits (P1)

**Goal**: `plan:set` and `plan:show`, logged in the security log.

**Independent Test**: Free → Business with a note lifts limits at once and logs the change; custom limits replace one value; bad input changes nothing.

- [ ] T014 [P] [US3] Tests `packages/db/test/integration/plan-cli.test.ts`: set plan, set and clear custom limits, security event with previous and new values and the note, refusals for unknown workspace, unknown plan, bad numbers, missing note; `plan:show` output with sources and usage
- [ ] T015 [US3] `packages/db/src/plans/admin.ts` (`setPlan`, `showPlan`) and `src/cli/plan.ts`; scripts `plan:set` and `plan:show` in `packages/db/package.json`; event type `workspace.plan_changed` in the domain catalog and the security log screen

## Phase 6: User Story 4 - Owners and admins see their plan and usage (P2)

**Goal**: Plan and limits screen and the AI usage banner.

**Independent Test**: a Free workspace with 1 property, 85 replies, and the owner shows 1 of 2, 85 of 100, 1 of 1 and the 80% banner; an agent can't open it.

- [ ] T016 [P] [US4] API tests: `GET plan` for owners and admins (sources, unlimited, pooled, renewal moment, contact), agent 403 with event, strict query, no write methods
- [ ] T017 [US4] `apps/api/src/plans/` (module, controller, service) registered in the app module; `PLAN_CONTACT_EMAIL` in config and `.env.example`
- [ ] T018 [US4] Portal `app/[locale]/(app)/settings/plan/page.tsx`, `components/plan/` (meters with text, over-limit note), link from settings; banner loaded on demand in the signed-in layout for owners and admins; bundle budget entry
- [ ] T019 [P] [US4] End-to-end `e2e/specs/plan-us1.spec.ts` (quickstart 1 and 2) and `plan-us4.spec.ts` (quickstart 3 and 4)

## Phase 7: Polish

- [ ] T020 [P] Cross-tenant case for `GET plan` in `apps/api/test/integration/cross-tenant.test.ts`
- [ ] T021 [P] Security review tests `security-review-011` (AC-SEC-001 to 005)
- [ ] T022 [P] Timing test `plan.perf.test.ts`: 50 properties and a month of usage, p95 ≤ 300 ms
- [ ] T023 [P] Accessibility: axe on Plan and limits and the banner
- [ ] T024 Docs: architecture overview, security (SEC-07 note), screens H-32, README for the founder tool, PRD/business model links, research R11 notes
- [ ] T025 Run the quickstart locally and record it in research R11

## Dependencies

- T002 to T005 block the stories. US1 and US2 are independent after Phase 2; US3 needs the schema;
  US4 needs the domain rules and contracts.

## Parallel examples

- T001, T002, and T004 in parallel; T014 and T015 alongside portal work.

## Implementation strategy

MVP is US1 (cost protection); then US2 and US3 (pilot plans), then US4 (visibility).
