# Data Model: AI Reply Allowances and Top-ups

**Feature**: [spec.md](spec.md) · **Migration**: `0039_ai_top_ups`

## Plan catalog (domain, no storage)

| Plan | Monthly AI replies |
|---|---|
| Free | fixed 500 per workspace (pilot) |
| Pro | pooled: 300 per active property, minimum 500 |
| Business | pooled: 300 per active property, minimum 1,000 |

`effectiveLimits().aiReplies` → `{ limit, source, perProperty, minimum }`; a custom
`workspace.ai_reply_monthly_limit` replaces `limit` and reports `perProperty` and `minimum` as null.

## `ai_top_up` (new)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | random |
| `workspace_id` | uuid FK → workspace, cascade | |
| `replies_granted` | integer | 1 to 100,000; lowered only by a correction |
| `replies_used` | integer, default 0 | 0 ≤ used ≤ granted (check) |
| `created_at` | timestamptz, default now() | "added" |
| `expires_at` | timestamptz | `created_at + 12 months`, set on insert |
| `note` | text | 1 to 200 characters |
| `corrected_at` | timestamptz, null | set by a correction |
| `correction_note` | text, null | 1 to 200 characters when set |
| `exhausted_notified_at` | timestamptz, null | when the "used up" email was claimed |

- Index: `(workspace_id, created_at)`; partial index `(workspace_id, created_at) WHERE replies_used <
  replies_granted` for the balance and oldest-first pick.
- **Balance** of a workspace at `now`: `sum(replies_granted − replies_used)` over rows with
  `expires_at > now`.
- **RLS**: system policy for the worker and the founder tool (`TO CURRENT_USER`); members of the
  request's workspace may `SELECT` (plan screen), as `chat_usage_daily_read` does. No `INSERT`,
  `UPDATE`, or `DELETE` grant to the app role.
- **Retention**: rows stay with the workspace (founder history); deleted with it.

## `chat_usage_daily` (changed)

| Column | Type | Rules |
|---|---|---|
| `top_up_replies` | integer, default 0 | ≤ `replies`; replies of that day paid from a top-up |

## Security events (new types)

| Type | Metadata (short values only) |
|---|---|
| `workspace.ai_top_up_added` | `replies`, `expiresOn` (date) |
| `workspace.ai_top_up_corrected` | `from` (remaining before), `to` (remaining after) |

Actor: none (shown as Guidesk), as `workspace.plan_changed`.

## State of a top-up

```text
added (used 0) → in use (0 < used < granted) → used up (used = granted) → email claimed
            \______________________ expired (expires_at ≤ now): no longer counts ______/
correction: granted = used + new remaining (only lower)
```
