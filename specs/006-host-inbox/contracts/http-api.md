# HTTP API Contract: Host Inbox and Reply Copilot

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions**: [feature 004 contract](../../004-guest-guide/contracts/http-api.md)

Member routes behind the session and workspace guards; cross-tenant IDs return `404` and are logged.
"Handle" means the `conversations.handle` capability (owners, admins, agents).

## Inbox and conversations (`/api/v1/workspaces/{wid}`)

| Route | Capability | Notes |
|---|---|---|
| `GET /inbox?tab=needs\|all\|done&propertyId=&before=` | member | `{items: InboxItem[], next: string \| null, hasPublishedGuide, suggestions: Suggestion[]}` |
| `POST /properties/{pid}/conversations/{cid}/done` | handle | `204`; `409 conversation_done` if already done |
| `POST /properties/{pid}/conversations/{cid}/reopen` | handle | `204` (done → open) |
| `POST /properties/{pid}/conversations/{cid}/drafts/{did}/reject` | handle | `204`; `409 draft_closed` (first wins) |
| `PUT /properties/{pid}/conversations/{cid}/takeover` | handle | body `{on: boolean}`; returns `ConversationDetail` |
| `POST /properties/{pid}/conversations/{cid}/presence` | handle | `204`; heartbeat (30 s) |
| `POST /inbox/suggestions/dismiss` | handle | body `{propertyId, topic}`; `204` |

```text
InboxItem = {
  id, propertyId, propertyName, status: "open" | "needs_host" | "done",
  reason: NeedsHostReason | null,
  stay: { checkInDate, checkoutDate } | null, channel: "guide_chat",
  lastMessageAt, lastMessage: { author, excerpt (≤ 140 chars) } | null,
  takenOverBy: string | null, replying: string[]
}
Suggestion = { propertyId, propertyName, topic, count, scope: "property" | "workspace" }
```

`ConversationDetail` (spec 005) adds `takenOver: { by: string | null, at } | null`, `doneAt`,
`replying: string[]`.

## Copilot (`/api/v1/workspaces/{wid}/properties/{pid}/copilot`)

| Route | Capability | Notes |
|---|---|---|
| `POST /` | handle | body `{message (1–4000), bookingStatus: "inquiry" \| "confirmed", language: "es" \| "en"}`; `202 {id}`; `409 guide_not_published`; `429 copilot_paused` (60 per member per hour, `retryAfterSeconds`) |
| `GET /{runId}` | member | `CopilotDraft` |

```text
CopilotDraft = {
  id, status: "pending" | "done", outcome: "drafted" | "limited" | "unavailable" | "failed" | null,
  draft: string | null, sections: { id, title }[], checks: { check, passed }[], passed: boolean,
  removed: ("link" | "email" | "phone")[], caution: string | null, covered: boolean | null, createdAt
}
```

## Push (`/api/v1/me/push`, signed in, no workspace)

| Route | Notes |
|---|---|
| `GET /` | `{available: boolean, publicKey: string \| null, devices: {id, device, createdAt}[]}` |
| `POST /subscriptions` | body `{endpoint (https, ≤ 2048), keys: {p256dh, auth}, device}`; `201 {id}`; same endpoint → updated |
| `DELETE /subscriptions/{id}` | own subscription only (`404` otherwise) |
| `POST /test` | sends a test push to the caller's devices; `202`; 5 per hour |

## Errors added

`409 conversation_done`, `429 copilot_paused`, `503 push_unavailable` (push keys not configured).
