# Research: AI Reply Allowances and Top-ups

**Feature**: [spec.md](spec.md) · **Date**: 2026-11-24

Each decision lists what was chosen, why, and what was rejected. The code these decisions touch was
read on 2026-11-24 (`packages/domain/src/plans`, `packages/db/src/plan-limits.ts`,
`apps/worker/src/jobs/assistant-pipeline.ts`, `chat-reply.ts`, `copilot-draft.ts`,
`assistant-test.ts`, `plan-usage-tick.ts`, `apps/api/src/plans`, `apps/api/src/chat/guest-chat.service.ts`,
`apps/portal/components/plan`, `packages/db/src/plans/admin.ts`, `scripts/aws-task.sh`).

## R1. Allowances: a minimum on the pooled plans

- **Decision**: The domain catalog keeps `pooled` allowances and gains a `minimum`: Pro
  `{ perProperty: 300, minimum: 500 }`, Business `{ perProperty: 300, minimum: 1000 }`; Free becomes
  `{ fixed, perMonth: 500 }`. `effectiveLimits` returns `max(minimum, perProperty × active)` and exposes
  `minimum` next to `perProperty`. Custom limits still replace the plan value.
- **Rationale**: One place for the numbers (spec 011 R1); the public home page and the plan screen
  read the same catalog, so they update with it.
- **Rejected**: a separate "pilot" switch for Free (the founder revisits Free after the pilot by
  changing one number; a switch adds a mode nobody needs now).

## R2. Guest message pace

- **Decision**: `CHAT_DEVICE_LIMIT` goes from 20 to 25 per 600 seconds. The per-network limit (60 per
  10 minutes) and the daily AI budgets stay.
- **Rationale**: FR-004; the network limit stays above the device limit, so one guest is never stopped
  by it first.

## R3. Top-ups are rows with granted and used counts

- **Decision**: New table `ai_top_up` (workspace, replies granted, replies used, added at, expires at
  = added at + 12 months, note, corrected at and correction note, exhausted-notice time). Members can
  read their workspace's rows (the plan screen); only system code writes. A partial index on
  unexpired rows with replies left keeps the balance query small.
- **Rationale**: The oldest-first rule, the 12-month expiry, the history for the founder, and the
  "used up" email each need one row per top-up; a single balance column could not expire parts.
- **Rejected**: a ledger of every consumption (one row per reply) — the daily usage table already
  counts replies; a balance column on `workspace` — no expiry per top-up.

## R4. When a reply draws from a top-up

- **Decision**: The existing check before a model call (`usageToday` + `budgetStop`) also reads the
  workspace's top-up balance; the monthly stop applies only when the month is used up **and** no
  top-up reply is left. When the reply is recorded (`recordUsage`, in the same transaction as the
  reply), the month's total including this reply is compared with the effective limit; above it, one
  reply is taken from the oldest unexpired top-up with
  `UPDATE … SET replies_used = replies_used + 1 WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)
  AND replies_used < replies_granted`, and the day's `top_up_replies` count goes up by one.
- **Rationale**: Today's monthly limit is check-then-count (spec 011 R4): a reply that started before
  the limit was reached is still counted. Keeping that model avoids reserving and releasing replies
  around model calls on four code paths. The conditional update guarantees a balance never goes
  below zero; at most the replies already in flight when the last top-up reply is taken are answered
  without one (in practice 0 to 2), as spec 011 already allows for the month.
- **Spec change**: FR-006 and SC-002 now say this precisely (no negative balance; concurrent replies
  in flight may finish). Recorded in the spec's clarifications.
- **Rejected**: reserving a reply before each model call and releasing it on failure — four call
  sites, a release path for timeouts and crashes, and a sweeper for leaked reservations, to save
  cents.

## R5. Founder tool

- **Decision**: `plan.ts` gains `topup` (`--workspace --replies <1..100000> --note [--yes]`, `--yes`
  required above 5,000), `topups` (list with balance and expiry; also part of `plan:show`), and
  `topup-correct` (`--top-up <uuid> --remaining <n> --note`, only lowering the unused balance). Each
  writes one security event (`workspace.ai_top_up_added`, `workspace.ai_top_up_corrected`) with short
  values only; notes stay on the row. The CLI also reads the database connection in parts, like
  `migrate`, so it runs on AWS.
- **Rationale**: Same model as `plan:set` (spec 011 R8). A flag instead of an interactive prompt
  because on AWS the tool runs as a one-off task with no terminal.
- **Decision**: `scripts/aws-task.sh <stage> plan <subcommand> [args…]` runs the tool as the API
  task (like `migrate` and `demo-seed`), building the command override as JSON with `python3` so
  notes with spaces and quotes are passed safely.

## R6. Plan screen, banner, and emails

- **Decision**: `GET plan` adds `aiReplies.minimum` and `topUps { balance, items[] }` (remaining,
  granted, added, expires; no notes). The screen shows the month (used capped at the allowance), the
  top-up balance with each expiry, and "Pedir más respuestas" (the contact address with a prefilled
  subject and the workspace ID). The banner: month at 80% → warning with "ask for more"; month used
  up with a balance → "the month is used up; your top-up keeps answering (N left)"; month used up
  and no balance → paused until the 1st, with "ask for more".
- **Decision**: The 80% and 100% emails mention top-ups and how to ask; the 100% email says the AI
  keeps answering from the top-up when a balance exists. A new `plan.top_up_used_up` email goes to
  owners once per top-up when it reaches zero (claimed with `exhausted_notified_at` by the 5-minute
  plan usage job).
- **Rationale**: FR-011 to FR-013; reuses the existing job and banner.

## R7. Pilot report

- **Decision**: `chat_usage_daily` gains `top_up_replies`. The pilot report adds, per current plan,
  replies from allowances (`replies − top_up_replies`), replies from top-ups, and AI cost per reply
  (`cost_usd_micros / replies`), demo workspaces excluded as before.
- **Rationale**: FR-015 and SC-005 (price top-ups from measured cost).

## R8. Public home page

- **Decision**: The pooled line reads "300 AI replies a month per active property, pooled, at least
  500" from the catalog's `minimum`; Free shows 500.
- **Rationale**: Spec 014 builds the plans block from the enforced numbers; the text follows them.
