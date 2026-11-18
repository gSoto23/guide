# Data Model: Service Catalog and Host Add-on Requests

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migrations `0032_service_catalog.sql` (tables) and `0033_service_catalog_rls.sql` (RLS, grants,
triggers).

## extra

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | matches the workspace (trigger) |
| source_language | text | `es` or `en` |
| name | jsonb | `{ es?, en? }`, the source language present, each 1 to 80 characters |
| description | jsonb | `{ es?, en? }`, each up to 500 characters |
| price | numeric(10,2) | 0 to 100,000 |
| currency | char(3) | USD, CRC, MXN, EUR, COP, GTQ |
| lead_time_hours | integer | 0 to 720 |
| weekdays | smallint[] | ISO 1 (Monday) to 7, 1 to 7 values, default all |
| needs_date | boolean | |
| needs_time | boolean | only with `needs_date` |
| date_range | text | `stay` or `before_arrival` |
| max_per_stay | integer | 1 to 10 |
| pre_approved | boolean | |
| turnover | text null | `early_check_in` or `late_checkout`; requires `needs_date` false (the date is the stay's) |
| visible | boolean | |
| position | integer | ≥ 0 |
| version | integer | ≥ 0 |
| created_at, updated_at | timestamptz | |
| updated_by | text null FK user, set null | |

Index `(property_id, position)`. Members read; owners and admins write.

## service_request

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | matches the workspace (trigger) |
| stay_id | uuid FK stay, cascade | matches the property |
| extra_id | uuid null FK extra, set null | null after the extra is deleted |
| extra_name | jsonb | the extra's names when requested |
| price | numeric(10,2) | when requested |
| currency | char(3) | when requested |
| requested_date | date null | set when the extra needs a date (or the stay's date for turnover extras) |
| requested_time | time null | set when the extra needs a time |
| quantity | integer | 1 to 10 |
| note | text null | up to 300 characters, plain text |
| status | text | `waiting`, `confirmed`, `declined`, `cancelled`, `host_cancelled`, `expired` |
| reason_code | text null | `unavailable`, `fully_booked`, `too_late`, `other` (decline and host cancel) |
| reason_text | text null | up to 200 characters |
| answered_by | text null FK user, set null | |
| answered_at | timestamptz null | |
| expires_at | timestamptz | when a waiting request expires (research R2) |
| notified_at | timestamptz null | when contacts were alerted |
| created_at | timestamptz | |

Indexes: `(workspace_id, status, expires_at)`, `(stay_id, created_at)`, `(notified_at) WHERE notified_at
IS NULL`. Members read; members who handle conversations update status columns; inserts only from guest
routes in the system context.

## service_request_daily

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | PK with day and status |
| day | date | property's time zone |
| status | text | as `service_request.status` (`waiting` counts creations) |
| count | integer | ≥ 0 |

No personal data. Members read; written in the system context and by member answers.

## Security log events

`extras.changed` (metadata: `propertyId`, `action` `created`, `updated`, `deleted`, `copied`,
`ordered`) and `service_request.answered` (metadata: `propertyId`, `requestId`, `status`).

## State transitions

```text
waiting --guest cancels--> cancelled
waiting --member confirms--> confirmed --member cancels--> host_cancelled
waiting --member declines--> declined
waiting --expires_at passes--> expired
(new request, pre-approved and passing every rule) --> confirmed
stay cancelled or removed: waiting --> cancelled (reason: stay)
```
