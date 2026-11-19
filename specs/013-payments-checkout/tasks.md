---

description: "Task list for feature 013: guest checkout and host payouts"
---

# Tasks: Guest Checkout and Host Payouts

**Input**: Design documents from `/specs/013-payments-checkout/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story.

> **Production gates (not development gates):** OQ-01, OQ-37, OQ-35, then the Tilopay adapter and
> ADR-0007's sandbox confirmation; production runs with `PAYMENTS_MODE=off` until then.

## Format: `[ID] [P?] [Story] Description`

Conventions: amounts in minor units; orders paid only by verified events; simulated provider never in
production; synthetic data only.

---

## Phase 1: Setup

- [X] T001 [P] Catalogs: portal `payments` namespace (Payouts, states, fees, totals, refund dialog, errors), settings link, Requests payment column; guest `extras.payment` texts (Pay, total note, processing, paid, refunded, disputed, reference) in `packages/i18n/messages/`

## Phase 2: Foundational

- [X] T002 [P] Domain `packages/domain/src/payments/` with unit tests: plan fees (Free 1,000 bps, Pro 700, Business 500) and custom, `toMinor(price, quantity)`, `splitAmounts` (parts add up), `PAYABLE_CURRENCIES` (USD, CRC), `isPayable`, refundable amount and state after a refund, order expiry (60 minutes)
- [X] T003 [P] Port and simulated adapter `packages/integrations/src/payments/` with unit tests: signed checkout and onboarding tokens, signed events and verification (wrong signature, tampered body), illustrative fee, refund; factory by mode
- [X] T004 Schema and migration `0036_payments.sql` (`workspace.platform_fee_bps`, `payout_account`, `payment_order`, `payment_refund`, `payment_event`; RLS: members read, system writes, `payment_event` system only); security event types and metadata allowlists; `payments.refund` capability (owners, admins)
- [X] T005 [P] Contracts `packages/contracts/src/payments.ts` and the `payment` fields on guest and member request types
- [X] T006 API config `PAYMENTS_MODE` (off, simulated, tilopay; default simulated locally, off in production; production refuses simulated) and the adapter provider

## Phase 3: User Story 2 - Payouts (P1)

- [X] T007 [P] [US2] API tests `payments-payouts.test.ts`: owner starts onboarding, simulated approve and reject, admins and agents read only, payments off
- [X] T008 [US2] `apps/api/src/payments/` payouts service and routes, event handler for merchant events, simulated onboarding page
- [X] T009 [US2] Portal Settings → Payouts (`app/[locale]/(app)/settings/payouts/page.tsx`, `components/payments/`), settings link, bundle budget entry

## Phase 4: User Story 1 - Guest checkout (P1) 🎯 MVP

- [X] T010 [P] [US1] API tests `payments-checkout.test.ts`: payable rules, one open order, reuse, paid by verified event only, duplicate events, tampered amount, paid after decline → refund due, guest payment states, rate limit
- [X] T011 [US1] Guest checkout route and service, event route and handler for payment events, simulated checkout page, `payment` on guest requests
- [X] T012 [P] [US1] Worker test and job `payment-notify.ts` (paid → contacts, disputed → owners) with emails in `packages/emails/src/payments/`
- [X] T013 [US1] Guest guide: Pay button, processing on return, paid, refunded, disputed, reference in `apps/guide/src/client/guide.ts` and styles; guest app test

## Phase 5: User Story 3 - Payments and refunds for hosts (P2)

- [X] T014 [P] [US3] API tests `payments-refunds.test.ts`: partial and full refunds, over-refund refused, 10 concurrent refunds, agent refused, step-up required, cancel needs a full refund, disputes, monthly totals
- [X] T015 [US3] Refund route and service, cancel guard in `service-requests.service.ts`, `payment` on member requests, monthly totals on payouts
- [X] T016 [US3] Portal Requests payment column and refund dialog with step-up

## Phase 6: User Story 4 - Founder fee (P3)

- [X] T017 [US4] `plan:set --fee-percent` with tests in `plan-cli.test.ts`

## Phase 7: Polish

- [X] T018 [P] Cross-tenant cases for the new routes
- [X] T019 [P] Security review tests `security-review-013` (AC-SEC-001 to 007)
- [X] T020 [P] Timing test `payments.perf.test.ts` (checkout start and events p95 ≤ 500 ms)
- [X] T021 [P] End-to-end `payments-us1.spec.ts` (quickstart 1 and 2), `payments-us3.spec.ts` (quickstart 3); axe on Payouts, Requests with a refund dialog, and the guest's payment states
- [X] T022 Docs: architecture overview, security SEC-21 notes, screens H-33 and G-09, README, PRD F13 note, research R10
- [X] T023 Run the quickstart locally and record it in research R10

## Dependencies

- Phase 2 blocks the stories. US2 before US1 (checkout needs active payouts); US3 after US1; US4 any time
  after T004.

## Implementation strategy

MVP is US2 + US1 (a guest can pay); then refunds (US3) and the founder fee (US4).
