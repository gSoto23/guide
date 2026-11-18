# Email Contract: Guide Builder

**Feature**: [spec.md](../spec.md) · **API**: [http-api.md](http-api.md) ·
**Rules for every email**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md) ·
[feature 002 email contract](../../002-property-onboarding/contracts/emails.md)

The email goes through the existing outbox and `NotificationPort`, is rendered from a React Email
template in each recipient's language (Spanish or English), and is readable on a phone.

Rules added by this feature:

- No email ever contains a locked field value, a code, or guide content.
- Links point only to the portal's origin.

| Template ID | Trigger | Recipients | Key content | Sent from |
|---|---|---|---|---|
| `guides.reveal_limit` | A member reaches 20 locked-field reveals in one hour (FR-018) | Owners of the workspace (sent once per member and hour) | The member's name and email, the number of reveals, the properties involved (names only), the time, that further reveals are blocked until the hour ends, and links to the security log and to the member's sessions | API, through the outbox |
