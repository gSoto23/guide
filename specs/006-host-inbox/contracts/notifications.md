# Notification Contract: Host Inbox and Reply Copilot

**Feature**: [spec.md](../spec.md) · **Email rules**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md)

Every push carries a title, a body of at most 120 characters, and a portal link. No guest text, code,
or contact data (SEC-20). Texts in the member's language.

| Push | Trigger | Recipients | Title / body | Link |
|---|---|---|---|---|
| `push.needs_host` | Same moment and recipients as `chat.needs_host` (specs 005, 007), including `taken_over` | Each registered device of each recipient | "{property}" / the reason in plain words ("Possible emergency", "Draft ready to review", "Taken over: the guest wrote again") | The conversation page |
| `push.quiet_summary` | Same as `chat.quiet_summary` (spec 007) | Each registered device of the recipient | "{property}" / "{n} guests are waiting" | The inbox, filtered to the property |
| `push.test` | `POST /me/push/test` | The caller's devices | "Guidesk" / "Alerts are on for this device." | The inbox |

`chat.needs_host` email gains the reason `taken_over` ("The guest wrote again in a conversation you took
over").
