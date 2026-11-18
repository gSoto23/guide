---

description: "Task list for feature 008: service catalog and host add-on requests"
---

# Tasks: Service Catalog and Host Add-on Requests

**Input**: Design documents from `/specs/008-service-catalog/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story; the agent eval suite gates the
knowledge change.

> **Production gates (not development gates):** the legal review of extras texts and of early check-in
> and late checkout as extras (OQ-35), and a staging check on a phone with a real stay link.

## Format: `[ID] [P?] [Story] Description`

Conventions: catalog writes need `properties.manage`; request answers need `conversations.handle`;
guest writes take the stay from the session only; notes are plain text and never in alerts or logs;
synthetic test data only.

---

## Phase 1: Setup

- [ ] T001 Queue `service-request.tick` and its schedule in `packages/domain/src/jobs.ts`; push kind `service_request` in `NotificationPushJob`; security events `extras.changed` and `service_request.answered` with allowlists
- [ ] T002 [P] Catalogs: portal `extras` and `requests` namespaces (catalog form, suggestions, rules summary, statuses, reasons, actions, header link) and guest `extras` (list, detail, form, statuses, errors per rule, offline, how to request) in `packages/i18n/messages/`

## Phase 2: Foundational

- [ ] T003 [P] Domain `packages/domain/src/extras/` with unit tests: request rules (research R2: date range, weekday, lead time, max per stay, turnover, needs date and time), the requested moment and expiry in the property's time zone, statuses and transitions, suggestion keys, supported currencies
- [ ] T004 Schema `packages/db/src/schema/extras.ts` (`extra`, `service_request`, `service_request_daily`); generate `0032_service_catalog.sql`; write `0033_service_catalog_rls.sql`; `packages/db/test/integration/extras-rls.test.ts`
- [ ] T005 [P] Contracts `packages/contracts/src/extras.ts` (guest and member shapes, `ExtraInput` with the data model's limits); `GuestGuide.extras.visible`; zod-free values for the portal
- [ ] T006 [P] Emails and push texts in `packages/emails/src/extras/` (new request, Spanish and English; no guest text); tests

## Phase 3: User Story 1 - Catalog (P1) 🎯 MVP

- [ ] T007 [P] [US1] API tests `apps/api/test/integration/extras.test.ts`: create, edit with version, validation, hide, order, copy, delete with waiting requests kept, agents read-only (403 logged), events
- [ ] T008 [US1] API catalog routes in `apps/api/src/extras/`
- [ ] T009 [US1] Portal catalog `app/[locale]/(app)/properties/[propertyId]/extras/page.tsx` and `components/extras/` (suggestions, form with rules, list with order, hide, copy, delete), property card; bundle budget entry

## Phase 4: User Story 2 - Guest requests (P1)

- [ ] T010 [P] [US2] API tests: public list and `extras.visible`; request with a stay session (waiting, pre-approved confirmed); every rule refused with its code; no session, other property, ended window, unverified refused; price and stay never from the body; cancel while waiting; limits and duplicates; counts
- [ ] T011 [P] [US2] Guest app tests: list, detail, "Offered by your host", "Free", form fields per rules, no Request in cached HTML
- [ ] T012 [US2] Guest routes in `apps/api/src/guest/` (extras list, requests list, create, cancel)
- [ ] T013 [US2] Guest app pages `/extras` and `/extras/{id}`, home tile, script for statuses, form, cancel, offline state

## Phase 5: User Story 3 - Host answers and alerts (P1)

- [ ] T014 [P] [US3] API tests: Requests list order and filters, confirm, decline, cancel with reasons, first answer wins, events, cross-workspace 404
- [ ] T015 [P] [US3] Worker tests `apps/worker/test/integration/service-request-tick.test.ts`: alerts to contacts by email and push without notes, quiet hours delay, once per request
- [ ] T016 [P] [US3] End-to-end `e2e/specs/extras-us1.spec.ts` to `extras-us3.spec.ts` (quickstart 1 to 3)
- [ ] T017 [US3] Member request routes; worker `service-request-tick.ts` (alerts); push kind in `notification-push.ts`
- [ ] T018 [US3] Portal Requests screen `app/[locale]/(app)/requests/page.tsx` with filters and actions; header link; bundle budget entry

## Phase 6: User Story 4 - Expiry (P2)

- [ ] T019 [P] [US4] Worker tests: expiry by lead time and 48 hours; stay cancellation cancels waiting requests
- [ ] T020 [US4] Expiry in the tick; stay cancellation hook in the stays service

## Phase 7: User Story 5 - Assistant (P3)

- [ ] T021 [P] [US5] Worker tests: the guide chat's knowledge lists visible extras with the link; the copilot's never
- [ ] T022 [P] [US5] Eval cases (service question with and without extras)
- [ ] T023 [US5] `KnowledgeInput.extras` and answer rule 14; set in the pipeline; never for the copilot

## Phase 8: Polish

- [ ] T024 [P] Cross-tenant cases for the new member routes
- [ ] T025 [P] Security review tests `security-review-008` (AC-SEC-001 to 006)
- [ ] T026 [P] Retention: requests 12 months after checkout; tests
- [ ] T027 [P] Accessibility: axe on Extras, the detail, the catalog, and Requests
- [ ] T028 [P] Timing tests: guest routes and the Requests route with 1,000 requests; Lighthouse URL for Extras
- [ ] T029 Docs: security, overview, screens G-08, G-09, H-23, H-27, research R10 notes
- [ ] T030 Run the quickstart locally and record it in research R10

## Dependencies

- Phase 2 blocks every story. US1 (catalog) comes before US2 (requests), which comes before US3 and
  US4; US5 depends on US1 only.

## Implementation Strategy

MVP is US1 + US2 + US3 (catalog, requests, answers), then US4, US5, and the polish phase.
