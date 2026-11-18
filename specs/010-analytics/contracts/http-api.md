# HTTP API: Basic Analytics

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

Conventions as in specs 004 to 009 (problem details, `lang` for texts, RLS, cross-tenant 404 with a
`access.cross_workspace_denied` event). Permission `conversations.handle` (owners, admins, agents).

## `GET /api/v1/workspaces/{ws}/analytics?period=7|30|90[&propertyId=uuid]`

Strict query (other keys or periods: `422 validation_failed`). Without `propertyId`: the workspace
view with property rows; with it: that property only (`404` when it isn't the workspace's).

`200`:

```json
{
  "period": { "days": 30, "timeZones": ["America/Costa_Rica"], "utcFallback": false },
  "scope": { "kind": "property", "propertyId": "uuid", "propertyName": "Casa Colibrí", "removed": false },
  "comparable": true,
  "views": { "property": { "current": 25, "previous": 20 }, "stay": { "current": 15, "previous": 9 } },
  "staysOpened": { "current": 6, "previous": 4 },
  "questions": {
    "total": { "current": 20, "previous": 10 },
    "automatic": { "current": 14, "previous": 6 },
    "withHost": { "current": 3, "previous": 2 },
    "escalated": { "current": 3, "previous": 2 }
  },
  "topics": [{ "topic": "wifi", "count": 8 }],
  "escalations": [{ "reason": "emergency", "count": 2 }],
  "unanswered": 3,
  "explore": { "opens": { "current": 12, "previous": 0 }, "clicks": [{ "partner": "viator", "count": 3 }] },
  "requests": {
    "made": { "current": 4, "previous": 1 },
    "byStatus": [{ "status": "confirmed", "count": 2 }],
    "staysWithRequest": 2
  },
  "properties": null
}
```

Counts are integers; rates are computed by the client from the counts (automatic ÷ total; stays with
request ÷ stays opened) so the totals and rates always agree. In the workspace view, `scope.kind` is
`"workspace"` and `properties` is an array (active properties, plus removed ones with activity in
the period, marked `removed`), each:

```json
{
  "propertyId": "uuid", "name": "Casa Colibrí", "removed": false,
  "views": 40, "questions": 20, "automatic": 14, "escalated": 3,
  "requests": 4, "clicks": 5
}
```

## `GET /api/v1/workspaces/{ws}/analytics/unanswered?period=7|30|90[&propertyId=uuid][&cursor=…]`

`200 { "items": [UnansweredQuestion], "next": string | null }`, newest first, 20 per page:

```json
{ "traceId": "uuid", "conversationId": "uuid", "propertyId": "uuid", "propertyName": "Casa Colibrí", "at": "2026-11-17T21:04:00.000Z", "text": "¿Hay una farmacia cerca?" }
```

`text` is the guest's message as stored (plain text, up to 4,000 characters), or `null` if the message
was removed. The cursor is opaque.

## Founder report (not HTTP)

`pnpm --filter @guidesk/db report:pilot -- --from 2026-11-01 --to 2026-11-30 [--json]`.
