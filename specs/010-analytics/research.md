# Research: Basic Analytics

**Feature**: [spec.md](spec.md) · **Date**: 2026-11-18

## R1. Read on request, no analytics store

- **Decision:** The API computes each view on request from the records and daily counts Guidesk
  already keeps: `guide_open_daily` (spec 004), `agent_trace` with its conversation (specs 005 to 007),
  `explore_open_daily` and `experience_click_daily` (spec 009), `service_request_daily` and
  `service_request` (spec 008), and `stay`. No new table; one column and two indexes (R4, R5).
- **Rationale:** FR-016 (no new personal data), constitution VII (no new datastore). Volumes in the
  pilot are small (a workspace with 50 properties and 90 days is tens of thousands of traces at most);
  the timing test (SC-003) guards the 500 ms budget. A daily summary table stays possible later
  without changing the screen (spec assumption).
- **Alternatives considered:** a nightly rollup table (more moving parts, stale numbers, a second
  source of truth); an analytics product such as PostHog (sends data to a third party, adds guest
  tracking, against FR-016 and SEC-20).

## R2. Periods and days

- **Decision:** Periods are 7, 30, or 90 days ending today, counted by day in each property's time
  zone (`UTC` when unset, flagged in the response). The previous period is the same number of days
  right before. In SQL each property row carries `today = (now() AT TIME ZONE tz)::date`; a record
  belongs to the current period when its local day is in `(today - N, today]` and to the previous one
  when it is in `(today - 2N, today - N]`. Daily count tables already store the property's local day.
- **Rationale:** FR-003, FR-004; matches how specs 004, 008, and 009 store days.
- **Alternatives considered:** one workspace time zone (wrong for workspaces across zones); UTC days
  (misplaces late-evening questions, spec edge case).

## R3. What a guest question is, and its outcome

- **Decision:** A guest question is an `agent_trace` with a `conversation_id` (tests and copilot runs
  have `assistant_test_id` or `copilot_run_id` instead, so FR-007 holds by construction) whose
  decision is not `greeting`. Outcomes by decision:
  - `answered`, `pointer` → answered automatically (the reply reached the guest with no member);
  - `drafted`, `paused` → answered with the host (a member reviews the draft or has taken over);
  - `held` → escalated.
  Escalation reasons are the trace's `reason` for held and drafted traces, excluding the bookkeeping
  reasons `draft_ready` and `taken_over`. Topics are `classification->>'topic'`, excluding `greeting`;
  traces without a classification (limits, pauses) count under `other`.
- **Rationale:** FR-006 to FR-008, the spec's clarifications. Traces are the one record per handled
  message with the decision, reason, topic, and cost; chat messages alone don't say who answered.
- **Alternatives considered:** counting from `chat_message` authors (misses drafts and holds);
  counting a question as automatic only when the draft was never edited (drafts are a host review by
  definition, so they are "with the host").

## R4. Stays that opened the guide

- **Decision:** Add `stay.guide_opened_at` (timestamptz, nullable): the first time any stay link of the
  stay started a guest session. The API sets it in the stay-session exchange when it is null. The
  migration backfills it from existing `guide_session` and `stay_link` rows. "Stays that opened the
  guide" in a period are stays whose `guide_opened_at` local day is in the period. The attach rate is
  those stays with at least one `service_request` ÷ those stays.
- **Rationale:** FR-005, FR-011. Stay links and sessions are deleted 30 days after checkout (spec 004
  retention), so they can't answer a 90-day question; a timestamp on the stay is not personal data
  and lives as long as the stay.
