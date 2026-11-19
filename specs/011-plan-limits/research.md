# Research: Plan Limits

**Feature**: [spec.md](spec.md) · **Date**: 2026-11-18

## R1. The plan catalog lives in code

- **Decision:** `packages/domain/src/plans/` defines `PLANS = ["free", "pro", "business"]` and each
  plan's limits (FR-002). The workspace stores only its plan key and optional custom limits. Unlimited
  is `null`.
- **Rationale:** the numbers are a hypothesis the founder changes with a deploy (OQ-10); one file, one
  test. Billing in Phase 2 will map provider products to these keys.
- **Alternatives considered:** a `plan` table (a second source of truth with no screen to edit it);
  limits copied onto every workspace (a plan change would need a data migration).

## R2. Effective limits

- **Decision:** a pure domain function takes the plan, the custom limits, and the active property count
  and returns the effective limits: properties `custom ?? plan` (null = unlimited), seats the same, and
  monthly AI replies `custom ?? (Free 100 | max(300, 300 × active properties))`. Derived daily limits
  (extractions, guide AI requests, media storage) use a basis of `property limit ?? active + 2`, never
  below 2 (FR-005).
- **Rationale:** one rule for API and worker; the existing derived formulas keep their meaning.
- **Loader:** `workspaceLimitInputs(db, workspaceId)` in the db package reads the plan, the custom
  limits, and the active properties in one query, under RLS for members or with system privileges for
  jobs.

## R3. Counting AI replies per month

- **Decision:** sum `chat_usage_daily.replies` for the workspace from the first UTC day of the month.
  That table already counts every model reply or draft per property and UTC day (guide chat,
  copilot, tests; spec 005 R8) and is kept 13 months. Its `(workspace_id, day)` index serves the sum.
- **Rationale:** FR-006 matches what is already counted; no new counter.
- **Alternatives considered:** a monthly counter row (a second counter to keep in step); counting
  traces (tests and copilot runs are in other tables).

## R4. Stopping at the monthly limit

- **Decision:** the existing budget check before the first model call reads today's and this month's
  usage together. The monthly limit is checked first: in the guide chat the trace and the conversation
  get the reason `monthly_limit` and the guest gets the holding reply (no model call); a copilot run ends
  `monthly_limited`; a test ends `monthly_limited`. The daily budgets keep reason `limit` and outcome
  `limited` (FR-008). A reply whose check passed finishes and counts, so a month may end above its
  limit by the replies in progress (bounded by worker concurrency).
- **Rationale:** FR-007, SC-001; the reasons, outcomes, and labels already exist for the daily case.
  Reason and outcome columns are text without database checks, so the new values need no migration.
- **Alternatives considered:** reserving a reply before the model call (exact, but every failure path
  would have to release the reservation).

## R5. Threshold emails

- **Decision:** a worker job `plan-usage.tick` every 5 minutes finds workspaces with usage this month,
  computes each one's limit, and for each threshold crossed (80%, 100%) inserts
  `plan_usage_notice (workspace_id, month, threshold)` with `ON CONFLICT DO NOTHING`; only a new row
  queues the email to each owner in their language (`plan.ai_usage`).
- **Rationale:** FR-009, SC-005; one place, outside the reply path, and it also catches a lower limit
  set by the founder. Five minutes is well inside "promptly" for a monthly limit.
- **Alternatives considered:** checking after each recorded reply (three call sites, extra latency).

## R6. Properties

- **Decision:** `lockPropertySlots` also returns the plan; `PropertyLimitService`, the import jobs,
  and the PMS preview use the effective property limit. Unlimited plans have no cap (imports take every
  selected property). Removed properties never count (unchanged).
- **Rationale:** FR-010; the row lock already prevents overshoot under concurrency.

## R7. Seats

- **Decision:** the seat provider returns the effective seat limit (`null` = unlimited) and the
  invitation check keeps "members plus pending invitations"; pending invitations keep their seat after
  a downgrade and can be accepted (spec edge case). Sending an invitation locks the workspace row
  before counting, so concurrent invitations cannot exceed the limit (AC-SEC-004).
