# Email Contract: Guest Guide

**Feature**: [spec.md](../spec.md) · **API**: [http-api.md](http-api.md) ·
**Rules for every email**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md) ·
[feature 003 email contract](../../003-guide-builder/contracts/emails.md)

The email goes through the existing outbox and `NotificationPort`, is rendered from a React Email
template in each recipient's language (Spanish or English), and is readable on a phone.

Rules added by this feature:

- No email contains a confirmation code, a stay link, a locked field value, or guest data.
- Links point only to the portal's origin.

| Template ID | Trigger | Recipients | Key content | Sent from |
|---|---|---|---|---|
| `guides.verification_locked` | A stay reaches 5 wrong confirmation codes and locks (FR-035, research R8) | Owners and admins of the workspace (once per lockout) | The property name, the stay's dates, how long attempts are paused, how many lockouts the stay had in 24 hours, a suggestion to regenerate the stay link if the guest did not cause it, and a link to the property's Share screen | API, through the outbox |
