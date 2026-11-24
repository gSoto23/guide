# Performance Architecture

> **Status:** Draft v0.1 · **Owner:** Founder · **Last updated:** 2026-11-24 ·
> **Related:** [PRD §7 NFRs](../product/prd.md#7-non-functional-requirements) · [Architecture overview](overview.md) · [Security](security.md) · [ADR-0004 stack](adr/0004-typescript-monorepo-stack.md) · [ADR-0005 agent](adr/0005-llm-provider-and-agent-design.md) · [ADR-0006 PWAs](adr/0006-web-first-pwa-no-native-apps.md)

Guests open the guide on mid-range phones over mobile networks across the Americas, often while
standing at the door. Hosts work from their phones. The agent must feel like a chat, not a form.
This document sets the performance targets, the design choices that meet them, and how they are
verified.

## 1. Targets

| Area | Metric | Target |
|---|---|---|
| Guest guide | Largest Contentful Paint (LCP) | ≤ 2.5 s at p75, mid-range mobile on 4G |
| Guest guide | Interaction to Next Paint (INP) | ≤ 200 ms at p75 |
| Guest guide | Cumulative Layout Shift (CLS) | ≤ 0.1 at p75 |
| Guest guide | Time to First Byte (TTFB) | ≤ 800 ms at p75 (served from the CDN) |
| Guest guide | Usability floor on slow 3G | Arrival, Wi-Fi network name, and house rules readable within 5 s |
| Guest guide | Initial JavaScript | ≤ 100 KB gzip per route (spec 004 sets 15 KB for the guide script); the chat loads on demand |
| Guest guide | Initial page weight | ≤ 500 KB, excluding lazy-loaded media |
| Host portal | LCP and INP | ≤ 2.5 s and ≤ 200 ms at p75 on mobile |
| Host portal | Initial JavaScript | ≤ 175 KB gzip per route (`bundle:check`); raised from 150 KB on 2026-11-23 because React and Next.js alone take about 133 KB |
| API (excluding LLM calls) | Latency | p95 ≤ 300 ms, p99 ≤ 1 s |
| Agent | First token / full reply | ≤ 3 s / ≤ 10 s at p90 (NFR-01) |
| Agent | Holding reply on escalation or draft | ≤ 2 s at p90 |
| Notifications | Escalation alert sent after the decision | ≤ 60 s at p95 |
| Imports | CSV validation | 500 rows in ≤ 30 s |
| Imports | PMS import | 100 properties in ≤ 10 min, subject to provider rate limits |
| Availability | Guide and chat | 99.5% monthly (NFR-02) |

The constitution's floor is that the guide stays usable on slow 3G; the targets above are
measured on 4G.

## 2. Guest guide delivery

- **Static first.** Published guide pages are rendered per language and cached by the CDN for 60
  seconds (`s-maxage=60`), and served stale for a day if the origin fails (`stale-if-error`), so
  most guide traffic never reaches the API or the database and the guide stays available when the
  API is down (NFR-02). No `stale-while-revalidate`: browsers apply it too and would show an
  unpublished guide once more (spec 004 research R9).
- **Dynamic only where needed.** Three parts are dynamic:
  - the chat;
  - restricted sections, which are never cached ([SEC-04](security.md#4-controls));
  - stay-specific content.
- **Lean JavaScript.** Pages are rendered on the server with React and never hydrated
  ([ADR-0010](adr/0010-guest-guide-server-rendered-without-client-framework.md)); one small script
  (budget 15 KB gzip, 2.7 KB at spec 004) adds Show code, the confirmation form, and offline
  reading. The chat widget loads when the guest taps it, not in the initial bundle.
- **Media:**
  - Images are processed on upload into AVIF and WebP variants at several sizes.
  - Images below the fold are lazy-loaded.
  - Explicit dimensions prevent layout shift.
  - Videos show a poster and stream only on tap.
- **Fonts:** a system font stack, or one self-hosted, subset variable font with
  `font-display: swap`.
- **Offline (PWA).** The service worker saves guide pages network-first and images cache-first as
  the guest views them, and marks saved copies with their time. Restricted values and every
  personal guest response are never stored (OQ-28, decided in spec 004: no offline codes).
- **Third-party scripts:** none on the guide besides essentials. Analytics are first-party and
  lightweight. Affiliate offers are links, not embedded widgets.

## 3. Agent latency

- **Streaming.** Replies stream to the guide over server-sent events.
- **Prompt cache pre-warm.** When the guest focuses the chat input, the API sends a
  `max_tokens: 0` request with the same model, effort, and prefix as real traffic. The property
  context is then cached before the first question arrives.
  - At most once per conversation per 5 minutes.
  - Skipped when the cache is likely warm.
- **Speculative generation (to validate).** Generate the reply in parallel with
  classification.
  - The reply is held until the policy engine decides; the guest never sees it earlier.
  - On `draft` or `escalate`, the reply is discarded or saved as a host draft.
  - Adopt it only if evals show no regression and the extra token cost is acceptable.
- **Effort:** `low` for chat (ADR-0005).
- **Timeouts and fallbacks:**
  - Classification times out at 5 s and generation at 20 s. On timeout, the guest gets a holding
    reply and the conversation escalates.
  - The SDK retries 429 and 5xx errors with backoff.
  - A circuit breaker switches to degraded mode during provider incidents.
- **OTA channels (Phase 2):** replies go through the worker queue, never the request path.

## 4. Backend and database

- **Single region.** API, worker, and PostgreSQL live in the same US East region, close to both
  the US and Latin America. The CDN covers the distance to guests. Consider a second region only
  if real-user data shows API latency problems.
- **Connection pooling.** The provider's pooler (or PgBouncer) serves the API, because serverless
  functions open many connections. pg-boss uses its own small pool.
- **Indexes.** Composite indexes lead with `workspace_id` (and `property_id` where relevant).
  Every plan reviews the query plans of its hot paths.
- **RLS that stays fast.** Policies compare indexed columns with the session's workspace setting,
  evaluated once per statement, not once per row. No per-row function calls in policies.
- **Growth tables.** `MESSAGE`, `AGENT_RUN`, the audit log, and analytics events are partitioned
  by time or archived by retention jobs.
- **Queries.** No N+1 queries. The inbox uses keyset pagination.
- **No Redis in the MVP.** The CDN, PostgreSQL, and small in-process caches are enough. Rate
  limiting runs at the edge or in PostgreSQL. A cache datastore needs an ADR backed by metrics
  (constitution, Principle VII).
- **Background work.** Imports, translations, document extraction, and notifications run in the
  worker with concurrency limits and per-provider rate limits (for example, Hostaway allows 30
  requests per minute per account).

## 5. Capacity and load testing

- **Design target (NFR-09):** 5,000 properties and 50,000 guest conversations per month.
- **Back-of-the-envelope load:**
  - At about 15 messages per conversation, that is about 750,000 messages per month, or 0.3 per
    second on average.
  - Check-in afternoons (15:00–18:00 local time) concentrate traffic. With a 10× peak factor,
    the peak is about 3 messages per second.
  - That is small for the backend. **The binding constraints are the LLM provider's rate limits
    and cost**, so check the Anthropic rate-limit tier before the pilot.
- **Load tests:**
  - k6 scripts cover the guide, chat, inbox, and imports, with the LLM mocked at a realistic
    latency distribution.
  - They run before the public launch and before each phase exit. Results are recorded in the
    repository.

## 6. Monitoring

- **Real-user monitoring:** Core Web Vitals by country, device class, and connection type,
  collected with the `web-vitals` library.
- **Lighthouse CI** runs on every pull request and every push to `main` with the budgets in §1
  (`lighthouserc.json` for the portal, `lighthouserc.guide.json` for the guide). It loads each
  page three times with Lighthouse's simulated mobile throttling and checks each budget against
  the median of the three runs, so one noisy run on a shared CI machine does not decide the
  result. A regression fails the pull request.
- **A bundle-size check** runs in CI.
- **SLO dashboards and alerts** (error-budget burn) cover:
  - guide availability;
  - agent latency;
  - API latency;
  - notification delay.
- **Agent traces** record latency per stage: classify, decide, generate, and checks.

## 7. Resilience and degraded modes

| Failure | Behavior |
|---|---|
| LLM provider down or slow | The guide works. The chat sends a holding reply and escalates. The circuit breaker limits retries. |
| API or database down | The published guide is still served from the CDN. The chat shows that the host will reply; restricted sections show a retry message. |
| PMS API down | Imports retry with backoff. Hosts see the sync status. |
| Email provider down | Push notifications continue. Emails are queued and retried. |

A second path to Claude through another cloud (Amazon Bedrock or Google Cloud) will be evaluated
in Phase 2. Adopting it requires an ADR.

## 8. Performance in the workflow

- Every plan with UI or a hot path declares its performance budget, based on §1, and its
  acceptance tests check it (constitution, Additional Constraints).
- Lighthouse CI, the bundle-size check, and the load tests are the gates.
- Keep the largest element above the fold as text that the server renders, so it is in the first
  paint. Lighthouse's simulated LCP then counts only the HTML and the CSS. When the largest element
  is an image, or is text that appears only after the account loads, the simulation also counts
  every script that loaded before it: about 1.4 s more on the portal. For this reason the
  signed-in shell draws the logo inline instead of as an `<img>`, and the blank property form
  renders its heading on the server.
