# Implementation Plan: Stay Calendar and Guest Details

**Branch**: `018-stay-calendar` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/018-stay-calendar/spec.md`

## Summary

A read-only calendar of every stay Guidesk knows (all properties and one property, an agenda on
phones), a stay view that brings together the guest, the stay link state, the conversations, and
the add-on requests with their payments, guest names and numbers typed by the host on any stay,
the Airbnb reservation code kept from feeds, and the name used on the host side (inbox,
conversations, requests, stay message) but never on the guest side.

Technical approach: migration `0040` adds guest-detail source columns, relaxes the feed-stay check,
and updates the request-side stay trigger; the sandbox feed reader returns the reservation code;
PMS refreshes keep host-typed details; two read routes (`GET calendar`, `GET stays/{id}`) and one
write route (`PUT stays/{id}/guest`); inbox and conversation contracts gain the stay ID and name;
the stay message greets by name; a new portal destination with the calendar and stay pages
([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages (the calendar grid is CSS, dates use `Intl`).

**Storage**: PostgreSQL 16: `stay` columns and check, trigger, `conversation` index (migration `0040`)
([data model](data-model.md)).

**Testing**: Vitest (domain, sandbox parser, worker and API integration with Testcontainers), portal
unit tests for calendar layout helpers; e2e for the calendar runs locally only (CI has no Playwright).

**Target Platform**: API and worker (ECS Fargate), sandbox reader (Lambda), portal.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: `GET calendar` p95 ≤ 1 s for 50 properties and 400 stays in a month
(SC-002); portal routes ≤ 175 KB of initial JavaScript; LCP ≤ 2.5 s, CLS ≤ 0.1, accessibility ≥ 0.95.

**Constraints**: read-only towards platforms and PMSs; no guest name on the guest guide, the
assistant's context, push, or email; only the reservation code from a feed entry; RLS per workspace.

**Scale/Scope**: 1 migration, 3 routes, 3 contract changes, 1 sandbox change, 2 worker changes, 2
portal pages, 1 navigation entry, texts in two languages.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec with clarifications; plan clarifications recorded (R5 copilot deferred, R6 request roles) | [x] |
| II. Platform Compliance | Read-only; only the host's own feed; no scraping | [x] |
| III. Guest Trust and Human-in-the-Loop | Names stay off the guest side (2026-11-20 decision) | [x] |
| IV. Channel-Agnostic Core | Calendar and stay rules in domain helpers; API reads shared services | [x] |
| V. Test-First and Eval-Driven | Tests first per story; no prompt change (copilot deferred), so no new evals | [x] |
| VI. Security and Privacy | SEC-14 (RLS, cross-tenant tests), SEC-16 (name changes logged without the name), SEC-20 (minimum guest data: no phone digits) | [x] |
| VII. Simplicity | No new dependency; one table change; reuse of request and link services | [x] |
| VIII. Observability | Feed refresh span counts references found (counts only) | [x] |
| IX. International | Spanish and English; dates in the property's time zone | [x] |
| Performance | Budget below | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| `GET calendar` | 50 properties, 400 stays, one month | p95 ≤ 1 s | Integration timing test |
| `GET stays/{id}` | 20 requests, 5 conversations | p95 ≤ 300 ms | Integration timing test |
| Calendar and stay pages | Initial JavaScript | ≤ 175 KB gzip | Portal bundle check |

## Project Structure

```text
packages/db/src/schema/stays.ts, chat.ts         # guest_details_*, check, conversation index
packages/db/migrations/0040_stay_guest_details.sql # + trigger replacement
packages/domain/src/properties/feeds.ts           # reference extraction helper
packages/domain/src/calendar/                     # range checks, layout helpers (pure)
packages/domain/src/guest/messages.ts             # greeting with the guest name
packages/domain/src/security-events.ts            # stay.guest_details_changed
packages/integrations/src/sandbox/protocol.ts, apps/sandbox/src/{protocol.ts,feed-reader/parse.ts}
apps/worker/src/jobs/calendar-refresh.ts, csv.ts, pms-common.ts
apps/api/src/calendar-feeds/calendar-feeds.service.ts
apps/api/src/calendar/ (new: calendar + stay overview), apps/api/src/stays (guest details route)
apps/api/src/inbox, conversations, extras (stayId filter), share/stay-messages.service.ts
packages/contracts/src/{calendar.ts,stays.ts,inbox.ts,conversations.ts,extras.ts}
apps/portal/app/[locale]/(app)/calendar/, components/calendar/, shell/destinations.ts
packages/i18n/messages/{es,en}.json
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `guest_details_source` | Refreshes must keep what the host typed (FR-016) | Comparing values on each refresh cannot tell a PMS correction from a host edit |
