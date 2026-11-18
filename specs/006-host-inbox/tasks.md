---

description: "Task list for feature 006: host inbox and reply copilot"
---

# Tasks: Host Inbox and Reply Copilot

**Input**: Design documents from `/specs/006-host-inbox/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story; the agent eval suite gates the
prompt change.

> **Production gates (not development gates):** VAPID keys on staging and production, the real-model
> eval run (`ANTHROPIC_API_KEY`), the legal review of copilot and push texts (OQ-35), and the staging
> quickstart with a real Android phone and an iPhone home-screen app.

## Format: `[ID] [P?] [Story] Description`

Conventions: member writes check `conversations.handle`; every screen in Spanish and English; push
payloads carry no guest text; synthetic test data only (no password-like literals in fixtures).

---

## Phase 1: Setup

- [X] T001 Add `web-push` ^4.0.0 to `packages/integrations` (respecting the minimum release age) and the `notification.push` and `copilot.draft` queues in `packages/domain/src/jobs.ts`
- [X] T002 [P] Portal catalogs `packages/i18n/messages/{es,en}.json`: `inbox` (tabs, filter, items, empty states, offline, suggestions), `copilot`, `notifications` (alerts card, iPhone steps, banner), conversation actions (reject, take over, done, replying, reason banner), new errors; the `taken_over` reason in `conversations.reasons`
- [X] T003 [P] Security events in `packages/domain/src/security-events.ts` (data model list) with allowlists

## Phase 2: Foundational

- [X] T004 [P] Domain tests and code: `packages/domain/src/agent/contacts.ts` (`removeContactDetails`, linear), `copilot.ts` (fixed host-voice texts per language and tone for emergencies and code requests; caution mapping), `knowledge` filter for benefit recommendations; unit tests
- [X] T005 Schema `packages/db/src/schema/inbox.ts` and `chat.ts` changes; generate `0028_host_inbox.sql`; write `0029_host_inbox_rls.sql` (RLS, grants, triggers); `packages/db/test/integration/host-inbox-rls.test.ts`
- [X] T006 [P] Contracts `packages/contracts/src/inbox.ts`; extend `ConversationDetail`, `ConversationSummary`, reasons
- [X] T007 `PushPort` with `WebPushAdapter` and `FakePushAdapter` in `packages/integrations/src/push/`, config from `VAPID_*`; contract test against a local HTTP endpoint (encrypted payload, TTL, urgency, 410 handling)
- [X] T008 Answer call `channel` and `bookingStatus` in `packages/integrations/src/llm/agent/` (schema, prompts, fake host voice); tests
- [X] T009 Emails: `taken_over` reason; push texts (`renderPush`) in `packages/emails/src/chat/`; tests

## Phase 3: User Story 1 - One inbox (P1) 🎯 MVP

- [X] T010 [P] [US1] API test `apps/api/test/integration/inbox.test.ts`: tabs and order, filter, done and reopen, a guest message reopens a done conversation, empty state flag, roles
- [X] T011 [P] [US1] End-to-end `e2e/specs/inbox-us1.spec.ts` (quickstart 1)
- [X] T012 [US1] Inbox route and done/reopen in `apps/api/src/inbox/`; reopen on guest message in `apps/api/src/chat/guest-chat.service.ts`
- [X] T013 [US1] Portal inbox page `app/[locale]/(app)/inbox/page.tsx` and `components/inbox/inbox-view.tsx` (tabs, filter, items, polling, offline), header link, per-property list links to the inbox; bundle budget entry

## Phase 4: User Story 2 - Draft actions and take over (P1)

- [X] T014 [P] [US2] API tests: reject (first wins), take over and hand back (security log), detail shows who took over
- [X] T015 [P] [US2] Worker tests: taken over → no message and reason `taken_over` alerting the taker; emergency → card and alerts to contacts and owners/admins; hand back → normal; guest `pending` false
- [X] T016 [P] [US2] End-to-end `e2e/specs/inbox-us2.spec.ts` (quickstart 2)
- [X] T017 [US2] Implement reject and take over routes; taken-over branch in `apps/worker/src/jobs/chat-reply.ts`; guest `pending`
- [X] T018 [US2] Portal conversation view: reason banner, Reject, "I'll reply myself" switch, done/reopen

## Phase 5: User Story 3 - Copilot (P1)

- [X] T019 [P] [US3] Worker tests `apps/worker/test/integration/copilot-draft.test.ts`: grounded draft with checks, inquiry removal with note, benefit recommendation never in the model input, code request fixed text without code, emergency fixed text, caution per category, failing check shown, budget, timing ≤ 15 s
- [X] T020 [P] [US3] API tests: create and read, `409 guide_not_published`, `429 copilot_paused`, cross-tenant
- [X] T021 [P] [US3] End-to-end `e2e/specs/inbox-us3.spec.ts` (quickstart 3)
- [X] T022 [US3] Implement `apps/worker/src/jobs/copilot-draft.ts` on the shared pipeline and the API routes
- [X] T023 [US3] Portal copilot page `app/[locale]/(app)/inbox/copilot/page.tsx` (paste, property, booking status, result with badge, removed note, caution, Copy, kept text on error)
- [X] T024 [US3] Eval cases for the copilot (platform channel)

## Phase 6: User Story 4 - Push (P2)

- [X] T025 [P] [US4] API tests `/me/push`: availability, subscribe (own only), delete, test limit, unavailable without keys
- [X] T026 [P] [US4] Worker tests: push jobs for needs-the-team with the same recipients and quiet hours as email, summary push, gone subscriptions removed, payload without guest text
- [X] T027 [P] [US4] End-to-end `e2e/specs/inbox-us4.spec.ts`: manifest and service worker served; alerts card states
- [X] T028 [US4] Implement `/me/push` routes, `notification.push` job, enqueue from `chat-reply.ts` and `quiet-digest.ts`
- [X] T029 [US4] Portal: `public/sw.js`, `app/manifest.ts`, CSP `worker-src` and `manifest-src`, alerts card in account settings and inbox banner (iPhone steps, blocked, unsupported)

## Phase 7: User Story 5 - Presence (P3)

- [X] T030 [P] [US5] API test: heartbeat, others see the name, expiry, not self, cross-tenant
- [X] T031 [P] [US5] End-to-end `e2e/specs/inbox-us5.spec.ts`
- [X] T032 [US5] Implement presence route and reads; portal heartbeat while typing and the indicator

## Phase 8: User Story 6 - Trust suggestion (P3)

- [X] T033 [P] [US6] API test: 5 unchanged drafts suggest, edited ones don't, topic above draft doesn't, dismissal for 30 days, scope link
- [X] T034 [P] [US6] End-to-end `e2e/specs/inbox-us6.spec.ts`
- [X] T035 [US6] Implement suggestions in the inbox route and the dismiss route; portal suggestion card

## Phase 9: Polish

- [X] T036 [P] Cross-tenant cases for every new route in `apps/api/test/integration/cross-tenant.test.ts`
- [X] T037 [P] Security review tests `security-review-006` (API and worker; AC-SEC-001 to 007)
- [X] T038 [P] Retention: copilot runs after 30 days, expired presence; tests
- [X] T039 [P] Accessibility: axe on the inbox, conversation actions, copilot, and alerts card
- [X] T040 [P] Timing tests: inbox route with 1,000 conversations; copilot job
- [X] T041 Docs: security (SEC-20 push), overview (as built), screens H-20 to H-22, infra secrets for `VAPID_*`, research R12 notes
- [X] T042 Run the quickstart locally and record it in research R12

## Dependencies

- Phase 2 blocks every story. US1 gives the inbox page that US2, US5, and US6 extend; US3 and US4 are
  independent of each other after Phase 2.

## Implementation Strategy

MVP is US1 + US2 (inbox and actions), then US3 (copilot), US4 (push), US5, US6, and the polish phase.
