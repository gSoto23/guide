# Implementation Plan: Host Inbox and Reply Copilot

**Branch**: `006-host-inbox` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-host-inbox/spec.md`

## Summary

One inbox for every guide chat conversation of the workspace (Needs you, All, Done; emergencies first;
filter by property); draft rejection, take over and hand back, done and reopen; a "replying" indicator for
teams; a paste-to-reply copilot that drafts host-voice replies for platform chats from the published
guide with the same checks; web push for the alerts specs 005 and 007 already email; and a trust
suggestion after five unchanged drafts on a topic.

Technical approach: new columns on `conversation` and four small tables; inbox and conversation actions
in the API; the reply job learns "taken over"; the copilot reuses the assistant pipeline in the worker
with a platform channel, a knowledge filter for benefit recommendations, and deterministic contact
removal for inquiries; push goes through a new `PushPort` (`web-push`) from a `notification.push` job and
a portal service worker; presence and suggestions are queries ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack plus **`web-push` ^4.0.0** in `packages/integrations` (MPL-2.0,
published 2026-11-06, dependencies `jws`, `asn1.js`, `http_ece`, `https-proxy-agent`, no install
scripts; within the 3-day minimum release age).

**Storage**: PostgreSQL 16: `conversation` columns, `copilot_run`, `push_subscription`,
`conversation_presence`, `assistant_suggestion_dismissal` (RLS forced), `agent_trace.copilot_run_id`
([data model](data-model.md)).

**Testing**: Vitest (unit, contract with a local HTTP push endpoint, integration with Testcontainers),
Playwright on the phone viewport, axe, the `evals/agent` suite.

**Target Platform**: API and worker (ECS Fargate), portal (installable PWA with a service worker).

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: inbox p95 ≤ 300 ms at the origin with 1,000 conversations (portal < 1 s);
copilot ≤ 15 s at p90; push enqueued ≤ 60 s after the conversation needs the team; inbox and copilot
routes ≤ 150 KB gzip.

**Constraints**: no guest text in push payloads; the copilot never sees locked values or benefit
recommendations; emergencies are never held by take over or quiet hours.

**Scale/Scope**: 3 portal screens (inbox, copilot, notifications card) and conversation page changes;
about 14 endpoints; 2 worker jobs.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`3dea6c6`) with 6 clarifications under the standing authorization; checklist complete | [x] |
| II. Platform Compliance | PC-05 (inquiry drafts lose links and contact details, deterministic), PC-06 and PC-14 (same checks), PC-10 (benefit recommendations excluded from copilot knowledge), PC-03 (labels by property and stay) | [x] |
| III. Guest Trust and Human-in-the-Loop | Take over keeps the human in control and emergencies protected; rejections and actions logged; copilot drafts never sent by Guidesk | [x] |
| IV. Channel-Agnostic Core | The copilot is the same pipeline with a channel parameter; push behind `PushPort` with a fake | [x] |
| V. Test-First and Eval-Driven | Tests first per story; new copilot eval cases for the prompt change | [x] |
| VI. Security and Privacy | SEC-06, SEC-07, SEC-08, SEC-14 (RLS on 4 new tables, cross-tenant tests), SEC-16, SEC-20 (minimal push payloads, keys as secrets) | [x] |
| VII. Simplicity | One dependency (`web-push`) instead of hand-written RFC 8291 crypto; polling instead of a new realtime channel | [x] |
| VIII. Observability | Spans for `copilot.draft` and `notification.push` with outcome codes; push failures counted | [x] |
| IX. International | All texts in Spanish and English; push and copilot texts in the member's language; drafts in the guest's | [x] |
| Performance | Budget below; timing tests for the inbox and copilot | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Inbox route | API latency, 1,000 conversations | p95 ≤ 300 ms | Integration timing test |
| Copilot draft | Result | ≤ 15 s at p90 | Job timing test (fake model + latency) |
| Push | Enqueued after needs-the-team | ≤ 60 s | Worker integration test |
| Inbox, copilot, conversation (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |

## Project Structure

```text
packages/domain/src/agent/          # contact-removal.ts, copilot texts, inbox ordering helpers
packages/integrations/src/push/     # PushPort, web-push adapter, fake; llm agent prompts (channel)
packages/contracts/src/inbox.ts     # inbox, copilot, push shapes
packages/db/src/schema/inbox.ts     # + migrations 0028, 0029
packages/emails/src/chat/           # taken_over reason; push texts
apps/api/src/inbox/                 # inbox, conversation actions, presence, suggestions, copilot routes
apps/api/src/push/                  # /me/push routes
apps/worker/src/jobs/               # chat-reply (taken over), copilot-draft.ts, notification-push.ts,
                                    # quiet-digest (push), retention
apps/portal/app/[locale]/(app)/inbox/, inbox/copilot/
apps/portal/components/inbox/, components/conversations/ (actions), components/notifications/
apps/portal/public/sw.js, app/manifest.ts, proxy.ts (CSP)
evals/agent/                        # copilot cases
e2e/specs/inbox-us1 … inbox-us6
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| `web-push` dependency | FR-015 to FR-018: standard push with VAPID and payload encryption | Hand-written RFC 8291 encryption: security-sensitive code for no gain |
| A portal service worker and manifest | Push needs a service worker; iPhones need a home-screen app (ADR-0006) | Email only: escalations are time-critical (FR-06.4) |
| Classification while taken over | Emergencies must still show the card (AC-SEC-007) | Pausing everything: an emergency would wait for the host |
