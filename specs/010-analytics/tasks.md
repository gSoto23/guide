---

description: "Task list for feature 010: basic analytics"
---

# Tasks: Basic Analytics

**Input**: Design documents from `/specs/010-analytics/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story.

> **Production gates (not development gates):** none new; the pilot report needs database access in
> staging and production once AWS exists.

## Format: `[ID] [P?] [Story] Description`

Conventions: routes need `conversations.handle`; periods are 7, 30, or 90 days by the property's local
day; tests and copilot runs never count; guest text only in the unanswered list, as plain text;
synthetic test data only.

---

## Phase 1: Setup

- [X] T001 [P] Portal catalogs: `analytics` namespace (period control, cards, changes, "no comparison yet", "—" hints, topics, reasons, outcomes, Explore, requests, table headers and sort, unanswered list, empty state, UTC note) and header link in `packages/i18n/messages/`

## Phase 2: Foundational

- [X] T002 [P] Domain `packages/domain/src/analytics/` with unit tests: period bounds per time zone, `comparable`, change `{ absolute, relative | null }`, rate (null on 0), trace decision → outcome (`answered`/`pointer` automatic, `drafted`/`paused` with host, `held` escalated, `greeting` excluded), counted escalation reasons (without `draft_ready`, `taken_over`), topics without `greeting`
- [X] T003 Schema `stay.guide_opened_at` in `packages/db/src/schema/stays.ts`; migration `0034_analytics.sql`: column, backfill from `guide_session` and `stay_link` (first session time per stay), `stay_property_opened_idx`, `agent_trace_workspace_created_idx`; test the backfill in `packages/db/test/integration/`
- [X] T004 [P] Contracts `packages/contracts/src/analytics.ts`: `analyticsQuerySchema` (strict; `period` "7"|"30"|"90", optional `propertyId`), `unansweredQuerySchema` (+ `cursor`), response types per [contracts/http-api.md](contracts/http-api.md)
- [X] T005 The stay-session exchange sets `stay.guide_opened_at` once in `apps/api/src/guest/sessions.service.ts`; API test

## Phase 3: User Story 1 - Property analytics (P1) 🎯 MVP

**Goal**: views, stays opened, questions by outcome, resolution rate, and changes for one property.

**Independent Test**: seeded opens, sessions, and traces over 60 days give the expected numbers for 7, 30, and 90 days.

- [X] T006 [P] [US1] API tests `apps/api/test/integration/analytics.test.ts`: views by kind, stays opened, questions by outcome, tests and copilot excluded, previous period and `comparable`, time zone day edges, UTC fallback, empty period
- [X] T007 [US1] `apps/api/src/analytics/` (module, controller, service): `GET analytics` for a property; registered in the app module
- [X] T008 [US1] Portal `app/[locale]/(app)/properties/[propertyId]/analytics/page.tsx` and `components/analytics/` (period control, number cards with change, outcome bars as text and bars), `lib/analytics.ts`; card on the property page; bundle budget entry

## Phase 4: User Story 2 - Topics, escalations, unanswered (P1)

**Goal**: ranked topics, escalation reasons, and the unanswered list with links.

**Independent Test**: seeded topics, reasons, and unanswered traces are ranked, counted, and listed newest first; a deleted conversation's question disappears.

- [X] T009 [P] [US2] API tests: topics ranked, reasons counted, unanswered list order, cursor, plain text, deleted conversation gone, property filter
- [X] T010 [US2] Topics and escalations in the analytics service; `GET analytics/unanswered` with cursor
- [X] T011 [US2] Portal: topic and reason bar lists, unanswered list with "Show more" and links to conversations

## Phase 5: User Story 3 - Workspace comparison (P2)

**Goal**: workspace totals and a sortable property table.

**Independent Test**: totals equal rows; sorting; 50 rows then "Show all"; removed properties marked and included.

- [X] T012 [P] [US3] API tests: workspace totals equal property rows, removed properties with activity included and marked, rates from totals
- [X] T013 [US3] Workspace view in the analytics service (property rows)
- [X] T014 [US3] Portal `app/[locale]/(app)/analytics/page.tsx`, sortable table with `aria-sort`, first 50 rows and "Show all", header link; bundle budget entry
- [X] T015 [P] [US3] End-to-end `e2e/specs/analytics-us1.spec.ts` (quickstart 1 and 2) and `analytics-us3.spec.ts` (quickstart 3)

## Phase 6: User Story 4 - Explore and add-ons (P2)

**Goal**: Explore opens, clicks per partner, requests by status, attach rate.

**Independent Test**: seeded Explore counts and requests give the expected numbers and attach rate.

- [X] T016 [P] [US4] API tests: Explore opens, clicks per partner (no amounts), requests made and by status, stays with a request
- [X] T017 [US4] Explore and requests in the analytics service; portal sections with the attach rate

## Phase 7: User Story 5 - Founder pilot report (P3)

**Goal**: the six pilot metrics across workspaces, aggregates only.

**Independent Test**: a seeded cohort gives each metric; the output holds no names, emails, or IDs.

- [X] T018 [P] [US5] Tests `packages/db/test/integration/pilot-report.test.ts`: activation, time to guide, resolution rate, attach rate, retention at day 60, AI cost per stay; output free of names and emails
- [X] T019 [US5] `packages/db/src/reports/pilot.ts` and `src/cli/pilot-report.ts`; script `report:pilot` with `--from`, `--to`, `--json`

## Phase 8: Polish

- [X] T020 [P] Cross-tenant cases for both routes in `apps/api/test/integration/cross-tenant.test.ts`
- [X] T021 [P] Security review tests `security-review-010` (AC-SEC-001 to 005)
- [X] T022 [P] Timing test `analytics.perf.test.ts`: 50 properties × 90 days, p95 ≤ 500 ms and ≤ 300 ms
- [X] T023 [P] Accessibility: axe on the property and workspace views and the unanswered list
- [X] T024 Docs: overview, screens H-34, README for the report, research R12 notes
- [X] T025 Run the quickstart locally and record it in research R12

## Dependencies

- T002 to T005 block the stories. US1 (T006 to T008) first; US2 and US4 extend the same service and
  view; US3 needs US1's service; US5 is independent of the portal.

## Parallel examples

- T002, T004, and T001 in parallel; T018 and T019 alongside any portal work.

## Implementation strategy

MVP is US1 (property analytics); then US2 (unanswered questions), US3, US4, and the report.
