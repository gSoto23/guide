# Contracts: Plan Limits

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

## GET /api/v1/workspaces/{ws}/plan

Capability `workspace.settings` (owners and admins). Agents get `403` and an
`access.role_denied` event; other workspaces get `404` and an `access.cross_workspace_denied`
event. No query parameters (any is refused with `422`).

```json
{
  "workspaceId": "uuid",
  "plan": "free",
  "changedAt": null,
  "limits": {
    "properties": { "limit": 2, "used": 1, "source": "plan" },
    "seats": { "limit": 1, "used": 1, "members": 1, "pending": 0, "source": "plan" },
    "aiReplies": {
      "limit": 100,
      "used": 85,
      "source": "plan",
      "perProperty": null,
      "monthStart": "2026-11-01T00:00:00.000Z",
      "resetsAt": "2026-12-01T00:00:00.000Z"
    }
  },
  "contactEmail": "support@example.com"
}
```

- `limit` is `null` when unlimited; `source` is `plan` or `custom`.
- `perProperty` is 300 on Pro and Business when the AI limit comes from the plan, else `null`.
- `contactEmail` is `null` when `PLAN_CONTACT_EMAIL` is not configured.
- There is no `PUT`, `PATCH`, or `POST` on this resource (AC-SEC-002).

## Changed responses

- `GET /api/v1/workspaces/{ws}/properties/limits`: `limit` may be `null` (unlimited);
  `extractionLimit` stays a number (derived basis).
- `GET /api/v1/workspaces/{ws}/invitations` (and the members screen data): `seatLimit` may be `null`.
- Limit refusals keep their codes with `details: { limit, used }`:
  `409 plan_limit_reached` (properties) and `409 seat_limit_reached` (invitations).
- Conversation and trace reason `monthly_limit`; copilot run outcome and assistant test outcome
  `monthly_limited`, each with the renewal moment where the screen shows it.

## CLI (founder)

```text
pnpm --filter @guidesk/db plan:set -- --workspace <uuid> --plan free|pro|business \
  [--properties <n>|plan] [--seats <n>|plan] [--ai-replies <n>|plan] --note "<text>"
pnpm --filter @guidesk/db plan:show -- --workspace <uuid> [--json]
```

- `plan` as a value clears that custom limit; omitting the flag keeps the current one.
- `--note` is required for `plan:set` (1 to 200 characters).
- Exit code 1 with a reason and no change on an unknown workspace, an unknown plan, or a limit that is
  not a positive whole number.
- `DATABASE_URL` must point at the database (migration user).
