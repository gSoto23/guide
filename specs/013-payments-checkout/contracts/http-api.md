# Contracts: Guest Checkout and Host Payouts

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

## Guest (stay session, guide origin)

`GET /api/v1/guest/extras/requests` — each request gains:

```json
"payment": {
  "state": "payable",
  "amountMinor": 8500,
  "currency": "USD",
  "refundedMinor": 0,
  "reference": null
}
```

`payment` is null when online payment isn't possible for the request (payments off, payouts not
active, not confirmed, free, unsupported currency, early check-in or late checkout). `state` is
`payable`, `open` (a checkout is in progress or returned without an event yet: "processing"), `paid`,
`partially_refunded`, `refunded`, or `disputed`.

`POST /api/v1/guest/extras/requests/{requestId}/checkout?lang=es|en`, body `{ "publicId": "…" }` (strict):
`200 { orderId, checkoutUrl, expiresAt }`. Errors: `401 no_session`, `404 not_found` (another stay's
request), `409 not_payable`, `409 already_paid`, `429 rate_limited` (10 per stay per hour).

## Provider events (public, no cookies)

`POST /api/v1/payments/events/{provider}` with `x-guidesk-signature`. `200 { status: "handled" |
"duplicate" }`; `400 invalid_event` (bad signature or shape, logged). Event types: `payment.succeeded`,
`payment.failed`, `payment.disputed`, `refund.succeeded`, `merchant.activated`, `merchant.rejected`.

## Simulated provider pages (only when `PAYMENTS_MODE=simulated`)

`GET /api/v1/simulated-provider/checkout?token=…[&action=pay|decline]` and
`GET /api/v1/simulated-provider/onboarding?token=…[&action=approve|reject]`: HTML pages; an action
signs an event, handles it, and redirects to the return URL. `404` in any other mode.

## Workspace (members)

- `GET /api/v1/workspaces/{ws}/payouts` (`conversations.handle`): `{ mode, account: { provider, status }
  | null, feePercent, feeSource, canManage, month: [{ currency, orders, paidMinor, refundedMinor,
  platformFeeMinor, providerFeeMinor, hostShareMinor }] }`.
- `POST /api/v1/workspaces/{ws}/payouts/onboarding` (`workspace.billing`, owner): `200 { onboardingUrl }`;
  `409 payments_off`.
- `GET /api/v1/workspaces/{ws}/service-requests` — each item gains `payment: { orderId, state,
  amountMinor, currency, refundedMinor, platformFeeMinor, providerFeeMinor, hostShareMinor, refundDue }
  | null` (the latest non-open order, or the open one).
- `POST /api/v1/workspaces/{ws}/payment-orders/{orderId}/refunds` (`payments.refund`: owners, admins;
  step-up), body `{ amountMinor }` (strict, integer > 0): `201 { refund, order }`; `409 not_refundable`,
  `422 amount_too_large`, `403 step_up_required`.
- `POST …/service-requests/{id}/cancel` answers `409 refund_first` while a paid order isn't fully
  refunded.

## CLI

`plan:set … [--fee-percent <0-30>|plan]`.
