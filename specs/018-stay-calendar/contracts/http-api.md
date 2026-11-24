# Contracts: Stay Calendar and Guest Details

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

All routes are under `/api/v1/workspaces/{ws}` and follow the workspace rules (other workspaces 404).

## GET calendar

Any member. Query (strict): `from`, `to` (YYYY-MM-DD, `to` > `from`, at most 62 days),
`propertyId?` (uuid), `channel?` (text), `cancelled?` (`true` | `false`, default false).

```json
{
  "properties": [{ "id": "uuid", "name": "Casa Brisa", "timeZone": "America/Costa_Rica" }],
  "stays": [
    {
      "id": "uuid",
      "propertyId": "uuid",
      "checkInDate": "2026-12-11",
      "checkoutDate": "2026-12-15",
      "checkInTime": "15:00",
      "checkoutTime": "11:00",
      "source": "ical",
      "channel": "airbnb",
      "status": "active",
      "mayBeBlock": false,
      "overlaps": false,
      "guestName": "Ana",
      "guestCount": 2,
      "bookingReference": "HMABC12345",
      "marks": { "linkOpened": true, "openEscalation": false, "waitingRequests": 1, "confirmedExtras": 2 }
    }
  ]
}
```

Hidden stays and duplicates never appear; cancelled ones only with `cancelled=true`.

## GET stays/{stayId}

Any member.

```json
{
  "stay": { "…": "the calendar stay fields above",
            "guestDetails": { "source": "host", "setAt": "…", "setBy": "Ana Owner" },
            "guestNameRemoved": false },
  "property": { "id": "uuid", "name": "Casa Brisa", "timeZone": "America/Costa_Rica" },
  "link": { "status": "active", "devices": 2, "firstOpenedAt": "…", "valuesShown": 3,
            "lockedUntil": null, "lastCopiedAt": "…" },
  "conversations": [{ "id": "uuid", "status": "needs_host", "reason": "malfunction",
                      "lastMessageAt": "…" }],
  "requests": ["… ServiceRequestItem as on the Requests screen …"],
  "totals": [{ "currency": "USD", "confirmed": 85.0, "paid": 40.0 }],
  "canManage": true
}
```

## PUT stays/{stayId}/guest

Owners and admins (`properties.manage`), any stay source. Body (strict):
`{ "guestName": string | null, "guestCount": integer | null }` (name 1–120 after trimming; count
0–500). `409 guest_name_removed` when the name was removed on request and a name is sent. Writes
`stay.guest_details_changed`. Returns the stay.

## Changed responses

- `InboxItem`, `ConversationSummary`, `ConversationDetail`: + `stayId: string | null`,
  `guestName: string | null`.
- `GET service-requests`: + query `stayId?`.
- Stay message (`POST …/share/stays/{stayId}/message`): the text greets the stay's guest name when
  set.
