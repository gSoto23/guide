# Tasks: Stay Calendar and Guest Details

**Input**: Design documents from `/specs/018-stay-calendar/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/http-api.md](contracts/http-api.md)

**Tests**: The constitution requires tests first (principle V); each story starts with its tests.

## Phase 1: Setup

- [ ] T001 Confirm the baseline builds (`pnpm --filter @guidesk/db --filter @guidesk/domain build`)

## Phase 2: Foundational (blocking)

- [ ] T002 Schema: `guest_details_source` (`feed`|`pms`|`host`, null), `guest_details_by` (FK user, set null), `guest_details_at` on `stay`; check `stay_ical_guest_data` replacing `stay_ical_no_guest_data` (ical: name and count only when source `host`; booking reference allowed); index `conversation_stay_idx` in packages/db/src/schema/stays.ts and chat.ts
- [ ] T003 Generate migration packages/db/migrations/0040_stay_guest_details.sql (move Finder copies aside), then append the replacement of `stay_guard_request_changes()` allowing `guest_name`, `guest_count`, `guest_details_*` changes on feed and PMS stays (removed names still final); prettier on meta
- [ ] T004 [P] Security event `stay.guest_details_changed` (`stayId`, `name`, `count`) in packages/domain/src/security-events.ts
- [ ] T005 [P] Contracts: packages/contracts/src/calendar.ts (calendar query and response, stay overview), `guestDetails` on `Stay`, `stayGuestBodySchema`, `stayId`/`guestName` on inbox and conversation types, `stayId` on the service-request list query

## Phase 3: User Story 1 — Calendar (P1)

- [ ] T006 [US1] Tests first: domain calendar helpers (range validation ≤ 62 days, month bounds, bar placement across month edges, agenda grouping by day) in packages/domain/test/calendar
- [ ] T007 [US1] Domain helpers in packages/domain/src/calendar/index.ts
- [ ] T008 [US1] Tests first: `GET calendar` (ranges, marks, cancelled and hidden, filters, isolation, agents allowed, timing 50 × 400) in apps/api/test/integration/calendar.test.ts
- [ ] T009 [US1] `CalendarModule` (controller + service) in apps/api/src/calendar/, registered in apps/api/src/app.module.ts
- [ ] T010 [US1] Portal calendar page and components (all properties timeline, property month grid, agenda below 768 px, filters in localStorage, today, month navigation, marks with text alternatives) in apps/portal/app/[locale]/(app)/calendar/page.tsx and apps/portal/components/calendar/
- [ ] T011 [US1] Navigation entry "Calendario" (sidebar; "Más" on phones) in apps/portal/components/shell/destinations.ts; texts in packages/i18n/messages/es.json and en.json

## Phase 4: User Story 2 — Stay view (P1)

- [ ] T012 [US2] Tests first: `GET stays/{id}` (stay, link state, conversations, requests with payments, totals per currency, agents read, other workspace 404) in apps/api/test/integration/stay-overview.test.ts
- [ ] T013 [US2] Stay overview in apps/api/src/calendar/stay-overview.service.ts reusing the link state of apps/api/src/share/stay-links.service.ts and the request mapping of apps/api/src/extras/service-requests.service.ts (`stayId` filter)
- [ ] T014 [US2] Portal stay page (details, link state with Share link for owners and admins, conversations to the inbox, requests with confirm and decline through the existing request actions, totals) in apps/portal/app/[locale]/(app)/calendar/stays/[stayId]/page.tsx and components/calendar/stay-view.tsx

## Phase 5: User Story 3 — Guest details (P2)

- [ ] T015 [US3] Tests first: sandbox parser returns the reservation code from URL or DESCRIPTION and nothing else (apps/sandbox/test), domain extraction helper (packages/domain/test)
- [ ] T016 [US3] `reference` in the sandbox protocol (both sides) and the parser; feed inserts and refreshes write `booking_reference` (apps/worker/src/jobs/calendar-refresh.ts, apps/api/src/calendar-feeds/calendar-feeds.service.ts, apps/worker/src/jobs/csv.ts)
- [ ] T017 [US3] Tests first: `PUT stays/{id}/guest` (owner sets on a feed stay, refresh keeps it, PMS refresh keeps host details, agent 403, removed name 409, security event without the name) in apps/api/test/integration/stay-guest.test.ts and apps/worker/test/integration
- [ ] T018 [US3] Route and service in apps/api/src/stays; PMS `applyReservations` keeps host details in apps/worker/src/jobs/pms-common.ts; retention clears source columns in apps/worker/src/jobs/retention.ts
- [ ] T019 [US3] Portal: "Editar huésped" on the stay page and the stays list; "Guardar nombre del huésped" in the conversation view (owners and admins, conversation with a stay)

## Phase 6: User Story 4 — Host-side names (P2)

- [ ] T020 [US4] Tests first: inbox and conversation responses carry `stayId` and `guestName`; the stay message greets by name; the guest guide and assistant context carry no name (apps/api/test/integration, packages/domain/test)
- [ ] T021 [US4] Inbox and conversation services and portal rows/headers show the name in apps/api/src/inbox, apps/api/src/conversations, apps/portal/components/inbox, apps/portal/components/conversations
- [ ] T022 [US4] Stay message greeting with the name in packages/domain/src/guest/messages.ts and apps/api/src/share/stay-messages.service.ts

## Phase 7: Polish

- [ ] T023 Demo seed: name one stay and give feed stays a reference so the calendar demo shows both (apps/api/src/demo/seed.ts)
- [ ] T024 Docs: PRD F22 built note, roadmap, presentation (018 built), pilot readiness (OQ-39 check still open)
- [ ] T025 Run typecheck, lint, unit tests, affected integration suites, i18n tests, prettier, and the portal bundle check
- [ ] T026 Commit, PR, merge when checks pass, check staging

## Dependencies

Phase 2 blocks all. US1 and US2 share the calendar module; US3 and US4 are independent of US1/US2
except the stay page's edit action (T019 after T014).