- **Rationale:** FR-011, FR-012.

## R8. The founder tool

- **Decision:** `pnpm --filter @guidesk/db plan:set -- --workspace <uuid> --plan free|pro|business
  [--properties N|plan] [--seats N|plan] [--ai-replies N|plan] --note "…"` and
  `plan:show -- --workspace <uuid>`. `plan:set` updates the workspace and writes a security event
  `workspace.plan_changed` (actor none, shown as Guidesk; metadata: previous and new plan and the new
  custom limits) in one transaction. The note is stored in `workspace.plan_note`, because the security
  log accepts only short values, never free text. `plan:show` prints the plan, each limit with its source, and usage.
- **Rationale:** FR-017 to FR-020; same pattern as `report:pilot` (runs where migrations run). No API
  route can write `plan` or custom limits (AC-SEC-002).

## R9. API and screens

- **Decision:** `GET /api/v1/workspaces/{ws}/plan` for the `workspace.settings` capability (owners and
  admins) returns the plan, each limit with usage and source, the renewal moment, the workspace ID, and
  the contact address (`PLAN_CONTACT_EMAIL`, optional). Limit errors keep their codes
  (`plan_limit_reached`, `seat_limit_reached`) with `{limit, used}`. Portal: `/settings/plan` (H-32)
  with each limit as text and a bar that repeats it (R11), a link from settings, and a banner loaded on demand
  in the signed-in layout for owners and admins at 80% and 100% (refetched on navigation, like the
  import banner). Limit messages for properties and seats link to the screen for owners and admins.
- **Rationale:** FR-013 to FR-016; loading the banner on demand keeps its code out of every route's
  initial JavaScript (150 KB budget).

## R10. Existing workspaces and tests

- **Decision:** migration `0035_plan_limits` adds `workspace.plan` (default `free`),
  `plan_changed_at`, and `ai_reply_monthly_limit`; existing `seat_limit` and `property_limit` values
  stay as custom limits. Workspaces without a seat limit move from the pilot default of 10 to Free's
  1; nothing is removed (FR-012). Test helpers that build teams set the plan they need.
- **Rationale:** spec assumptions; staging and production do not exist yet, so no live workspace
  changes behavior unexpectedly.

## R11. Founder gates and implementation notes

- **Gates:** none new for development. Before the pilot: the founder sets `PLAN_CONTACT_EMAIL` and
  moves design partners to Pro or Business with `plan:set`; the plan numbers stay open (OQ-10).
- **Notes:**
  - The security log accepts short values only, so `workspace.plan_changed` records the plans and the
    new custom limits, and the founder's note lives in `workspace.plan_note` (shown by `plan:show`,
    never returned by the API).
  - The app role has no update grant on the plan columns (only `name`, `updated_at`, and
    `assistant_autonomy`), so no API bug can raise a plan; the security review test checks the grants.
  - Limit bars follow the Analytics pattern (a bar marked `aria-hidden` next to visible text) instead
    of `<meter>`, so every bar is also text.
  - The banner is loaded with a plain dynamic import after the page: about 0.2 KB of initial
    JavaScript per route; the largest route stays at 148.7 KB.
  - Test helpers give the teams they build 10 seats as a custom limit (the old pilot default), and the
    end-to-end team tests move their workspace to Business with the founder tool before inviting.
  - Invitations already serialize per workspace with an advisory lock, so 10 racing invitations for
    the last seat give exactly one.
  - Timing: 50 properties with 60 days of usage, `GET plan` well within p95 300 ms on a development
    machine.
  - Local quickstart (2026-11-19 UTC): scenarios 1 and 2 pass in `plan-us1` (holding reply at the
    limit, inbox reason, copilot message, banner, Free property and seat refusals with the link);
    scenarios 3 and 4 in `plan-us4` (the founder tool moves the workspace to Business, the screen and
    the security log follow, an agent can't open the screen); the local worker's `plan-usage.tick`
    sent each test owner one "used up" email (Mailpit). The 80% email is covered by the worker tests.
  - The "needs you" email and push name the monthly limit (`monthly_limit` texts in the email
    package), checked in the worker tests.
