# Implementation Plan: Agent Settings

**Branch**: `007-agent-settings` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-agent-settings/spec.md`

## Summary

Hosts tune the spec 005 assistant: autonomy per topic (`draft`, `auto`, `full_auto`, with the
mandatory escalations locked), tone, quiet hours, escalation contacts, and custom instructions, as
workspace defaults that a property follows or replaces per group. A host can test a question on a
property before guests see the change, and every trace records the settings that applied.

Technical approach: one `assistant_settings` row per scope with contacts and immutable instruction
versions beside it; a domain resolver that the API and the worker share; the answer call gains the kind
of answer, the tone, and the host's preferences in its cached prefix while classification stays
untouched; the post-answer decision becomes a per-level matrix; quiet hours hold non-urgent emails in a
table that a per-minute cron job turns into summaries; tests reuse the reply pipeline in dry-run mode
([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing only: NestJS/Fastify, Drizzle, pg-boss, `@anthropic-ai/sdk`, Zod,
React Email, Next.js portal. No new dependency.

**Storage**: PostgreSQL 16: 5 new tables with RLS forced (`assistant_settings`, `assistant_contact`,
`assistant_instruction_version`, `assistant_test`, `chat_held_notice`), `agent_trace` columns, two
columns dropped ([data model](data-model.md)).

**Testing**: Vitest (unit, contract on recorded fixtures, integration with Testcontainers), Playwright on
the phone viewport with the fake model, axe, the `evals/agent` suite.

**Target Platform**: API and worker (ECS Fargate), portal; no guest app change (texts come from the
worker).

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: settings routes p95 ≤ 300 ms; a test result ≤ 15 s at p90; summaries ≤ 5 minutes
after quiet hours end; no added per-message model cost (tone and instructions live in the cached
prefix); the reply budget of 005 unchanged (≤ 10 s at p90).

**Constraints**: classification never sees tone or instructions; instructions never carry codes,
links, or contact data; emergencies are never held; a property's own values survive following the
workspace.

**Scale/Scope**: settings read once per guest message (indexed by scope); 2 portal screens; 6 endpoints;
2 worker jobs.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`a3515f3`) with 6 clarifications under the standing authorization; checklist 16/16; no markers | [x] |
| II. Platform Compliance | PC-06 and PC-14: instructions checked for off-platform phrases on save, every automatic message still checked; PC-01/02 reminder kept in every holding reply including quiet hours; no offers from instructions (§6.3) | [x] |
| III. Guest Trust and Human-in-the-Loop | `draft` stays the default; mandatory escalations decided before and without settings; `full_auto` limited to one clarifying question and checked general answers; traces record the settings | [x] |
| IV. Channel-Agnostic Core | Resolver, decision matrix, quiet window, instruction checks, and fixed texts in the domain; the model behind `LlmPort` with the fake extended | [x] |
| V. Test-First and Eval-Driven | Tests first per story; the agent eval suite gains tone, clarify, general, and adversarial-instruction cases (prompt and schema change) | [x] |
| VI. Security and Privacy | SEC-06 (instructions refused when they hold a code), SEC-08 (preferences framed below policy), SEC-14 (RLS on 5 tables, cross-tenant tests), SEC-16 (security log, trace versions), SEC-07 (test limits and budget) | [x] |
| VII. Simplicity | No new runtime, vendor, or dependency; one table per concept; tests reuse the reply pipeline | [x] |
| VIII. Observability | `assistant.test` and `chat.quiet-digest` spans; held and sent counts in logs; traces with settings | [x] |
| IX. International | Formal and casual texts in Spanish and English; screens in both languages | [x] |
| Performance | Budget below; integration timing test for routes, job timing test for tests | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Settings routes | API latency | p95 ≤ 300 ms | Integration timing test |
| Test the assistant | Result | ≤ 15 s at p90 | Job timing test (fake model + latency) |
| Quiet hours summary | After the window ends | ≤ 5 min | Worker integration test |
| Emergency email in quiet hours | Enqueued | ≤ 60 s | Worker integration test |
| Settings screens (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |
| Cost per reply | 7-day average | ≤ $0.10 | Daily cost check (005) |

## Project Structure

```text
packages/domain/src/agent/          # settings.ts (topics, levels, resolver, defaults), quiet-hours.ts,
                                    # instructions.ts (issues), policy.ts (matrix), checks.ts (price,
                                    # clarify), replies.ts (tone)
packages/integrations/src/llm/agent/  # schema kind, prompts (preferences, tone), fake extended
packages/contracts/src/assistant.ts # settings, inputs, tests; chat.ts MemberTrace extended
packages/db/src/schema/assistant.ts # + migrations 0026, 0027
packages/emails/src/chat/           # quiet summary
apps/api/src/assistant/             # settings and test routes (replaces 005's settings service)
apps/worker/src/jobs/chat-reply.ts  # settings, recipients, held notices; assistant-test.ts;
                                    # quiet-digest.ts; retention extended
apps/portal/app/[locale]/(app)/settings/assistant/, properties/[propertyId]/assistant/
apps/portal/components/assistant/   # settings form, test panel, summary card
evals/agent/                        # new cases
e2e/specs/settings-us1 … settings-us6
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Immutable instruction versions | FR-021: "Why this reply" must show what applied, and traces must not change | Copying the text into every trace: up to 2,000 characters per trace |
| A held-notice table and a per-minute job | FR-008: summaries when quiet hours end, robust to setting changes | Delayed per-window jobs: stale when the window changes |
| Dry-run mode of the reply pipeline | FR-018: a test must predict the guest's outcome | A separate test pipeline: two code paths that drift |
