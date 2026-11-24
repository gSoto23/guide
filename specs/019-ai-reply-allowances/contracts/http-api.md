# Contracts: AI Reply Allowances and Top-ups

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

## GET /api/v1/workspaces/{ws}/plan (changed)

Same access rules as spec 011 (owners and admins; agents 403; other workspaces 404). Two additions:
`limits.aiReplies.minimum` and `topUps`.

```json
{
  "workspaceId": "uuid",
  "plan": "pro",
  "changedAt": "2026-11-24T15:00:00.000Z",
  "limits": {
    "properties": { "limit": null, "used": 1, "source": "plan" },
    "seats": { "limit": 3, "used": 1, "members": 1, "pending": 0, "source": "plan" },
    "aiReplies": {
      "limit": 500,
      "used": 512,
      "source": "plan",
      "perProperty": 300,
      "minimum": 500,
      "monthStart": "2026-11-01T00:00:00.000Z",
      "resetsAt": "2026-12-01T00:00:00.000Z"
    }
  },
  "topUps": {
    "balance": 238,
    "items": [
      {
        "id": "uuid",
        "granted": 250,
        "remaining": 238,
        "addedAt": "2026-11-20T10:00:00.000Z",
        "expiresAt": "2027-11-20T10:00:00.000Z"
      }
    ]
  },
  "contactEmail": "support@example.com"
}
```

- `minimum` is 500 on Pro and 1,000 on Business when the AI limit comes from the plan, else `null`.
- `used` may exceed `limit`: replies above it were paid from top-ups (or were already in flight).
- `topUps.items` lists unexpired top-ups with replies left, oldest first (at most 20); `balance` is
  their sum. Notes are never returned.
- Still no route writes plans, custom limits, or top-ups (AC-SEC-002, FR-010).

## Guest chat (changed limit only)

`POST` guest messages: `429 chat_paused` after 25 messages per device per 10 minutes (was 20). The
per-network limit (60 per 10 minutes) is unchanged.

## Founder tool (CLI, `packages/db`)

```text
plan:topup        -- --workspace <uuid> --replies <1..100000> --note "<1..200 chars>" [--yes]
plan:topups       -- --workspace <uuid> [--json]
plan:topup-correct -- --top-up <uuid> --remaining <n> --note "<1..200 chars>"
plan:show         -- --workspace <uuid> [--json]   # now includes the top-up balance
```

- `--yes` is required above 5,000 replies.
- `topup-correct` only lowers a top-up's unused replies (`0 ≤ n < remaining`).
- Errors print a message and the usage, exit code 1, and change nothing.

On AWS: `scripts/aws-task.sh <stage> plan <topup|topups|topup-correct|show|set> [args…]`.

## Emails

| Template | When | Content |
|---|---|---|
| `plan.ai_usage` (changed) | 80% and 100% of the month, once each | Adds how top-ups work and how to ask; at 100% says the AI keeps answering when a top-up balance remains |
| `plan.top_up_used_up` (new) | A top-up reaches 0 replies left, once per top-up | Counts only: the top-up size, whether the month still has replies, the renewal date, the plan link |
