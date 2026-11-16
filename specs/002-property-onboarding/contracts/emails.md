# Email Contract: Property Onboarding

**Feature**: [spec.md](../spec.md) · **API**: [http-api.md](http-api.md) ·
**Rules for every email**: [feature 001 email contract](../../001-workspace-accounts/contracts/emails.md)

These emails are transactional. They go through the existing outbox and `NotificationPort`, are
rendered from React Email templates in each recipient's language (Spanish or English), and are
readable on a phone. Each is sent once per event to every owner and admin of the workspace.

Rules added by this feature:

- No email ever contains a calendar link, a PMS credential, an imported code, or a guest name.
- Links point only to the portal's origin.
- Counts and reasons come from the import run, never from raw provider responses.

| Template ID | Trigger | Recipients | Key content | Sent from |
|---|---|---|---|---|
| `properties.import_finished` | A PMS or CSV import run finishes (FR-029) | Owners and admins | Source (provider name or "CSV"), counts of created, needing details, failed, and skipped, the first five failure reasons, and a link to the run | Worker |
| `properties.feed_failing` | A calendar feed has failed for 24 hours (FR-024) | Owners and admins | Property name, channel, last successful read, what to check, and a link to the property's calendars | Worker |
| `properties.pms_reconnect` | PMS refreshes have failed for 24 hours, for example a revoked token (FR-035) | Owners and admins | Provider and account label, last successful refresh, how to reconnect, and that stays shown may be out of date | Worker |
