# Tasks: AI Reply Allowances and Top-ups

**Input**: Design documents from `/specs/019-ai-reply-allowances/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/http-api.md](contracts/http-api.md)

**Tests**: The constitution requires tests first (principle V); each story starts with its tests.

## Phase 1: Setup

- [X] T001 Confirm the baseline: `pnpm --filter @guidesk/domain test` and `pnpm --filter @guidesk/db build` pass on the branch before changes

## Phase 2: Foundational (blocking)

- [X] T002 Add `ai_top_up` (columns, checks: granted 1–100,000, 0 ≤ used ≤ granted, note 1–200, correction note 1–200 when set; indexes `(workspace_id, created_at)` and partial `WHERE replies_used < replies_granted`) and `chatUsageDaily.topUpReplies` (integer, default 0) in packages/db/src/schema/tenancy.ts and packages/db/src/schema/chat.ts
- [X] T003 Generate migration packages/db/migrations/0039_ai_top_ups.sql with drizzle-kit (move Finder " 2" copies aside first), then append RLS: enable and force on `ai_top_up`, system policy `TO CURRENT_USER`, member read policy `ai_top_up_read` for `guidesk_app` (workspace = `app_current_workspace_id()` and a role), `GRANT SELECT ON ai_top_up TO guidesk_app`; run prettier on migrations/meta
- [X] T004 Add security event types `workspace.ai_top_up_added` (`replies`, `expiresOn`) and `workspace.ai_top_up_corrected` (`from`, `to`) in packages/domain/src/security-events.ts
- [X] T005 [P] Add `topUpBalance(db, workspaceId, now)` and `takeTopUpReply(db, workspaceId)` (conditional update with `FOR UPDATE SKIP LOCKED`, oldest first, unexpired) and `listTopUps(db, workspaceId, now, limit)` in packages/db/src/plan-limits.ts; export them from packages/db/src/index.ts

## Phase 3: User Story 1 — Higher monthly allowances (P1)

**Goal**: Free 500; Pro 300 per active property, at least 500; Business 300 per active property, at least 1,000.
**Independent test**: plan screen and `plan:show` give 500 / 1,500 / 1,000 / 1,200 for the cases in the spec.

- [X] T006 [US1] Tests first in packages/domain/test/plans/plans.test.ts: Free 500; Pro 1→500, 5→1,500; Business 0→1,000, 2→1,000, 4→1,200; custom limit wins with `minimum: null`
- [X] T007 [US1] Change the catalog and `effectiveLimits` (pooled `minimum`, `aiReplies.minimum` in the result) in packages/domain/src/plans/index.ts
- [X] T008 [P] [US1] Add `minimum: number | null` to `PlanSummary.limits.aiReplies` in packages/contracts/src/plans.ts and return it from apps/api/src/plans/plans.service.ts
- [X] T009 [P] [US1] Public home plans line with the minimum ("… compartidas, mínimo {minimum}") in apps/portal/lib/public/plans.ts and packages/i18n/public/es.json, en.json; update its unit test if one asserts the text
- [X] T010 [US1] Fix tests that assumed Free 100 or Pro 300 (grep `100` and `300` in apps/api/test, apps/worker/test, packages/db/test, e2e/helpers) so they read the catalog

## Phase 4: User Story 2 — Guest pace 25 per 10 minutes (P1)

- [X] T011 [US2] Test first: the 25th message in 10 minutes from one device is accepted and the 26th gets `429 chat_paused`, in the existing guest chat integration test (apps/api/test/integration/guest-chat*.test.ts)
- [X] T012 [US2] Set `CHAT_DEVICE_LIMIT = 25` in apps/api/src/chat/guest-chat.service.ts

## Phase 5: User Story 3 — Top-ups keep the AI answering (P2)

**Independent test**: a workspace at its monthly limit with a 10-reply top-up answers 10 more, then pauses; next month starts full with the balance unchanged.

- [X] T013 [US3] Tests first (db integration, packages/db/test): `takeTopUpReply` takes oldest first, skips expired, never goes below zero; 50 concurrent takes on a 1-reply top-up → exactly 1 succeeds
- [X] T014 [US3] Tests first (worker integration, apps/worker/test): `budgetStop` allows when month used up and balance > 0, stops at 0; `recordUsage` takes a top-up reply only when the month total exceeds the allowance and counts `top_up_replies`
- [X] T015 [US3] `usageToday` also returns `topUpLeft`; `budgetStop` stops for "monthly" only when `month >= monthlyLimit && topUpLeft <= 0`; `recordUsage(tx, …)` reads the effective limit and the month total after the upsert and calls `takeTopUpReply` above it, then increments `top_up_replies`, in apps/worker/src/jobs/assistant-pipeline.ts (callers in chat-reply.ts, copilot-draft.ts, assistant-test.ts keep passing their transaction)
- [X] T016 [US3] Founder tool: tests first in packages/db/test (add, confirmation above 5,000, list, correction only lowers, security events, unknown workspace), then `addTopUp`, `listTopUps`, `correctTopUp`, top-ups in `showPlan` and `formatPlanReport` in packages/db/src/plans/admin.ts
- [X] T017 [US3] CLI commands `topup`, `topups`, `topup-correct` and the database URL from parts in packages/db/src/cli/plan.ts; scripts `plan:topup`, `plan:topups`, `plan:topup-correct` in packages/db/package.json
- [X] T018 [US3] `plan` action in scripts/aws-task.sh (subcommand allow-list; JSON override built with python3 from the arguments)

## Phase 6: User Story 4 — Balance on screen and in messages (P3)

- [X] T019 [US4] Tests first: `GET plan` returns `topUps` (balance, unexpired items oldest first, no notes) in apps/api/test/integration/plan*.test.ts
- [X] T020 [US4] `topUps` in packages/contracts/src/plans.ts and apps/api/src/plans/plans.service.ts
- [X] T021 [US4] Plan screen: month row with used capped at the allowance, a top-ups row with balance and each expiry, minimum note, "Pedir más respuestas" (contact address with prefilled subject and workspace ID) in apps/portal/components/plan/plan-view.tsx and apps/portal/lib/plan.ts; texts in packages/i18n/messages/es.json and en.json
- [X] T022 [US4] Banner states (80% warning with ask link; month used up with balance → "top-up keeps answering, N left"; paused → ask link) in apps/portal/components/plan/plan-usage-banner.tsx
- [X] T023 [US4] Emails: `plan.ai_usage` copy mentions top-ups and, at 100% with a balance, that the AI keeps answering (new `topUpLeft` detail); new `renderPlanTopUpUsedUp` in packages/emails/src/plans/notices.ts with tests in packages/emails/test
- [X] T024 [US4] Plan usage job: pass `topUpLeft` to the 100% email; claim `exhausted_notified_at` for used-up top-ups and email owners once; span count `topups.notified` in apps/worker/src/jobs/plan-usage-tick.ts with tests in apps/worker/test

## Phase 7: Polish

- [X] T025 Pilot report: per plan, replies from allowances and top-ups and AI cost per reply, demo excluded, in packages/db/src/reports/pilot.ts with its test
- [X] T026 [P] Docs: pilot-readiness (main enforces the new numbers; `aws-task.sh … plan topup`), docs/operations/aws.md (plan action), quickstart check
- [X] T027 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` (affected packages), the portal bundle check, and prettier; fix findings
- [ ] T028 Mark tasks done, commit, open the PR, merge when checks pass, and check the staging deploy

## Dependencies

- Phase 2 blocks everything. US1 and US2 are independent. US3 needs T005. US4 needs US3's data (T015–T017).
- Within each story: tests first, then code.

## Parallel examples

- T008 and T009 after T007. T011–T012 alongside US1.
- T023 alongside T019–T022.

## Implementation strategy

US1 + US2 first (the numbers the pilot needs), then US3 (top-ups through the founder tool), then US4.
