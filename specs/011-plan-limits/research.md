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
  `workspace.plan_changed` (actor none, shown as Guidesk; metadata: previous and new plan and custom
  limits, note) in one transaction. `plan:show` prints the plan, each limit with its source, and usage.
- **Rationale:** FR-017 to FR-020; same pattern as `report:pilot` (runs where migrations run). No API
  route can write `plan` or custom limits (AC-SEC-002).

## R9. API and screens

- **Decision:** `GET /api/v1/workspaces/{ws}/plan` for the `workspace.settings` capability (owners and
  admins) returns the plan, each limit with usage and source, the renewal moment, the workspace ID, and
  the contact address (`PLAN_CONTACT_EMAIL`, optional). Limit errors keep their codes
  (`plan_limit_reached`, `seat_limit_reached`) with `{limit, used}`. Portal: `/settings/plan` (H-32)
  with meters drawn as `<meter>` plus visible text, a link from settings, and a banner loaded on demand
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
