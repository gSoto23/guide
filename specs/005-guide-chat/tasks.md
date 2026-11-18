---

description: "Task list for feature 005: in-guide AI chat"
---

# Tasks: In-Guide AI Chat

**Input**: Design documents from `/specs/005-guide-chat/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story; the agent eval suite gates
prompt, schema, model, and effort changes.

> **Production gates (not development gates):** the agent eval suite against the real model (the
> `ANTHROPIC_API_KEY` CI secret), the legal review of chat texts (OQ-35), and the quickstart on staging.

## Format: `[ID] [P?] [Story] Description`

Conventions: guest routes resolve the workspace and property only from the property link (spec 004
R12); the model never receives a locked value; every assistant output writes a trace; member writes
check `conversations.handle` through `WorkspaceAction`; every screen in Spanish and English; synthetic
test data only.

---

## Phase 1: Setup

- [X] T001 Create `evals/agent` (package `@guidesk/evals-agent`, scripts `build`, `typecheck`, `lint`, `eval`) on the pattern of `evals/guide`, with `src/run.ts`, `src/cases.ts`, `src/score.ts`, and two fictional guides in `cases/guides/`
- [X] T002 [P] Add the `chat` namespace to `packages/i18n/messages/guest.{es,en}.json` (intro, suggestions header, typing, holding texts per reason, pause, pointer, greeting, emergency card, errors) and the `conversations` and `assistant` namespaces to the portal catalogs
- [X] T003 [P] Extend `e2e/helpers/guest.ts` with `setAutonomy`, `openChat`, and `sendChatMessage`

## Phase 2: Foundational

- [X] T004 [P] Domain tests in `packages/domain/test/agent/`: `policy.test.ts` (every branch of research R5), `knowledge.test.ts` (deterministic text, section headers, locked fields as labels, language fallback, no values), `checks.test.ts` (citation, code-like numbers, links, promises, off-platform)
- [X] T005 Implement `packages/domain/src/agent/` (`policy.ts`, `knowledge.ts`, `checks.ts`, `suggestions.ts`, `index.ts`) and export it
- [X] T006 Add security events `assistant.autonomy_changed` and `conversation.replied` with allowlists in `packages/domain/src/security-events.ts`
- [X] T007 Add `packages/db/src/schema/chat.ts` (tables of data model §1–§3) and the `workspace` and `property` columns; generate `0023_guide_chat.sql`; prettier on meta
- [X] T008 Write `0024_guide_chat_rls.sql` (RLS forced, member read, `conversations.handle` writes, system policies, the `agent_trace_member` view) and `packages/db/test/integration/guide-chat-rls.test.ts`
- [X] T009 [P] Add `packages/contracts/src/chat.ts` (guest chat, conversations, assistant settings)
- [X] T010 Add `classifyGuestMessage` and `answerGuest` to `LlmPort` with schemas and prompts in `packages/integrations/src/llm/agent/`, the deterministic fake in `fake.adapter.ts`, and unit tests
- [X] T011 Implement both calls in `anthropic.adapter.ts` (structured outputs, low effort, cached system and knowledge, refusal fallback, deadlines, cache-aware cost) with contract tests on recorded fixtures
- [X] T012 Register queues `chat.reply` (stately, singleton per conversation, 500 ms polling) and `agent.cost-check` (daily) in `packages/domain/src/jobs.ts` and the worker
- [X] T013 Create the API `chat` module skeleton (`apps/api/src/chat/`): chat cookie helpers, conversation resolution in the guest context, registered in `app.module.ts`

## Phase 3: User Story 1 - Ask the guide (P1) 🎯 MVP

- [X] T014 [P] [US1] API integration test `apps/api/test/integration/guest-chat.test.ts`: intro, first message sets the cookie, idempotent `clientId`, messages after a cursor, 2,000-character limit, unavailable guide, another property's conversation not found
- [X] T015 [P] [US1] Worker integration test `apps/worker/test/integration/chat-reply.test.ts` (answer branches): auto answer with citation, pointer for code questions, greeting, not confident → holding reply and draft, trace written, model input without locked values
- [X] T016 [P] [US1] Guest app test `apps/guide/test/chat.test.ts`: Ask entry and chat texts in the page data
- [X] T017 [P] [US1] End-to-end `e2e/specs/chat-us1.spec.ts`
- [X] T018 [US1] Implement the guest chat routes in `apps/api/src/chat/` (GET and POST, enqueue `chat.reply`)
- [X] T019 [US1] Implement `apps/worker/src/jobs/chat-reply.ts` (load the published snapshot, classify, decide, answer, checks, write reply or draft, trace, usage)
- [X] T020 [US1] Implement the chat UI `apps/guide/src/client/chat.ts` and styles, the Ask entry in the layout, and the asset build (separate bundle)
- [X] T021 [US1] Eval cases: answerable, language, pointer, greeting, out of scope

## Phase 4: User Story 2 - Hand risky messages to the host (P1)

- [X] T022 [P] [US2] Worker tests: every escalation category, emergency card payload first, very negative sentiment, injection attempts, model unavailable, refusal
- [X] T023 [P] [US2] Notification test: one `chat.needs_host` per conversation per 30 minutes to owners, admins, and agents
- [X] T024 [P] [US2] End-to-end `e2e/specs/chat-us2.spec.ts`
- [X] T025 [US2] Implement the escalation and emergency paths in the job, with holding texts and quoted safety steps
- [X] T026 [US2] Email `packages/emails/src/chat/needs-host.tsx` and the notification in the job
- [X] T027 [US2] Eval cases: escalation per category and injection (guest message and guide text)

## Phase 5: User Story 3 - Review drafts and reply (P1)

- [X] T028 [P] [US3] API integration test `apps/api/test/integration/conversations.test.ts`: list order, detail with draft and member traces, send unchanged, edit and send, reply, warnings and override, first send wins, roles, guest sees replies
- [X] T029 [P] [US3] End-to-end `e2e/specs/chat-us3.spec.ts`
- [X] T030 [US3] Implement `apps/api/src/conversations/` (list, detail, send draft, reply)
- [X] T031 [US3] Portal: `properties/[propertyId]/conversations` list and `[conversationId]` page (H-21 subset) with "Why this reply"; link from the property page; bundle budget entries
- [X] T032 [US3] Draft mode and superseded drafts in the job

## Phase 6: User Story 4 - Assistant settings (P2)

- [X] T033 [P] [US4] Integration test `apps/api/test/integration/assistant-settings.test.ts`: default, override, clear, roles, events
- [X] T034 [P] [US4] End-to-end `e2e/specs/chat-us4.spec.ts`
- [X] T035 [US4] Implement the settings routes in `apps/api/src/conversations/`
- [X] T036 [US4] Portal: assistant card on the property page and in workspace settings

## Phase 7: User Story 5 - Limits and budgets (P2)

- [X] T037 [P] [US5] Tests: device pause without model call, property and workspace budgets, one owner email per day
- [X] T038 [P] [US5] End-to-end `e2e/specs/chat-us5.spec.ts`
- [X] T039 [US5] Implement device limits in the API, budget checks in the API and the job, `chat_usage_daily`, and `chat.limit_reached`

## Phase 8: User Story 6 - Traces (P3)

- [X] T040 [P] [US6] Tests: trace fields, member projection without model, tokens, or cost, cost check above $0.10
- [X] T041 [P] [US6] End-to-end `e2e/specs/chat-us6.spec.ts`
- [X] T042 [US6] Implement the member trace projection, "Why this reply", and `apps/worker/src/jobs/agent-cost-check.ts`

## Phase 9: Polish

- [X] T043 [P] Cross-tenant cases for every conversation route in `apps/api/test/integration/cross-tenant.test.ts`
- [X] T044 [P] Security review test `apps/api/test/integration/security-review-005.test.ts` (AC-SEC-001 to 009)
- [X] T045 [P] Retention rules and tests in the worker
- [X] T046 [P] Accessibility: axe on the chat and the conversation page in `e2e/specs/a11y.spec.ts`
- [X] T047 [P] Chat bundle size check in `apps/guide/scripts/check-size.ts`
- [X] T048 [P] Timing tests: guest chat routes p95 and the job with simulated latency
- [X] T049 CI: `evals-agent` job like `evals-guide` (skipped without the secret)
- [ ] T050 Docs: security.md (SEC-07, SEC-08 as implemented), overview (flow 5.1 notes), UX README gap 3, ADR-0005 knowledge renderer note
- [ ] T051 Run the quickstart locally and record the result in research R16

## Dependencies

Setup → Foundational → US1 → US2 → US3 → US4, US5, US6 (any order) → Polish. The job file and the chat
UI are touched by several stories: those tasks run in story order.
