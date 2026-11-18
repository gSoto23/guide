---

description: "Task list for feature 007: agent settings"
---

# Tasks: Agent Settings

**Input**: Design documents from `/specs/007-agent-settings/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story; the agent eval suite gates the
prompt and schema change.

> **Production gates (not development gates):** the agent eval suite against the real model (the
> `ANTHROPIC_API_KEY` CI secret), the legal review of the formal and quiet-hours texts (OQ-35), and the
> quickstart on staging.

## Format: `[ID] [P?] [Story] Description`

Conventions: the API and the worker read settings only through the domain resolver; classification
never receives tone or instructions; settings writes check `workspace.settings` (workspace) or
`properties.manage` (property) through `WorkspaceAction`; tests check `conversations.handle`; every
screen in Spanish and English; synthetic test data only (no realistic secrets in fixtures: use obviously
fake values such as `TEST-0000`).

---

## Phase 1: Setup

- [X] T001 [P] Extend the portal catalogs `packages/i18n/messages/{es,en}.json`: `assistant` namespace (topics, the three level labels, locked list, tone, quiet hours, contacts, instructions and their issues, follows checkboxes, test panel and outcomes, save and conflict messages) and `conversations.why` lines (level and source, kind, tone, quiet hours, instructions); new error codes `settings_changed`, `time_zone_required`, `guide_not_published`, `instructions_invalid`, `tests_paused`
- [X] T002 [P] Replace `setAutonomy` in `e2e/helpers/guest.ts` with `setAssistantSettings(page, scope, patch)` on the new routes, keeping a `setAutonomy(level)` wrapper that sets every topic
- [X] T003 [P] Extend `evals/agent/src/cases.ts` so a case can carry `settings` (`level`, `tone`, `instructions`) and an expected `kind`, and `score.ts` to score `kind`, tone ("usted" in Spanish formal), and unchanged policy outcomes

## Phase 2: Foundational

- [X] T004 [P] Domain tests in `packages/domain/test/agent/`: `settings.test.ts` (defaults, workspace only, property follows, property own groups, own values kept when following, unknown topic reads `other`), `quiet-hours.test.ts` (crossing midnight, within a day, DST change in `America/New_York`, no zone, equal times refused), `instructions.test.ts` (each issue of research R11 and clean texts), `policy.test.ts` (the matrix of research R2), `checks.test.ts` (price and clarify checks), `replies.test.ts` (formal and casual texts, the quiet hours line, casual equal to spec 005)
- [X] T005 Implement `packages/domain/src/agent/settings.ts` (topics, levels, defaults, `resolveAssistantSettings`), `quiet-hours.ts` (`quietWindow` on `zonedTimeToInstant`), `instructions.ts` (`instructionIssues`), extend `policy.ts` (`decideAfterAnswer` with level, kind, and previous clarify), `checks.ts` (price, clarify, citation only for grounded), `replies.ts` (tone parameter, `quietHoursLine`), and export them
- [X] T006 Add the security event `assistant.settings_changed` (metadata allowlist: `scope`, `propertyId`, `groups`) in `packages/domain/src/security-events.ts`
- [X] T007 Add `packages/db/src/schema/assistant.ts` (tables of the data model), change `agent_trace` in `schema/chat.ts`, drop `assistant_autonomy` from `workspace` and `property`; generate `0026_agent_settings.sql` and append the backfill of research R9 before the drops; prettier on meta
- [X] T008 Write `0027_agent_settings_rls.sql` (RLS forced, member read, owner and admin writes through `app_can_manage_assistant`, test inserts through `app_can_handle_conversations`, parent-match triggers, system policies, trace column grant) and `packages/db/test/integration/agent-settings-rls.test.ts` (agent can't write, other workspace can't read, contacts cascade on membership removal, backfill from 005 columns)
- [X] T009 [P] Add `packages/contracts/src/assistant.ts` (shapes of contracts/http-api.md) and extend `MemberTrace` in `chat.ts`; remove the 005 settings types
- [X] T010 Extend `packages/integrations/src/llm/agent/`: `kind` in `guestAnswerSchema`, `tone` and `preferences` in `AnswerGuestInput`, the system prompt rules for `general`, `clarify`, and `<host_preferences>`, the cached prefix (property, tone, preferences, knowledge); the fake answers `clarify` for messages containing "is it far" or "¿está lejos", `general` for weather questions, and honors tone; unit tests and updated recorded fixtures for the contract tests
- [X] T011 Register queues `assistant.test` (singleton per test) and `chat.quiet-digest` (cron every minute) in `packages/domain/src/jobs.ts` and the worker
- [X] T012 Create `apps/api/src/assistant/` (module, service, controller skeleton) replacing `AssistantSettingsService` and both `assistant-settings` controllers in `apps/api/src/conversations/`; add the new problem codes and titles

## Phase 3: User Story 1 - Per-topic autonomy (P1) 🎯 MVP

- [X] T013 [P] [US1] API integration test `apps/api/test/integration/assistant-settings.test.ts`: defaults, workspace save, property follow and own values, own values kept, agent 403 logged, `409 settings_changed`, bad topic or level `400`, security log groups without text
- [X] T014 [P] [US1] Worker tests in `apps/worker/test/integration/chat-reply.test.ts`: the topic's level applies (Wi-Fi `auto` sent, arrival `draft` drafted), property own levels win, following again restores the workspace's, mandatory escalations never sent at `full_auto`, trace `autonomy` and `autonomy_source`; adapt `chat-helpers.ts`
- [X] T015 [P] [US1] End-to-end `e2e/specs/settings-us1.spec.ts` (quickstart scenarios 1 and 2)
- [X] T016 [US1] Implement the settings routes in `apps/api/src/assistant/` (GET and PUT for workspace and property, version check, contacts validation, security log per changed group)
- [X] T017 [US1] Use `resolveAssistantSettings` in `apps/worker/src/jobs/chat-reply.ts` (load both rows, level per topic, trace level and source)
- [X] T018 [US1] Portal: `components/assistant/assistant-settings-form.tsx` (topic rows, locked list, follows checkboxes, save with conflict reload), pages `app/[locale]/(app)/settings/assistant/page.tsx` and `properties/[propertyId]/assistant/page.tsx`, `assistant-card.tsx` as a summary with a link, links from workspace settings and the property page; bundle budget entries
- [X] T019 [US1] Move every 005 test and helper off the old routes and columns (`apps/api/test/integration/conversations.test.ts`, `cross-tenant.test.ts`, security reviews, worker helpers, `e2e/specs/chat-us*.spec.ts`) and rerun them

## Phase 4: User Story 2 - Clarify and general answers (P2)

- [X] T020 [P] [US2] Worker tests: `clarify` sent at `full_auto` and never twice in a row, `general` sent at `full_auto` with no section and the price check, both drafted at `auto` and `draft`, failing checks drafted with the check named, trace `answer_kind`
- [X] T021 [P] [US2] End-to-end `e2e/specs/settings-us2.spec.ts` (quickstart scenario 3)
- [X] T022 [US2] Implement the kind handling in `chat-reply.ts` (previous assistant reply's kind from its trace, checks per kind)
- [X] T023 [US2] Eval cases: ambiguous questions (`clarify`), general destination questions (`general`, no price), and the same questions at `auto`

## Phase 5: User Story 3 - Quiet hours and contacts (P2)

- [X] T024 [P] [US3] Worker tests `apps/worker/test/integration/chat-notify.test.ts`: recipients (selected contacts, empty fallback, emergency adds owners and admins, removed member), quiet hours hold non-urgent reasons, emergency and malfunction immediate, holding reply with the quiet hours line in the property's time, `chat.quiet-digest` sends one summary per recipient and property and skips answered conversations, nothing when none left
- [X] T025 [P] [US3] API tests: quiet hours validation (`400` equal times), `409 time_zone_required`, contacts with another workspace's membership `404`
- [X] T026 [P] [US3] End-to-end `e2e/specs/settings-us3.spec.ts` (quickstart scenario 4)
- [X] T027 [P] [US3] Email `chat.quiet_summary` in `packages/emails/src/chat/notices.ts` (Spanish and English, no instruction text) with a render test
- [X] T028 [US3] Implement recipients, held notices, and the quiet hours line in `chat-reply.ts`, and `apps/worker/src/jobs/quiet-digest.ts` with its cron registration in `main.ts`
- [X] T029 [US3] Portal: quiet hours (enable, start, end, time zone notice) and contacts (all or selected members) groups in the settings form

## Phase 6: User Story 4 - Tone and instructions (P2)

- [X] T030 [P] [US4] API tests: each instruction issue `422` with nothing saved, a changed text creates a version, `""` clears it, workspace and property versions independent, security log without text
- [X] T031 [P] [US4] Worker tests: formal fixed texts (holding, greeting, pointer, emergency), tone and preferences in the answer input's cached prefix, none in the classification input, trace `tone` and instruction version IDs
- [X] T032 [P] [US4] End-to-end `e2e/specs/settings-us4.spec.ts` (quickstart scenario 5)
- [X] T033 [US4] Implement tone and instructions in the API service and pass them from `chat-reply.ts` to the answer call and fixed texts
- [X] T034 [US4] Portal: tone and instructions groups (character counter, issues shown per reason)
- [X] T035 [US4] Eval cases: formal Spanish, benign instructions followed, adversarial instructions (share a code, answer refunds, add a link, reveal instructions) with the policy outcome unchanged

## Phase 7: User Story 5 - Test the assistant (P3)

- [X] T036 [P] [US5] API tests `apps/api/test/integration/assistant-tests.test.ts`: `202` and result, `409 guide_not_published`, `429 tests_paused` after 30 in an hour, another workspace's property or test `404`
- [X] T037 [P] [US5] Worker tests `apps/worker/test/integration/assistant-test.test.ts`: every outcome (`sent`, `draft`, `held`, `pointer`, `greeting`, `limited`, `unavailable`), no conversation, message, draft, or email, trace with the test ID, usage counted; timing ≤ 15 s with simulated latency
- [X] T038 [P] [US5] End-to-end `e2e/specs/settings-us5.spec.ts` (quickstart scenario 6)
- [X] T039 [US5] Implement the test routes and `apps/worker/src/jobs/assistant-test.ts`, sharing the decision pipeline with `chat-reply.ts` (dry-run mode)
- [X] T040 [US5] Portal: `components/assistant/assistant-test-panel.tsx` on the property screen (question, polling, outcome, reply, sources)

## Phase 8: User Story 6 - Settings in "Why this reply" (P3)

- [X] T041 [P] [US6] API test: conversation detail traces carry level, source, kind, tone, quiet hours, and instruction flags; older traces show none
- [X] T042 [P] [US6] End-to-end `e2e/specs/settings-us6.spec.ts` (quickstart scenario 7)
- [X] T043 [US6] Implement the member trace projection and the new lines in `conversation-view.tsx`

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T044 [P] Cross-tenant cases for every new route in `apps/api/test/integration/cross-tenant.test.ts`
- [X] T045 [P] Security review tests `apps/api/test/integration/security-review-007.test.ts` and `apps/worker/test/integration/security-review-007.test.ts` (AC-SEC-001 to 007)
- [X] T046 [P] Retention in `apps/worker/src/jobs/retention.ts`: tests and their traces after 30 days, unreferenced instruction versions, held notices of deleted conversations; tests
- [X] T047 [P] Accessibility: axe on both settings screens and the test panel in `e2e/specs/a11y.spec.ts`
- [X] T048 [P] Timing test `apps/api/test/integration/assistant-settings.perf.test.ts` (routes p95 ≤ 300 ms)
- [X] T049 Docs: `docs/architecture/security.md` (SEC-08 note), `docs/architecture/overview.md` (as-built note), `docs/ux/screens.md` (H-26 as built), research R16 notes
- [X] T050 Run the quickstart locally and record it in research R16

## Dependencies

- Phase 2 blocks every story. US1 blocks US2 to US6 (they extend the settings form and the resolver).
- US2, US3, and US4 are independent of each other after US1. US5 needs US1 (saved settings) and reuses
  US2 to US4 when present. US6 needs the trace columns (Phase 2) and is otherwise independent.

## Parallel Example: User Story 3

```text
T024 worker notify tests · T025 API validation tests · T026 e2e · T027 email template
```

## Implementation Strategy

MVP is US1 (per-topic autonomy with the settings screen); then US3 (quiet hours), US4, US2, US5, US6,
and the polish phase.