- **Alternatives considered:** a daily count of stays (distinct stays can't be summed across days); a
  separate event table (new store for one fact).

## R5. Indexes for the period queries

- **Decision:** `agent_trace_workspace_created_idx` on `(workspace_id, created_at)` where
  `conversation_id IS NOT NULL`, and `stay_property_opened_idx` on `(property_id, guide_opened_at)`
  where `guide_opened_at IS NOT NULL`. The daily count tables are already keyed by property and day.
- **Rationale:** SC-003; RLS adds `workspace_id` to every query, and traces are the largest table read.

## R6. Unanswered questions

- **Decision:** Traces with reason `not_confident` (the assistant didn't know), joined to the guest
  message (`guest_message_id` → `chat_message.body`) and the property, newest first, 20 per page with an
  opaque cursor (`created_at`, `id`). Each item has the conversation ID for the link to the
  conversation screen (spec 006). Text is returned as JSON and rendered as React text (AC-SEC-003).
  When retention deletes the conversation, its traces and messages go with it (cascade), so the item
  disappears; R8 explains why the counts of every period the screen offers are unaffected.
- **Rationale:** FR-009, AC-SEC-004.

## R7. Comparison when there was nothing to compare

- **Decision:** When the previous period starts before the property was created (property view) or
  before the workspace was created (workspace view), changes read "no comparison yet". Rates with a
  zero denominator are `null` and show "—" with a hint. Changes are an absolute difference and a
  relative one (null when the previous value is 0).
- **Rationale:** FR-004, FR-015, spec edge cases. All counts ship before the pilot starts, so the
  "feature started counting mid-period" case reduces to young properties and workspaces.
- **Alternatives considered:** per-feature launch dates in code (unknown until deploy; wrong for
  self-hosted test data).

## R8. Retention and counts from traces

- **Decision:** Question counts come from traces, which retention deletes with their conversation 12
  months after checkout. Periods are at most 90 days (plus 90 for comparison), well inside retention,
  so counts are stable for every period the screen offers. Guide opens, Explore, and request counts
  come from daily tables that retention keeps.
- **Rationale:** FR-016; the spec's "counts stay" edge case holds for every period the screen shows.

## R9. Access and routes

- **Decision:** `GET /api/v1/workspaces/{ws}/analytics?period=7|30|90[&propertyId=]` and
  `GET /api/v1/workspaces/{ws}/analytics/unanswered?period=…[&propertyId=][&cursor=]`, both under the
  `conversations.handle` permission (owners, admins, agents), RLS, and the cross-tenant 404 with a
  security event for foreign properties. Strict query schemas refuse other periods (AC-SEC-002).
- **Rationale:** FR-001, FR-002, SEC-05, SEC-14.

## R10. Portal screens without a chart library

- **Decision:** `/analytics` (workspace) and `/properties/{id}/analytics`, one client component with
  a period control (three radio buttons styled as a segmented control), number cards with the change,
  bar lists drawn as `<li>` rows with a width-percent bar marked `aria-hidden` next to the visible
  numbers (so every bar is also text, FR-014), a sortable table (`<button>` headers with
  `aria-sort`), and the unanswered list. A header link "Analytics" / "Estadísticas" and a card on the
  property page. Constants live in `apps/portal/lib/analytics.ts` (not `@guidesk/contracts/values`).
- **Rationale:** FR-012 to FR-015, SC-004 (150 KB per route). A chart library would cost 30 to 60 KB.

## R11. The founder's pilot report

- **Decision:** `packages/db/src/reports/pilot.ts` computes the six PRD §8 metrics for a sign-up
  cohort (`--from`, `--to`) with system privileges; `packages/db/src/cli/pilot-report.ts` prints a
  table with the targets (and `--json`). Definitions:
  - Activation: users whose sign-up is in the cohort and who, within 7 days, own a workspace with a
    published guide that a guest opened (any `guide_open_daily` row on or before day 7).
  - Time to guide: median from sign-up to the first publication of a guide in a workspace they own.
  - Automated resolution rate: R3 over the cohort's workspaces since sign-up.
  - Attach rate: R4 over the cohort's workspaces (requests; clicks are per property).
  - Host retention at day 60: cohort users with a successful sign-in or a session refresh during days
    53 to 60 after sign-up, among users whose day 60 has passed.
  - AI cost per stay served: all recorded AI cost (traces, guide AI requests, listing extractions) in
    the cohort's workspaces ÷ stays that opened the guide.
  Output holds counts, percentages, and money only; no names, emails, or IDs (FR-018, AC-SEC-005).
- **Rationale:** PRD §8, FR-017, FR-018; the report runs where migrations run (founder's machine or a
  one-off task), never through the API.
- **Alternatives considered:** an admin page in the portal (a new privileged surface for one person).

## R12. Founder gates and implementation notes

- **Gates:** none new; the report needs database access in staging and production once AWS exists.
- **Notes:** filled in during implementation.
