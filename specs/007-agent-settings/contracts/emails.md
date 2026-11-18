# Email Contract: Agent Settings

**Feature**: [spec.md](../spec.md) · **Rules for every email**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md)

No email carries a locked value, a stay token, guest contact data, or instruction text; links point only
to the portal.

| Template ID | Trigger | Recipients | Key content | Sent from |
|---|---|---|---|---|
| `chat.needs_host` (spec 005, changed) | A conversation moves to "needs the host" outside quiet hours, or an emergency or malfunction at any hour | The effective contacts (all handlers when none are chosen); for emergencies also every owner and admin | Unchanged | Worker, through the outbox |
| `chat.quiet_summary` (new) | Quiet hours end with held notices for a recipient and property whose conversations still need the host | That recipient | Property name, the number of conversations, for each one the reason and the first 120 characters of the guest's latest message, and a link to each conversation page | `chat.quiet-digest` cron job (every minute), through the outbox |
