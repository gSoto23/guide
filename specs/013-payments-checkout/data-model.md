# Data Model: Guest Checkout and Host Payouts

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migration `0036_payments.sql`.

## workspace (changed)

| Column | Type | Rules |
|---|---|---|
| platform_fee_bps | integer null | custom platform fee, 0 to 3,000 (30%); null uses the plan's |

## payout_account

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid PK, FK workspace cascade | |
| provider | text | `simulated` or `tilopay` |
| provider_account_id | text null | the provider's merchant reference |
| status | text | `pending`, `active`, `rejected` |
| created_at, updated_at | timestamptz | |

Members read (RLS); written in the system context after the API checks the owner.

## payment_order

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | also the reference sent to the provider |
| workspace_id | uuid FK workspace cascade | |
| property_id | uuid FK property cascade | |
| stay_id | uuid null FK stay set null | |
| service_request_id | uuid null FK service_request set null | kept after retention deletes the request |
| provider | text | `simulated` or `tilopay` |
| provider_reference | text null | unique per provider |
| status | text | `open`, `paid`, `partially_refunded`, `refunded`, `disputed`, `failed`, `expired`, `cancelled` |
| currency | char(3) | `USD` or `CRC` |
| amount_minor | bigint | > 0 |
| platform_fee_bps | integer | 0 to 3,000 |
| platform_fee_minor | bigint | ≥ 0 |
| provider_fee_minor | bigint null | set when paid |
| host_share_minor | bigint null | amount − platform fee − provider fee |
| refunded_minor | bigint | 0 to amount |
| refund_due | boolean | paid after the request stopped being payable |
| checkout_url | text null | while open |
| expires_at | timestamptz | open orders expire after 60 minutes |
| paid_at | timestamptz null | |
| created_at, updated_at | timestamptz | |

Indexes: unique `(service_request_id) WHERE status = 'open'`, unique `(provider, provider_reference)`,
`(workspace_id, paid_at)`. Members read; system context writes. No personal data.

## payment_refund

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace cascade | |
| order_id | uuid FK payment_order cascade | |
| amount_minor | bigint | > 0 |
| status | text | `succeeded`, `pending`, `failed` |
| provider_refund_id | text null | |
| requested_by | text null FK user set null | |
| created_at | timestamptz | |

Members read; system context writes.

## payment_event

| Column | Type | Rules |
|---|---|---|
| provider | text | PK with `event_id` |
| event_id | text | |
| type | text | |
| order_id | uuid null | |
| received_at | timestamptz | |

System only (no member policy).

## Security log events

`payment.refunded` (orderId, amountMinor, currency, full), `payment.disputed` (orderId),
`payment.event_refused` (provider, reason), `payouts.onboarding_started` (provider),
`payouts.status_changed` (provider, status); `workspace.plan_changed` gains `feeBps`.
