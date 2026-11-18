# HTTP API Contract: In-Guide AI Chat

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions**: [feature 004 contract](../../004-guest-guide/contracts/http-api.md)

## Guest routes (guide origin, no member session)

Behind the guest interceptor of spec 004 (per-IP limits, `noindex`, `no-store`). The chat cookie is
`__Host-guidesk_chat` (`guidesk_chat` on local HTTP).

### `GET /api/v1/guest/chat?publicId={id}&after={seq}`

`200` `GuestChat`:

```json
{
  "intro": { "propertyName": "Casa Colibrí", "hostName": "Ana", "emergencyNumber": "911", "suggestions": ["How do I get in?", "What's the Wi-Fi network?"] },
  "conversation": { "status": "open | needs_host", "pending": false } ,
  "messages": [
    { "seq": 3, "author": "assistant", "kind": "text", "body": "…", "sections": [{ "id": "uuid", "title": "Appliances" }], "authorName": null, "createdAt": "…" }
  ]
}
```

- `conversation` is null before the first message. `pending` is true while a reply is being prepared.
- `messages` are those with `seq > after` (all when `after` is absent), at most 100.

### `POST /api/v1/guest/chat/messages`

Body `{publicId, text (1–2000), language: "es" | "en", clientId (uuid)}`. `202` `{message, pending}`
and `Set-Cookie` on the first message. Errors: `422 message_too_long`, `429 chat_paused` (device limit,
with `retryAfterSeconds`), `404 unavailable`. A repeated `clientId` returns the original message.

## Member routes

Under `/api/v1/workspaces/{ws}`. Roles: **O** owner, **A** admin, **Ag** agent.

| Method and path | O | A | Ag | Notes |
|---|---|---|---|---|
| `GET /properties/{pid}/conversations` | ✓ | ✓ | ✓ | `ConversationSummary[]`, needing the host first |
| `GET /properties/{pid}/conversations/{cid}` | ✓ | ✓ | ✓ | `ConversationDetail`: messages, open draft, member traces |
| `POST /properties/{pid}/conversations/{cid}/drafts/{did}/send` | ✓ | ✓ | ✓ | Body `{text?, acknowledgeWarnings?}`; `409 draft_closed` when already acted on; `422 reply_warnings` with `{warnings}` for edited text |
| `POST /properties/{pid}/conversations/{cid}/replies` | ✓ | ✓ | ✓ | Body `{text (1–2000), acknowledgeWarnings?}`; `422 reply_warnings` |
| `GET /assistant-settings` | ✓ | ✓ | ✓ | `{autonomy}` |
| `PUT /assistant-settings` | ✓ | ✓ | | Body `{autonomy: "draft" | "auto"}` (`workspace.settings`) |
| `GET /properties/{pid}/assistant-settings` | ✓ | ✓ | ✓ | `{override, effective}` |
| `PUT /properties/{pid}/assistant-settings` | ✓ | ✓ | | Body `{override: "draft" | "auto" | null}` (`properties.manage`) |

`ConversationDetail.traces` is the member projection: `{messageId | draftId, topic, decision, reason,
autonomy, sections, checks}` — never model, tokens, or cost.
