# Research: Guest Checkout and Host Payouts

**Feature**: [spec.md](spec.md) · **Date**: 2026-11-19

## R1. A payment port with a simulated provider

- **Decision:** `PaymentPort` in `packages/integrations/src/payments/` with `createCheckout`,
  `createOnboarding`, `refund`, and `verifyEvent`. `SimulatedPaymentAdapter` implements it without
  state: checkout and onboarding URLs carry an HMAC-signed token, and the simulated pages (served by the
  API under `/api/v1/simulated-provider/*`) build signed events and hand them to the same event handler
  the provider route uses. `PAYMENTS_MODE` is `off`, `simulated`, or `tilopay` (not built yet); unset it
  is `simulated` locally and `off` in production, and production refuses `simulated` (AC-SEC-007). The
  simulated signing key is derived from `BETTER_AUTH_SECRET` (no new secret, no literal in the repo).
- **Rationale:** the founder chose a simulated provider (2026-11-19); Tilopay's sandbox needs the legal
  entity (OQ-01, OQ-37). The port keeps the Tilopay adapter a drop-in (ADR-0007).
- **Alternatives considered:** waiting for Tilopay (blocks month 4); a stateful fake with its own table
  (more schema for a test double).

## R2. Orders and money

- **Decision:** `payment_order` per checkout, amounts in minor units (`bigint`): `amount` = request price
  × quantity × 100; `platform_fee` = round(amount × fee bps ÷ 10,000), fixed at creation; the provider fee
  arrives with the paid event; `host_share` = amount − platform fee − provider fee, so the parts always add
  up (SC-003). Fee bps: workspace custom (`workspace.platform_fee_bps`) or plan (Free 1,000, Pro 700,
  Business 500) in `packages/domain/src/payments/`. Payable currencies: USD and CRC.
- **Rationale:** FR-011, FR-012; integer minor units avoid rounding drift.

## R3. State machine and idempotency

- **Decision:** order states `open` → `paid` → `partially_refunded` → `refunded`, with `disputed`,
  `failed`, `expired` (open past `expires_at`, 60 minutes, applied lazily), and `cancelled`. Each provider
  event is inserted into `payment_event (provider, event_id)` first, in the same transaction that locks
  the order; a duplicate insert ends the handling (FR-009). A paid event checks the amount and currency
  against the order; a paid event for an order that is no longer open, or whose request is no longer
  confirmed, still records the payment and sets `refund_due` (spec edge cases). One open order per request
  (partial unique index); starting checkout again reuses it until it expires (FR-008).
- **Rationale:** SEC-21; webhooks may repeat or arrive late.

## R4. Event verification

- **Decision:** `POST /api/v1/payments/events/:provider` is public, outside the cookie origin check
  (no cookies, server to server). The simulated adapter signs `JSON.stringify(event)` with HMAC-SHA256 in
  `x-guidesk-signature`; the handler re-serializes the parsed body to verify. Refused events are logged
  (`payment.event_refused`) and answer 400. The Tilopay adapter may need the raw body; that change comes
  with it (the API's JSON parser would keep the raw text for that route).
- **Rationale:** AC-SEC-001; Fastify parses JSON before handlers and HTML form posts are never parsed
  (T103), so the simulated pages use links (`?action=pay`) rather than form posts.

## R5. Checkout from the guest guide

- **Decision:** `POST /api/v1/guest/extras/requests/:id/checkout` (stay session) checks the request is
  this stay's, confirmed, payable (price > 0, USD or CRC, not early check-in or late checkout per the
  extra's `turnover`), payouts active, payments on, and the workspace active; rate-limited to 10 starts per
  stay per hour (SEC-07). It returns the provider's URL; the guide navigates there. The return URL is the
  Extras page with `?payment=<order>`, which shows "processing" until the order is paid (AC-SEC-006). The
  guest's request list carries a `payment` object (null when online payment isn't possible).
- **Rationale:** FR-004 to FR-008, FR-018.

## R6. Payouts and onboarding

- **Decision:** `payout_account` per workspace (`pending`, `active`, `rejected`). The owner starts
  onboarding (`workspace.billing` capability); the provider's events set the state. `GET payouts` shows the
  state, the effective fee, the mode, and this month's totals by currency from `payment_order` (paid
  orders by `paid_at` in UTC months).
- **Rationale:** FR-002, FR-003, FR-020; split settlement means Guidesk only records amounts (FR-013).

## R7. Refunds and disputes

- **Decision:** `POST /v1/workspaces/{ws}/payment-orders/{id}/refunds` for a new `payments.refund`
  capability (owners and admins) with `RequireStepUp` (10 minutes). The order row is locked, the amount is
  checked against what is left, the provider refunds (the simulated one at once), and a `payment_refund`
  row and a `payment.refunded` security event are written. A disputed order can't be refunded in Guidesk
  (the provider handles it). Cancelling a paid request answers `409 refund_first` until it is fully
  refunded.
- **Rationale:** FR-014 to FR-016, AC-SEC-003, AC-SEC-004.

## R8. Notifications

- **Decision:** after a paid or disputed event commits, the API queues `payment.notify`; the worker
  emails the property's escalation contacts (paid) or the owners (disputed), with the extra's name and the
  amount only.
- **Rationale:** FR-010, FR-016; contacts and rendering already live in the worker (spec 007).

## R9. Founder fee

- **Decision:** `plan:set --fee-percent <0-30>|plan` sets `workspace.platform_fee_bps`; the security event
  adds `feeBps`.
- **Rationale:** FR-021.

## R10. Founder gates and notes

- **Gates:** OQ-01 (legal entity), OQ-37 (Tilopay: split settlement, onboarding, refunds API, event
  signature, fees), OQ-09 (fee policy chosen: the host absorbs the provider fee), OQ-35 (legal review of
  checkout texts, taxes, receipts, and early check-in/late checkout), then the Tilopay adapter and a
  sandbox run of ADR-0007's confirmation steps.
