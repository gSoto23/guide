# HTTP API Contract: Agent Settings

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions**: [feature 004 contract](../../004-guest-guide/contracts/http-api.md)

Member routes under `/api/v1/workspaces/{wid}`, behind the session and workspace guards. Cross-tenant
IDs return `404` and are logged (SEC-14). These routes replace spec 005's `assistant-settings` routes.

| Route | Owner | Admin | Agent | Notes |
|---|---|---|---|---|
| `GET /assistant` | ✓ | ✓ | ✓ | `WorkspaceAssistant` |
| `PUT /assistant` | ✓ | ✓ | | `workspace.settings`; body `WorkspaceAssistantInput` |
| `GET /properties/{pid}/assistant` | ✓ | ✓ | ✓ | `PropertyAssistant` |
| `PUT /properties/{pid}/assistant` | ✓ | ✓ | | `properties.manage`; body `PropertyAssistantInput` |
| `POST /properties/{pid}/assistant/tests` | ✓ | ✓ | ✓ | `conversations.handle`; body `{question (1–2000)}`; `202 {id}` |
| `GET /properties/{pid}/assistant/tests/{tid}` | ✓ | ✓ | ✓ | `AssistantTest` |

## Shapes

```text
Level = "draft" | "auto" | "full_auto"
Topic = "arrival" | "wifi" | "house_rules" | "appliances" | "amenities" | "parking"
      | "local_recommendations" | "emergency" | "checkout" | "other"
Tone = "casual" | "formal"
QuietHours = { enabled: boolean, start: "HH:MM" | null, end: "HH:MM" | null }
Contacts = { mode: "all" } | { mode: "selected", memberIds: uuid[] }   // membership IDs
Instructions = { text: string, updatedAt: iso, updatedBy: string | null } | null

WorkspaceAssistant = {
  version: number,
  autonomy: Record<Topic, Level>, tone: Tone, quietHours: QuietHours, contacts: Contacts,
  instructions: Instructions,
  members: { id: uuid, name: string, role: "owner" | "admin" | "agent" }[],   // contact choices
  canEdit: boolean
}

WorkspaceAssistantInput = {
  version: number,
  autonomy: Record<Topic, Level>, tone: Tone, quietHours: QuietHours, contacts: Contacts,
  instructions: string            // "" clears them
}

PropertyAssistant = {
  version: number,                // 0 when the property has no row yet
  follows: { autonomy: boolean, tone: boolean, quietHours: boolean, contacts: boolean },
  own: { autonomy, tone, quietHours, contacts },        // the property's values (or the workspace's
                                                        // when it has none yet), for prefill
  instructions: Instructions,                           // the property's own
  workspace: { autonomy, tone, quietHours, contacts, instructions },
  effective: { autonomy, tone, quietHours, contacts },  // what applies now
  timeZone: string | null,
  hasPublishedGuide: boolean,
  members, canEdit
}

PropertyAssistantInput = {
  version: number,
  follows: { autonomy, tone, quietHours, contacts },
  own: { autonomy, tone, quietHours, contacts },
  instructions: string
}

AssistantTest = {
  id, status: "pending" | "done", question,
  outcome: "sent" | "draft" | "held" | "pointer" | "greeting" | "limited" | "unavailable" | null,
  reason: NeedsHostReason | null, topic: string | null,
  answerKind: "grounded" | "general" | "clarify" | null,
  reply: string | null, sections: { id, title }[], createdAt
}
```

## Errors

| Status | Code | When |
|---|---|---|
| 422 | `validation_failed` | Bad shape, unknown topic or level, quiet hours with equal or missing times |
| 403 | `forbidden` | Agent saving settings |
| 404 | `not_found` | Other workspace's property, test, or member ID in contacts |
| 409 | `settings_changed` | `version` is not the current one; the screen reloads the current values |
| 409 | `time_zone_required` | Quiet hours enabled on a property without a time zone |
| 409 | `guide_not_published` | Test on a property without a published guide |
| 422 | `instructions_invalid` | `issues`: `too_long`, `restricted_value`, `link`, `email`, `phone`, `off_platform` |
| 429 | `tests_paused` | Over 30 tests per member per hour; `retryAfterSeconds` |

## Member trace projection (spec 005, extended)

`MemberTrace` adds `level`, `levelSource`, `answerKind`, `tone`, `quietHours`,
`instructions: { workspace: boolean, property: boolean }`.
