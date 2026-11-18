# Email Contract: In-Guide AI Chat

**Feature**: [spec.md](../spec.md) · **Rules for every email**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md)

No email carries a locked value, a stay token, or guest contact data; links point only to the portal.

| Template ID | Trigger | Recipients | Key content | Sent from |
|---|---|---|---|---|
| `chat.needs_host` | A conversation moves to "needs the host", at most once per conversation per 30 minutes (FR-023) | Owners, admins, and agents of the workspace | Property name, the reason in plain words, stay dates when known, the first 300 characters of the guest's latest message, and a link to the conversation page | Worker, through the outbox |
| `chat.limit_reached` | A property or the workspace reaches its daily AI budget (FR-028) | Owners | Property name (or "all properties"), the limit, that guests get holding replies until tomorrow, and a link to the property's conversations | Worker, through the outbox |
