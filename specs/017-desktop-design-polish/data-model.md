# Data Model: Desktop Design and Usability Polish

No data changes. The feature changes presentation only: no tables, columns, API fields, contracts, or
permissions are added or changed.

Values the screens format differently:

| Value | Source | Before | After |
|---|---|---|---|
| Stay dates (inbox, requests) | `checkInDate`, `checkoutDate` (`YYYY-MM-DD`) | `2026-11-18 → 2026-11-22` | `18–22 nov 2026` (es), `Nov 18 – 22, 2026` (en) |
| Requested date (requests) | `requestedDate` (`YYYY-MM-DD`) and optional `requestedTime` | `2026-09-26 10:00` | `26 sept 2026, 10:00` |
| Request status | `status` | One outline style for all | Waiting: warning; confirmed: success; closed: neutral |
