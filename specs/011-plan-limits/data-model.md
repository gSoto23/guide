# Data Model: Plan Limits

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migration `0035_plan_limits.sql`.

## Plan catalog (code, not a table)

| Plan | Active properties | AI replies per UTC month | Seats |
|---|---|---|---|
| `free` | 2 | 100 | 1 |
| `pro` | unlimited | `max(300, 300 × active properties)` | 3 |
| `business` | unlimited | `max(300, 300 × active properties)` | unlimited |

Effective limit = custom limit ?? plan value ([R2](research.md#r2-effective-limits)). Derived daily
limits use the basis `property limit ?? active properties + 2` (at least 2).

## workspace (changed)

| Column | Type | Rules |
|---|---|---|
| plan | text not null default `'free'` | `IN ('free', 'pro', 'business')` |
| plan_changed_at | timestamptz null | set by the founder tool |
| ai_reply_monthly_limit | integer null | custom limit; `> 0` |
| seat_limit | integer null (existing) | now a custom limit; null = the plan's |
| property_limit | integer null (existing) | now a custom limit; null = the plan's |

RLS and grants unchanged. Members never update these columns: the API has no route that writes them
(AC-SEC-002), and the founder tool runs with the migration user's privileges.

## plan_usage_notice (new, system only)

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid | FK workspace, cascade |
| month | date | first UTC day of the month |
| threshold | smallint | `IN (80, 100)` |
| notified_at | timestamptz | default now() |

Primary key `(workspace_id, month, threshold)`. RLS enabled with no member policy (only the worker,
with system privileges, reads and writes it), like `chat_usage_daily`'s notices. Retention deletes rows
older than 13 months (same job and horizon as `chat_usage_daily`).

## Values without migrations

- Needs-host and trace reason `monthly_limit` (with `limit` for the daily budgets).
- Copilot run outcome and assistant test outcome `monthly_limited` (with `limited`).
- Security event `workspace.plan_changed`: `actor_user_id` null, `workspace_id`, metadata
  `{ from, to, custom: { properties, seats, aiReplies }, previousCustom: {…}, note }`.

## Sources read

| Usage | Source | Rule |
|---|---|---|
| Active properties | `property` | `status = 'active'` |
| Seats in use | `membership` + `invitation` | members plus pending (not expired, not revoked, not accepted) |
| AI replies this month | `chat_usage_daily.replies` | `workspace_id`, `day >= date_trunc('month', now() at time zone 'utc')` |
