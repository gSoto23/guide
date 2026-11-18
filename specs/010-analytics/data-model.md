# Data Model: Basic Analytics

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migration `0034_analytics.sql`. No new table; analytics are computed from existing records
([R1](research.md#r1-read-on-request-no-analytics-store)).

## stay (changed)

| Column | Type | Rules |
|---|---|---|
| guide_opened_at | timestamptz null | First time a stay link of the stay started a guest session; set once by the stay-session exchange; backfilled from `guide_session` and `stay_link` |

Index `stay_property_opened_idx (property_id, guide_opened_at) WHERE guide_opened_at IS NOT NULL`.
RLS and grants are unchanged (the column belongs to an existing tenant table).

## agent_trace (index only)

Index `agent_trace_workspace_created_idx (workspace_id, created_at) WHERE conversation_id IS NOT NULL`.

## Sources read

| Number | Source | Rule |
|---|---|---|
| Guide views | `guide_open_daily (property_id, day, link_kind, opens)` | sum per kind, local day |
| Stays that opened the guide | `stay.guide_opened_at` | local day in the period |
| Guest questions | `agent_trace` with `conversation_id`, decision ≠ `greeting` | local day of `created_at` in the property's zone |
| Outcome | `agent_trace.decision` | `answered`/`pointer` automatic; `drafted` for review and `paused` with the host; `held` and `drafted` with an escalation reason escalated |
| Escalation reasons | `agent_trace.reason` for `held` and `drafted` | without `draft_ready`, `taken_over` |
| Topics | `agent_trace.classification->>'topic'` | without `greeting`; missing → `other` |
| Unanswered | `agent_trace.reason = 'not_confident'` + `chat_message.body` (guest message) | newest first, 20 per page |
| Explore | `explore_open_daily`, `experience_click_daily (partner)` | counts only |
| Add-on requests | `service_request_daily (status)` | `waiting` rows = requests made; other statuses = transitions |
| Attach rate | `stay.guide_opened_at` + `service_request.stay_id` | stays with ≥ 1 request ÷ stays that opened |

## Derived shapes (domain)

- **Period**: `days ∈ {7, 30, 90}`; per property `today` in its zone; current `(today − N, today]`,
  previous `(today − 2N, today − N]`; `comparable` when the previous period starts on or after the
  property's (or workspace's) creation day.
- **Change**: `{ absolute, relative | null }`; relative is null when the previous value is 0.
- **Rate**: `numerator ÷ denominator`, null when the denominator is 0.

## Pilot report (founder, outside the portal)

Cohort: users created in `[from, to]`. Metrics and definitions in
[R11](research.md#r11-the-founders-pilot-report). Read with system privileges; output aggregates only.
