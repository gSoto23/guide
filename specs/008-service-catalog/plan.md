# Implementation Plan: Service Catalog and Host Add-on Requests

**Branch**: `008-service-catalog` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-service-catalog/spec.md`

## Summary

Hosts define extras per property (price, lead time, rules, pre-approval) and copy them across
properties; guests on a stay link request them from the guide, see each status, and cancel while
waiting; members get alerts through the escalation contacts, email, and push, and confirm, decline, or
cancel from a Requests screen; unanswered requests expire. No payment in Guidesk yet (spec 013). The
guide chat may point to Extras; the copilot never offers them.

Technical approach: two tenant tables and a daily count table; a pure rules function in the domain;
guest routes that take the stay from spec 004's session; member routes for the catalog and requests; a
per-minute worker job for alerts (quiet hours aware) and expiry; two server-rendered guest pages with
a small script for requests; portal screens for the catalog and requests ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages.

**Storage**: PostgreSQL 16: `extra`, `service_request`, `service_request_daily` (RLS forced)
([data model](data-model.md)).

**Testing**: Vitest (domain rules, integration with Testcontainers), Playwright on the phone viewport,
axe, the `evals/agent` suite.

**Target Platform**: API and worker (ECS Fargate), guest app (Lambda behind CloudFront), portal.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: guest extras route p95 ≤ 150 ms; request creation p95 ≤ 300 ms; Requests route
p95 ≤ 300 ms with 1,000 requests; alerts queued ≤ 60 s after a request outside quiet hours; Extras
pages LCP ≤ 2.5 s; portal routes ≤ 150 KB gzip; guide script within 15 KB.

**Constraints**: the stay comes only from the session; stored price and name come only from the
catalog; no guest text in alerts, logs, or counts; no payment links.

**Scale/Scope**: 2 guest pages, 2 portal screens plus a card, about 12 endpoints, 1 worker job.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`ecf987d`) with 9 clarifications under the standing authorization; checklist complete | [x] |
| II. Platform Compliance | PC-03 (no contact data), PC-06 (no reservation changes or mandatory fees, no payment links), PC-07 ("Offered by your host"), PC-08 (opt-in), PC-10 (copilot never) | [x] |
| III. Guest Trust and Human-in-the-Loop | The host decides each request unless they pre-approve; answers logged; expiry so nobody waits | [x] |
| IV. Channel-Agnostic Core | Alerts reuse the email and push ports; rules are pure domain code | [x] |
| V. Test-First and Eval-Driven | Tests first per story; eval cases for the Extras knowledge | [x] |
| VI. Security and Privacy | SEC-01/02 (stay session), SEC-07 (limits), SEC-14 (RLS on 3 tables, cross-tenant tests), SEC-16 (events), SEC-20 (notes never in alerts or logs) | [x] |
| VII. Simplicity | No new dependency or datastore; one per-minute job for alerts and expiry | [x] |
| VIII. Observability | Span for `service-request.tick` with counts; request outcomes counted | [x] |
| IX. International | Spanish and English names, texts, and alerts; currencies as set; dates in the property's time zone | [x] |
| Performance | Budget below; timing tests | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Extras pages (guest) | LCP at p75, mid-range phone on 4G | ≤ 2.5 s | Lighthouse CI (guide config) |
| Guest app JavaScript | Size check | ≤ 15 KB gzip | `size:check` |
| Guest extras and request routes | API latency | p95 ≤ 150 ms / ≤ 300 ms | Integration timing test |
| Requests route | API latency, 1,000 requests | p95 ≤ 300 ms | Integration timing test |
| Catalog and Requests (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |

## Project Structure

```text
packages/domain/src/extras/            # rules, expiry, suggestions keys
packages/contracts/src/extras.ts       # guest and member shapes
packages/db/src/schema/extras.ts       # + migrations 0032, 0033
packages/emails/src/extras/            # new-request email; push text
packages/integrations/src/llm/agent/   # answer rule 14
apps/api/src/extras/                   # catalog and requests routes
apps/api/src/guest/                    # guest extras routes, guide response `extras.visible`
apps/worker/src/jobs/                  # service-request-tick.ts, notification-push (kind), retention,
                                       # assistant pipeline (extras knowledge)
apps/guide/src/                        # extras pages, script, home tile
apps/portal/app/[locale]/(app)/properties/[propertyId]/extras/, requests/, components/extras/
evals/agent/                           # Extras cases
e2e/specs/extras-us1 … extras-us3
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A per-minute job for alerts and expiry | Quiet hours delay alerts; expiry needs a clock | Alerting inside the guest request would ignore quiet hours and couldn't retry |
| Name and price copied into each request | Requests must keep what the guest saw | Reading the live extra would change past requests when the host edits |
