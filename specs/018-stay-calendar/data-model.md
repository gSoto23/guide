# Data Model: Stay Calendar and Guest Details

**Feature**: [spec.md](spec.md) · **Migration**: `0040_stay_guest_details`

## `stay` (changed)

| Column | Type | Rules |
|---|---|---|
| `guest_details_source` | text, null | `feed`, `pms`, or `host`; null when nothing is known |
| `guest_details_by` | text FK → user, set null | the member who typed the details |
| `guest_details_at` | timestamptz, null | when they were typed |

- Check `stay_ical_no_guest_data` → `stay_ical_guest_data`: for `source = 'ical'`, `guest_name` and
  `guest_count` are null unless `guest_details_source = 'host'`; `booking_reference` is allowed.
- `guest_name` 1–120 characters, `guest_count` 0–500 (unchanged checks).
- Trigger `stay_guard_request_changes` (request role): on feed and PMS stays, members may change
  `status` (hide a possible block), `guest_name`, `guest_count`, `guest_details_*`, and remove the
  name; a removed name cannot be set again; everything else is refused as before.
- Retention: when the name is deleted 12 months after checkout, `guest_count` stays and the source
  columns are cleared if no detail remains.

## `conversation` (changed)

- Index `conversation_stay_idx (stay_id)` for the stay view and calendar marks.

## Security events (new)

| Type | Metadata |
|---|---|
| `stay.guest_details_changed` | `stayId`, `name` (true when changed), `count` (true when changed) |

## Wire schema (sandbox)

`feedEntrySchema`: `{ uid, start, end, kind, reference }`, `reference` = an Airbnb reservation code
or null.

## Derived (not stored)

- **Calendar stay**: stay fields + marks `{ linkOpened, openEscalation, waitingRequests,
  confirmedExtras }`.
- **Stay overview**: stay + property + link state + conversations + requests + totals per currency.
