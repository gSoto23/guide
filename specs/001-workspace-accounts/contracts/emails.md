# Email Contract: Workspaces, Accounts, Roles and Invitations

**Feature**: [spec.md](../spec.md) · **API**: [http-api.md](http-api.md)

All emails are transactional and go through `NotificationPort` (Amazon SES adapter, with a
Postmark fallback; research R9).
They are rendered from React Email templates in the recipient's preferred language (Spanish or
English, FR-031) and are readable on a phone.

Rules for every email:

- No passwords exist, so none are ever sent.
- One-time codes appear only in their own email and expire in 10 minutes.
- Links point only to the portal's origin.
- No tracking pixels on security emails.
- Every security email ends with "If this wasn't you" guidance and a link to review sessions.

| Template ID | Trigger | Recipient | Key content | Sent from |
|---|---|---|---|---|
| `auth.signin_code` | Email sign-in or sign-up request | Requester | 6-digit code and sign-in link, 10-minute expiry | API (inline, for speed) |
| `auth.new_device` | Sign-in from an unknown device (FR-012) | Account user | Device, approximate location, time; link to sessions | Worker |
| `auth.lockout` | Too many failed codes (AC-SEC-001) | Account user | That sign-in is paused, until when, and what to do | Worker |
| `auth.mfa_changed` | Second factor or passkey added or removed | Account user | What changed, when, from which device | Worker |
| `account.email_change_code` | Email change requested | New address | 6-digit code, 10-minute expiry | API |
| `account.email_changed` | Email change confirmed (FR-029) | Old address | That the email changed, and how to get help if it wasn't them | Worker |
| `account.deletion_scheduled` | Account deletion requested (FR-028) | Account user | Deletion date (30 days) and how to cancel | Worker |
| `account.deleted` | Account purged | Account user (last address) | Confirmation | Worker |
| `team.invitation` | Invitation sent or resent (FR-018) | Invited email | Workspace name, inviter name, role, accept link, 7-day expiry | Worker |
| `team.invitation_accepted` | Invitation accepted | Inviter | Who joined and with which role | Worker |
| `team.member_removed` | Member removed (FR-025) | Removed member | Workspace name; access ended | Worker |
| `team.role_changed` | Role changed | Affected member | Old and new role | Worker |
| `team.ownership_transferred` | Ownership transfer (FR-026) | Previous and new owner | Who the new owner is | Worker |
| `workspace.deletion_scheduled` | Owner deletes the workspace (FR-027) | All members | Deletion date and the owner's restore option | Worker |
| `workspace.restored` | Owner restores the workspace | All members | That the workspace is active again | Worker |

**Delivery targets** (plan, Performance Budget):

- `auth.signin_code` is queued in ≤ 1 s and reaches the inbox in p95 ≤ 30 s.
- The others are sent within 60 s at p95 (NFR-19).
