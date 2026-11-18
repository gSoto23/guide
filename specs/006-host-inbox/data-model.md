# Data Model: Host Inbox and Reply Copilot

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migrations `0028_host_inbox.sql` (tables and columns) and `0029_host_inbox_rls.sql` (RLS, grants,
triggers).

## conversation (spec 005, changed)

| Change | Rules |
|---|---|
| `status` adds `done` | check updated; `needs_host_reason` set only when `needs_host` (unchanged rule) |
| `needs_host_reason` adds `taken_over` | |
| + `done_at` timestamptz, `done_by` text FK user (set null) | set together when `done` |
| + `taken_over_by` text FK user (set null), `taken_over_at` timestamptz | both null or both set (check) |
| + index `(workspace_id, status, last_message_at)` | inbox (research R1) |

Members who handle conversations may update `status`, `needs_host_reason`, `done_at`, `done_by`,
`taken_over_by`, `taken_over_at` (grant), through the existing update policy.

## copilot_run

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | |
| created_by | text FK user, cascade | |
| message | text | 1 to 4,000 characters |
| booking_status | text | `inquiry` or `confirmed` |
| language | text | `es` or `en` (member's screen, for fixed texts and notes) |
| status | text | `pending`, `done` |
| outcome | text | `drafted`, `limited`, `unavailable`, `failed` |
| draft | text | the reply text |
| section_ids | uuid[] | |
| checks | jsonb | `[{check, passed}]` |
| removed | text[] | subset of `link`, `email`, `phone` |
| caution | text | `emergency`, `malfunction`, `complaint`, `money`, `reservation_change`, `legal`, `codes`, or null |
| covered | boolean | the guide answered it |
| topic, answer_kind | text | from the classification and the answer |
| created_at, finished_at | timestamptz | |

Members read the workspace's runs; members who handle conversations insert their own; the worker writes
results. Deleted after 30 days with their traces.

## agent_trace (changed)

`+ copilot_run_id` uuid FK copilot_run (cascade); the subject check becomes "exactly one of
`conversation_id`, `assistant_test_id`, `copilot_run_id`". Member column grant adds it.

## push_subscription

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| user_id | text FK user, cascade | the owner |
| endpoint | text unique | https URL, ≤ 2,048 characters |
| p256dh, auth | text | base64url keys from the browser |
| device | text | browser family and platform label, ≤ 60 characters (no full user agent) |
| created_at, last_success_at | timestamptz | |

RLS: a user reads, inserts, and deletes only their own rows (`user_id = app_current_user_id()`); the
worker sends in the system context.

## conversation_presence

| Column | Type | Rules |
|---|---|---|
| conversation_id | uuid FK conversation, cascade | PK part |
| user_id | text FK user, cascade | PK part |
| workspace_id | uuid FK workspace, cascade | must match the conversation (trigger) |
| expires_at | timestamptz | `now() + 30 s` per heartbeat |

Members read the workspace's rows; members who handle conversations insert and update their own.

## assistant_suggestion_dismissal

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | PK part |
| topic | text | PK part; one of spec 007's topics |
| dismissed_until | timestamptz | |
| dismissed_by | text FK user (set null) | |

Members read; members who handle conversations insert and update.

## Security log events

`conversation.taken_over`, `conversation.handed_back`, `conversation.draft_rejected`,
`conversation.marked_done`, `conversation.reopened` (metadata: `propertyId`, `conversationId`), and
`push.subscribed`, `push.unsubscribed` (metadata: `device`).
