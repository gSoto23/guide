# Implementation Plan: In-Guide AI Chat

**Branch**: `005-guide-chat` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-guide-chat/spec.md`

## Summary

Guests chat with the property's virtual assistant from every guide page. Each message is classified
first; mandatory escalations get a holding reply (emergencies with the emergency card first) and an
email to the team; other questions get an answer built only from the published guide, sent at once
with autonomy `auto` after output checks, or prepared as a draft for a member with `draft` (the
default). Members send, edit, or write replies from a conversation page. Every output has a trace;
per-device limits and daily AI budgets bound abuse and cost.

Technical approach: the API stores the guest message and enqueues `chat.reply`; the worker runs two
structured Claude calls (classification without the guide, the answer with the full published guide in
a cached prefix, ADR-0005), a pure policy decision, and deterministic output checks; the chat polls for
messages; the chat UI loads on demand in the guest app ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing only: NestJS/Fastify, Drizzle, pg-boss, `@anthropic-ai/sdk` (already
used by spec 003, with `betaZodOutputFormat` structured outputs and the refusal fallback), Zod, React
Email, the guest app (server-only React + esbuild), Next.js portal. No new dependency.

**Storage**: PostgreSQL 16: 5 new tenant tables with RLS forced (`conversation`, `chat_message`,
`agent_draft`, `agent_trace`, `chat_usage_daily`), one member view, columns on `workspace` and
`property` ([data model](data-model.md)).

**Testing**: Vitest (unit, contract on recorded Anthropic fixtures, integration with Testcontainers),
Playwright on the phone viewport with the fake model, axe, the `evals/agent` suite (fake locally, real
model in CI when the secret exists).

**Target Platform**: guest app (Lambda + CloudFront), API and worker (ECS Fargate), portal.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: typing indicator ≤ 1 s; reply or holding reply ≤ 10 s at p90 (fake model plus
simulated latency in tests; staging gate with the real model); emergency card ≤ 2 s; chat bundle ≤ 30 KB
gzip; escalation email ≤ 60 s at p95; average cost per reply ≤ $0.10.

**Constraints**: no locked value in any model input, trace, log, or reply; the model sees only published
content and the guest's messages; no guest contact data; replies shown whole after checks.

**Scale/Scope**: 50,000 conversations per month at the year-1 target (NFR-09), about 5 messages each;
2 portal screens plus settings cards; about 10 new endpoints.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`29c6b3d`) with 5 clarifications under the standing authorization; checklist 16/16; no markers | [x] |
| II. Platform Compliance | PC-01/02 reminders in every holding and pause message; PC-03 no contact data; PC-06 and PC-14 checks on assistant and member replies; PC-07 disclosure kept; no offers (tests) | [x] |
| III. Guest Trust and Human-in-the-Loop | Answers only from the published guide; mandatory escalations decided before any answer and never automated; `draft` default; every output traced with knowledge, checks, model, and cost | [x] |
| IV. Channel-Agnostic Core | Policy, knowledge, and checks in the domain; the model behind `LlmPort` with a fake and contract tests on recorded fixtures | [x] |
| V. Test-First and Eval-Driven | Tests first per story; new `evals/agent` suite gates prompt, schema, model, and effort changes (FR-034) | [x] |
| VI. Security and Privacy | SEC-06 (no reveal path, labels only), SEC-07 (device limits, budgets), SEC-08 (server-injected scope, no tools, data framing, allowlisted links), SEC-11, SEC-14 (RLS on 5 tables, cross-tenant tests), SEC-16, SEC-20 (retention) | [x] |
| VII. Simplicity | No new runtime, vendor, datastore, or dependency; knowledge renderer in the domain instead of a new package | [x] |
| VIII. Observability | `chat.reply` spans with decision and outcome codes; traces with tokens and cost; daily cost check with an error event above $0.10 | [x] |
| IX. International | Replies in the guest's language; intro, holding, and member texts in Spanish and English | [x] |
| Performance | Budget below; size check for the chat bundle, timing test for the job | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Chat open | Code and styles downloaded | ≤ 30 KB gzip | Guest app size check |
| Send to typing indicator | Time | ≤ 1 s | e2e |
| Send to reply or holding reply | Time | ≤ 10 s at p90 | Job timing test (fake model + latency); staging gate |
| Emergency card | Time | ≤ 2 s | Job timing test (classification only) |
| Guest chat routes | API latency | p95 ≤ 300 ms | Integration timing test |
| Escalation email | Enqueued | ≤ 60 s at p95 | Integration test |
| Cost per reply | 7-day average | ≤ $0.10 | Daily cost check |
| Conversation page (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |

## Project Structure

```text
packages/domain/src/agent/          # policy, knowledge renderer, output checks, holding texts keys,
                                    # suggestions
packages/integrations/src/llm/agent/  # prompts and schemas; Anthropic and fake adapters extended
packages/contracts/src/chat.ts      # guest chat, conversations, assistant settings
packages/db/src/schema/chat.ts      # + migrations 0023, 0024
packages/emails/src/chat/           # needs-host and limit emails
apps/api/src/chat/                  # guest chat routes
apps/api/src/conversations/         # member routes, assistant settings
apps/worker/src/jobs/chat-reply.ts  # the pipeline; agent-cost-check.ts; retention extended
apps/guide/src/client/chat.ts       # chat UI (lazy); Ask entry in the layout
apps/portal/app/[locale]/(app)/properties/[propertyId]/conversations/  # list and page
apps/portal/components/conversations/, components/assistant/
evals/agent/                        # golden conversations
e2e/specs/chat-us1 … chat-us6
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A conversation page in this feature (part of spec 006's inbox) | With `draft` as the default, nothing reaches guests without a member acting | Waiting for spec 006: the chat would only ever say "your host will reply" |
| Two model calls per answered message | Escalations must not depend on the long, guide-carrying call | One combined call: emergencies would wait for the largest call |
