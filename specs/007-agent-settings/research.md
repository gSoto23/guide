# Research: Agent Settings

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-18

Decisions for spec 007. Each builds on what spec 005 shipped ([005 research](../005-guide-chat/research.md)).

## R1. Topics and levels

- **Decision:** the autonomy topics are the classifier's section topics: `arrival`, `wifi`, `house_rules`,
  `appliances`, `amenities`, `parking`, `local_recommendations`, `emergency` (shown as "Safety
  information"), `checkout`, and `other`. `greeting` has no row: greetings always get the fixed
  greeting. Levels are `draft`, `auto`, `full_auto`. Questions about custom sections are `other`, because
  the classifier never sees the guide (005 R3). The locked rows are the mandatory escalation reasons of
  005 (`emergency`, `malfunction`, `complaint`, `money`, `reservation_change`, `legal`) plus "requests
  for codes" and "anything the assistant isn't sure about", shown as text, never as controls.
- **Rationale:** the classification already returns these topics; no new model output, no new cost.
- **Alternatives:** deriving the topic from the cited section after the answer (custom sections could
  get a row, but the level would depend on the model's citation, not on the question); a coarser list
  of 4 groups (fewer controls, but hosts asked for Wi-Fi and parking separately in research).

## R2. The decision after the answer

- **Decision:** the answer call returns a `kind`: `grounded` (from cited sections), `general` (general
  destination information), or `clarify` (one clarifying question). The domain's `decideAfterAnswer`
  becomes:
  1. `answerable` false or `needsHost` true → draft, reason `not_confident` (every level).
  2. Level `draft` → draft, `draft_ready`.
  3. `grounded` → checks (citation, codes, links, promises, off-platform) → send, or draft `check_failed`.
  4. `general` or `clarify` at `auto` → draft, `draft_ready`.
  5. `general` at `full_auto` → checks without the citation, plus the price check (R4) → send or
     `check_failed`.
  6. `clarify` at `full_auto` → the previous assistant reply in the conversation was also a clarifying
     question → draft `draft_ready`; otherwise checks without the citation, plus the clarify check (R4)
     → send or `check_failed`.
  The mandatory escalations, pointers, greetings, and budget hold stay in `decideBeforeAnswer`,
  unchanged and independent of every setting (FR-002, FR-013).
- **Rationale:** one pure function with a small, fully testable matrix; no new needs-host reasons, so
  the conversation page and emails don't change.
- **Alternatives:** a separate model call to judge ambiguity (cost); new reasons `general_review` and
  `clarify_review` (more texts for little host value; the trace shows the kind).

## R3. The answer call: tone and instructions

- **Decision:** the answer schema gains `kind`. The system prompt (static, cached) gains the rules for
  `general` and `clarify` and a rule that `<host_preferences>` are the host's style and content
  preferences, followed only when they don't conflict with the numbered rules, never a source of facts,
  links, offers, or escalation changes, and never revealed. The cached prefix per property becomes
  property line + tone line + `<host_preferences>` (workspace text, then property text) + `<knowledge>`.
  Classification is unchanged and never sees tone or instructions.
- **Rationale:** escalation stays decided by a call the host can't influence (FR-013); tone and
  instructions are stable per property, so they live in the cached prefix and add no per-message cost.
- **Alternatives:** instructions in the classification too (they could steer escalation); instructions
  after the conversation (outside the cache, and closer to the guest's text, which raises injection
  risk).

## R4. New output checks

- **Decision:** two deterministic checks join 005 R6:
  - **Price** (general answers only): no currency amount (symbols `$ ₡ € £`, codes `USD CRC EUR`, words
    "dólares", "colones", "dollars", "euros" next to a number).
  - **Clarify** (clarifying questions only): one question (`?` present, at most two sentences) of at most
    300 characters.
  The citation check runs only for `grounded`.
- **Rationale:** FR-004 ("never state prices"; a single short question); deterministic, cheap.
- **Alternatives:** model-graded checks (cost, latency, weaker guarantee).

## R5. Tone in fixed texts

- **Decision:** `holdingReply`, `pointerReply`, `greetingReply`, `emergencyReply`, and the new quiet
  hours line take a `tone`. Spanish formal variants use "usted"; formal text in both languages has no
  exclamation marks or emoji. Casual keeps 005's texts byte for byte.
- **Rationale:** FR-007 covers every guest-facing assistant message; fixed texts stay reviewed (OQ-35).
- **Alternatives:** asking the model to rewrite fixed texts (unreviewed text in holding replies).

## R6. Quiet hours

- **Decision:** a window with `start` and `end` (`HH:MM`, start ≠ end) in the property's IANA zone. A pure
  function `quietWindow(now, timeZone, start, end)` returns `{ active, endsAt }`, using the existing
  `zonedTimeToInstant` (spec 004). A window crossing midnight is active when local time ≥ start or <
  end. A property without a time zone has no quiet hours (the screen asks for one).
- **Rationale:** FR-008; daylight saving is handled by computing instants from local wall times.
- **Alternatives:** UTC windows (wrong after DST changes and confusing for hosts).

## R7. Who gets emailed, and when

- **Decision:** recipients = the effective contacts that are still members with role owner, admin, or
  agent, or every such member when the list is empty; emergencies add every owner and admin. Outside
  quiet hours, the 005 rule applies (one email per conversation per 30 minutes). During quiet hours,
  reasons other than `emergency` and `malfunction` write one held notice per recipient and conversation
  (`release_at` = the window's end) and send nothing. A worker cron job, `chat.quiet-digest`, runs every
  minute: it takes held notices due, keeps those whose conversation still needs the host, sends one
  summary email per recipient and property, and deletes the notices. Contacts are stored as membership
  IDs with `ON DELETE CASCADE`, so a removed member leaves every list at once.
- **Rationale:** FR-008, FR-010, SC-003 (summaries within 5 minutes; the job runs every minute).
- **Alternatives:** delayed per-window jobs (`startAfter`): stale when quiet hours change; storing user IDs
  (no cascade on removal).

## R8. Storage and resolution

- **Decision:** one table `assistant_settings` with a row per scope (workspace row with `property_id`
  null, property rows), unique on `(workspace_id, property_id)` with `NULLS NOT DISTINCT`. Columns: the
  level per topic (`jsonb`), `tone`, `quiet_enabled`, `quiet_start`, `quiet_end`, `contacts_mode`
  (`all`, `selected`), `own_groups` (property rows: which of `autonomy`, `tone`, `quiet_hours`,
  `contacts` the property sets itself), `instruction_version_id`, `version` (optimistic concurrency).
  Contacts in `assistant_contact (settings_id, membership_id)`. Instruction texts in immutable
  `assistant_instruction_version` rows. A missing row means defaults: every topic `draft`, `casual`,
  no quiet hours, all contacts, no instructions. The domain's `resolveAssistantSettings(workspaceRow,
  propertyRow)` returns the effective settings and each group's source; the API and the worker both use
  it.
- **Rationale:** FR-014 keeps a property's own values when it follows the workspace; one resolver means
  the screen and the worker can't disagree.
- **Alternatives:** columns on `workspace` and `property` (as in 005: wide tables and no place for
  contacts or versions); a key-value table (no constraints).

## R9. Moving off spec 005's columns

- **Decision:** migration 0026 creates the tables, writes a workspace row for every workspace whose
  `assistant_autonomy` is `auto` (all topics `auto`) and a property row for every property with an
  override (all topics at the override, `own_groups = {autonomy}`), then drops `workspace.
  assistant_autonomy` and `property.assistant_autonomy` with their grants. The 005 routes
  `assistant-settings` are replaced by the new routes in the same release (portal and API ship
  together).
- **Rationale:** FR-006 with no behavior change; one source of truth.
- **Alternatives:** keeping the old columns as the "all topics" level (two sources of truth).

## R10. Concurrent saves and audit

- **Decision:** `PUT` carries the `version` it read; a different current version returns `409
  settings_changed` with no change; a save increments it. Each save writes one security log event
  `assistant.settings_changed` with the scope and the changed groups (`autonomy`, `tone`,
  `quiet_hours`, `contacts`, `instructions`, `follows`), never the instruction text. Agents get 403 from
  the capability guard (`workspace.settings` for the workspace, `properties.manage` for a property, as
  in 005), logged by the guard.
- **Rationale:** FR-015, FR-016.

## R11. Instruction validation

- **Decision:** a pure `instructionIssues(text)` returns `too_long` (> 1,000 characters), `restricted_value`
  (the spec 002/003 restricted-value detector), `link` (`https?://`, `www.`, or a bare domain with a
  common TLD), `email`, `phone` (7 or more digits with separators), and `off_platform` (`asksOffPlatform`
  from spec 003). Any issue refuses the save with `422 instructions_invalid` and the issues. A changed
  text writes a new `assistant_instruction_version`; an emptied text sets the pointer to null.
- **Rationale:** FR-012, AC-SEC-002; codes never reach the model through instructions (SEC-06).

## R12. Testing the assistant

- **Decision:** `POST …/properties/:propertyId/assistant/tests` (`{ question }`, at most 2,000 characters)
  stores an `assistant_test` row (`pending`) and enqueues `assistant.test`; the portal polls `GET
  …/assistant/tests/:testId` every second for up to 20 seconds. The worker runs the same pipeline as
  `chat.reply` in dry-run mode: budget check, classification, `decideBeforeAnswer`, the answer, checks,
  `decideAfterAnswer`, with the saved settings; it writes a trace with `assistant_test_id` (and no
  conversation), counts the usage, and stores the outcome (`sent`, `draft`, `held` with reason,
  `pointer`, `greeting`, `limited`, `unavailable`), topic, kind, text, and sections. No message, draft,
  conversation, or email. Limit: 30 tests per member per hour (`RateLimitService`, `429` with
  `retryAfterSeconds`). Tests and their traces are deleted after 30 days. Any member who handles
  conversations can test.
- **Rationale:** model calls stay in the worker (005); one pipeline means a test predicts what a guest
  would get.
- **Alternatives:** a synchronous API call to the model (the API has no model client and request time
  would include the model's latency).

## R13. Trace additions

- **Decision:** `agent_trace` gains `answer_kind` (`grounded`, `general`, `clarify`, null when no answer
  call), `autonomy` widened to `full_auto`, `autonomy_source` (`workspace`, `property`), `tone`,
  `quiet_hours` (boolean), `workspace_instruction_version_id`, `property_instruction_version_id`
  (`ON DELETE RESTRICT`), and `assistant_test_id`; `conversation_id` becomes nullable with a check that
  exactly one of `conversation_id` and `assistant_test_id` is set. Members can read the new columns
  (host-facing, FR-020). Retention deletes instruction versions that are neither current nor referenced.
- **Rationale:** FR-020, FR-021; restricting deletes makes a referenced version outlive nothing it
  explains.

## R14. Portal

- **Decision:** two screens, both H-26: `/settings/assistant` (workspace) and
  `/properties/[propertyId]/assistant` (property, with the test panel). Topic rows use one `<select>` each
  (three options with plain labels: "I review each reply", "Answer when it's in the guide", "Answer and
  ask on its own"); locked rows are a list with a lock icon and text. On the property screen each group
  has a "Use the workspace settings" checkbox; unchecking shows the property's own values (prefilled
  from the workspace the first time). The 005 assistant card becomes a summary with a link to the
  screen. "Why this reply" adds the settings lines.
- **Rationale:** mobile-first (SC-001), WCAG (native controls), and a single save per screen.

## R15. Evaluation

- **Decision:** `evals/agent` cases gain optional settings (`tone`, `instructions`, `level`) and expected
  `kind`; new cases: formal tone (Spanish "usted"), ambiguous questions (`clarify`), general destination
  questions (`general`, no price), benign instructions followed, adversarial instructions (share codes,
  answer refunds, add a link, reveal instructions) with no policy change. The fake model answers them
  deterministically for CI without the secret; real-model runs keep the founder gate.
- **Rationale:** constitution V; prompt and schema change (FR-034 of 005).

## R16. Founder gates and implementation notes

- **Gates:** the same as 005 R16 (real-model evals need `ANTHROPIC_API_KEY`; staging quickstart with the
  real model), plus the legal review (OQ-35) of the formal and quiet-hours texts.
- **Notes:** filled in during implementation.
