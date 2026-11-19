# Implementation Plan: Guest Checkout and Host Payouts

**Branch**: `013-payments-checkout` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/013-payments-checkout/spec.md`

## Summary

Guests pay confirmed add-ons through the provider's hosted checkout; owners set up payouts with the
provider; orders record the price, the platform fee, the provider fee, and the host's share; owners and
admins refund with step-up; disputes are flagged. A simulated provider stands in for Tilopay until the
legal entity exists.

Technical approach: a payment port with a stateless simulated adapter (signed tokens and events); four
tables and a workspace column (migration `0036`); pure money and state rules in the domain; guest
checkout and a public event route in the API; a worker job for emails; Payouts and a payment column with
refunds in the portal; a Pay button in the guest guide ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages (HMAC from `node:crypto`).

**Storage**: PostgreSQL 16 ([data model](data-model.md)).

**Testing**: Vitest (domain, integration with Testcontainers), Playwright on the phone viewport, axe.

**Target Platform**: API, worker, portal, guest guide.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: checkout start and event handling p95 ≤ 500 ms (excluding the provider); portal
routes ≤ 150 KB; the guest guide's script budget unchanged.

**Constraints**: no card data or guest contact details in Guidesk; orders paid only by verified events;
simulated provider never in production.

**Scale/Scope**: 1 portal screen and a Requests column, guest Pay states, 7 endpoints, 1 job, 1 CLI flag.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec with 7 clarifications; the founder chose the simulated provider | [x] |
| II. Platform Compliance | PC-03, PC-06, PC-08; early check-in and late checkout not sold (OQ-35) | [x] |
| III. Guest Trust and Human-in-the-Loop | Refunds and disputes stay with people; paid-but-unwanted orders are flagged, not auto-refunded | [x] |
| IV. Channel-Agnostic Core | `PaymentPort`; money rules in the domain | [x] |
| V. Test-First and Eval-Driven | Tests first per story; no model change | [x] |
| VI. Security and Privacy | SEC-05, SEC-07, SEC-14, SEC-16, SEC-20, SEC-21 | [x] |
| VII. Simplicity | Stateless simulated adapter; no new dependency | [x] |
| VIII. Observability | Events and refunds logged; job spans with counts | [x] |
| IX. International | Spanish and English; amounts per locale and currency | [x] |
| Performance | Budget above; timing and bundle checks | [x] |

## Project Structure

```text
packages/integrations/src/payments/   # port, simulated adapter, factory
packages/domain/src/payments/         # fees, splits, payable rules, order states
packages/contracts/src/payments.ts    # guest payment, payouts, refunds
packages/db/src/schema/payments.ts    # tables; migration 0036
apps/api/src/payments/                # guest checkout, events, payouts, refunds, simulated pages
apps/worker/src/jobs/payment-notify.ts
apps/portal/app/[locale]/(app)/settings/payouts/, components/payments/
apps/guide/src/client/guide.ts        # Pay button and states
e2e/specs/payments-us1, payments-us3, a11y
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `payment_event` | Idempotency across repeated provider events (SC-002) | A status check alone misses events that don't change the state |
