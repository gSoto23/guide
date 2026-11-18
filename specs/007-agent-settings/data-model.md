# Data Model: Agent Settings

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migration `0026_agent_settings.sql` (tables, backfill, drops) and `0027_agent_settings_rls.sql` (RLS,
grants). Every new table has RLS enabled and forced, with the system policy for the owner role and member
policies for `guidesk_app`, as in spec 005.

## assistant_settings

One row per scope. A missing row means the defaults (R8).

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | not null |
| property_id | uuid FK property, cascade | null for the workspace row |
| autonomy | jsonb | `{ topic: level }` for the 10 topics of R1; levels `draft`, `auto`, `full_auto`; missing topics read as `draft` |
| tone | text | `casual` or `formal`; default `casual` |
| quiet_enabled | boolean | default false |
| quiet_start | time | `HH:MM`; required when `quiet_enabled` |
| quiet_end | time | required when `quiet_enabled`; ≠ `quiet_start` |
| contacts_mode | text | `all` or `selected`; default `all` |
| own_groups | text[] | property rows only: subset of `autonomy`, `tone`, `quiet_hours`, `contacts`; `{}` on the workspace row |
| instruction_version_id | uuid FK assistant_instruction_version, set null | current instructions of this scope |
| version | integer | starts at 1; +1 per save (R10) |
| updated_by | text FK user, set null | |
| updated_at | timestamptz | |

Constraints: unique `(workspace_id, property_id) NULLS NOT DISTINCT`; check on `tone`, `contacts_mode`,
`own_groups` values; check `NOT quiet_enabled OR (quiet_start IS NOT NULL AND quiet_end IS NOT NULL AND
quiet_start <> quiet_end)`; trigger: a property row's property belongs to the row's workspace (as the
005 parent-match triggers).

RLS: members of the workspace read (`app_current_workspace_role() IS NOT NULL`); owners and admins insert
and update (`app_can_manage_assistant(workspace_id)`: role owner or admin, workspace active). No delete
for members.

## assistant_contact

| Column | Type | Rules |
|---|---|---|
| settings_id | uuid FK assistant_settings, cascade | PK part |
| membership_id | uuid FK membership, cascade | PK part |
| workspace_id | uuid FK workspace, cascade | for RLS; trigger checks it matches both parents |

Used only when the row's `contacts_mode = selected`. Members read; owners and admins insert and delete.

## assistant_instruction_version

Immutable.

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | null for workspace instructions |
| text | text | 1 to 1,000 characters, passed `instructionIssues` (R11) |
| created_by | text FK user, set null | |
| created_at | timestamptz | |

Members read; owners and admins insert; no update or delete for members. Retention deletes versions that
are not current and not referenced by a trace.

## assistant_test

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | |
| created_by | text FK user, cascade | |
| question | text | 1 to 2,000 characters |
| language | text | `es` or `en`: the member's screen language, for fixed texts |
| status | text | `pending`, `done` |
| outcome | text | null while pending; `sent`, `draft`, `held`, `pointer`, `greeting`, `limited`, `unavailable` |
| reason | text | needs-host reason when `draft` or `held` |
| topic | text | from the classification |
| answer_kind | text | `grounded`, `general`, `clarify`, or null |
| reply | text | what the guest would see (answer, holding reply, pointer, or greeting) |
| section_ids | uuid[] | cited sections |
| created_at, finished_at | timestamptz | |

Members who handle conversations insert (their own `created_by`) and read their workspace's tests. The
worker updates. Deleted after 30 days.

## chat_held_notice

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | |
| conversation_id | uuid FK conversation, cascade | |
| user_id | text FK user, cascade | the recipient |
| reason | text | needs-host reason |
| release_at | timestamptz | end of the quiet window |
| created_at | timestamptz | |

Unique `(conversation_id, user_id)`: one waiting notice per recipient and conversation (the latest
reason wins). Index on `release_at`. System only: no member policies or grants.

## agent_trace (spec 005, changed)

| Change | Rules |
|---|---|
| `conversation_id` nullable | check: exactly one of `conversation_id`, `assistant_test_id` |
| + `assistant_test_id` uuid FK assistant_test, cascade | |
| `autonomy` | adds `full_auto` |
| + `autonomy_source` text | `workspace` or `property`; null on traces before this feature |
| + `answer_kind` text | `grounded`, `general`, `clarify`, or null |
| + `tone` text | `casual` or `formal`; null before this feature |
| + `quiet_hours` boolean | default false |
| + `workspace_instruction_version_id`, `property_instruction_version_id` | FK assistant_instruction_version, `ON DELETE RESTRICT` |

The member column grant adds the new columns (host-facing, FR-020).

## Removed

`workspace.assistant_autonomy` and `property.assistant_autonomy` (and the 0025 `UPDATE` grant on the
workspace column), after the backfill of R9.

## Effective settings (domain, not stored)

`resolveAssistantSettings(workspaceRow | null, propertyRow | null)` →

```text
{
  autonomy: { [topic]: level }, autonomySource: "workspace" | "property",
  tone, toneSource,
  quietHours: { start, end } | null, quietSource,
  contacts: { mode: "all" } | { mode: "selected", membershipIds }, contactsSource,
  instructions: { workspace: { versionId, text } | null, property: { versionId, text } | null }
}
```

A property group not in `own_groups` takes the workspace row's value (or the default).
