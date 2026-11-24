# Implementation Plan: AI Reply Allowances and Top-ups

**Branch**: `019-ai-reply-allowances` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-ai-reply-allowances/spec.md`

## Summary

New monthly AI reply allowances (Free 500 during the pilot; Pro and Business 300 per active property
with minimums of 500 and 1,000), a guest pace of 25 messages per device every 10 minutes, and top-ups:
packs of AI replies the founder adds with the command-line tool, used after the month's allowance,
oldest first, valid 12 months. The plan screen, banner, and emails show the balance and how to ask
for more; the pilot report separates replies from allowances and top-ups and gives the AI cost per
reply.

Technical approach: change the domain catalog (minimum on pooled plans); a new `ai_top_up` table and a
`top_up_replies` count on `chat_usage_daily` (migration `0039`); the existing pre-call budget check
also reads the top-up balance, and the existing usage record takes one top-up reply with a
conditional update when the month is above its allowance; three founder CLI commands plus an AWS task
wrapper; additions to `GET plan`, the plan screen, the banner, two emails, and the pilot report
([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages.

**Storage**: PostgreSQL 16: `ai_top_up` and `chat_usage_daily.top_up_replies` (migration `0039`)
([data model](data-model.md)).

**Testing**: Vitest (domain rules; integration with Testcontainers for db, worker, API); portal unit
tests for the plan helpers; no new e2e (the plan screen e2e of spec 011 keeps running locally).

**Target Platform**: API and worker (ECS Fargate), portal; the founder tool runs where migrations run,
locally or as an AWS one-off task.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: the usage check adds at most one indexed sum (top-up balance) to the reply
path, ≤ 20 ms p95 (SC-004); the record adds one month sum and, above the allowance, one conditional
update; plan route p95 ≤ 300 ms as before.

**Constraints**: no route writes top-ups; balances never negative; the daily budgets keep working;
no guest data; portal routes ≤ 175 KB.

**Scale/Scope**: 1 migration, 3 CLI commands, 1 script action, 4 worker paths (chat, copilot, tests,
pipeline) through 2 shared functions, 1 endpoint change, 1 screen and banner change, 2 emails, 1 report.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec with founder decisions and 8 clarifications; checklist complete | [x] |
| II. Platform Compliance | No guest-facing change except a higher pace; nothing sent through platforms | [x] |
| III. Guest Trust and Human-in-the-Loop | Without replies left, the conversation still goes to the host | [x] |
| IV. Channel-Agnostic Core | Allowance rules in domain code; usage rules in the shared worker functions | [x] |
| V. Test-First and Eval-Driven | Tests first per story; no prompt or model change, so no new evals | [x] |
| VI. Security and Privacy | SEC-07 (limits), SEC-14 (RLS read-only for members), SEC-15 (founder tool only), SEC-16 (top-ups in the security log) | [x] |
| VII. Simplicity | Check-then-count kept (R4); one table; no reservation machinery | [x] |
| VIII. Observability | Plan usage job span adds the "used up" emails count | [x] |
| IX. International | Spanish and English; dates in the member's time zone | [x] |
| Performance | Budget below | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Usage check (worker) | Added latency | ≤ 20 ms p95 | Integration timing test |
| Plan route (API) | Latency, 50 properties, 20 top-ups | p95 ≤ 300 ms | Existing timing test, extended |
| Plan screen (portal) | Initial JavaScript | ≤ 175 KB gzip | Portal bundle check |

## Project Structure

```text
packages/domain/src/plans/index.ts            # catalog minimums; effectiveLimits.minimum
packages/domain/src/security-events.ts         # two new event types
packages/contracts/src/plans.ts                # minimum, topUps
packages/db/src/schema/plans.ts                # aiTopUp (new)  [or tenancy.ts next to planUsageNotice]
packages/db/src/schema/chat.ts                 # chatUsageDaily.topUpReplies
packages/db/migrations/0039_ai_top_ups.sql
packages/db/src/plan-limits.ts                 # topUpBalance, takeTopUpReply
packages/db/src/plans/admin.ts, cli/plan.ts    # addTopUp, listTopUps, correctTopUp; parts URL
packages/db/src/reports/pilot.ts               # replies by source and cost per reply, per plan
packages/emails/src/plans/notices.ts           # ai_usage copy; top_up_used_up
apps/worker/src/jobs/assistant-pipeline.ts     # usageToday + topUps, budgetStop, recordUsage
apps/worker/src/jobs/plan-usage-tick.ts        # used-up emails
apps/api/src/plans/plans.service.ts            # minimum, topUps
apps/api/src/chat/guest-chat.service.ts        # 25 per 10 minutes
apps/portal/components/plan/*, lib/plan.ts, lib/public/plans.ts, messages, public texts
scripts/aws-task.sh                            # plan action
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `ai_top_up` table | Oldest-first use, 12-month expiry per top-up, history, one email per top-up | A balance column on `workspace` cannot expire part of a balance |
