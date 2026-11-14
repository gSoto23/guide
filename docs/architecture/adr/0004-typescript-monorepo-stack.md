# 0004. TypeScript monorepo technology stack

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder (the architect recommended the stack; the founder accepted it on
  2026-11-13 after comparing industry references)
- **Related:** [Architecture overview](../overview.md) · [Constitution VII](../../../.specify/memory/constitution.md) · [ADR-0005](0005-llm-provider-and-agent-design.md)

## Context and problem statement

Guidesk needs:

- a host portal and a public guest guide (web, mobile-first);
- an API that receives PMS webhooks and streams agent replies;
- background jobs: document extraction, translation, sync, agent runs;
- a multi-tenant relational database.

It is built by one developer with AI coding agents. The founder asked for a recommendation.

## Decision drivers

- **One language end to end**, to reduce context switching and let agents work across the stack.
- **Strong official SDKs** for Anthropic, payments, and the typical PMS REST APIs.
- **Few moving parts and managed services** (constitution, Principle VII).
- **Type-safe contracts** shared between frontend, backend, and adapters.
- **Mainstream frameworks** that AI coding agents know well.

## Considered options

1. **TypeScript full-stack monorepo:** Next.js, NestJS, PostgreSQL.
2. **Python backend + React frontend:** FastAPI, Next.js.
3. **.NET backend + React frontend:** ASP.NET Core, Next.js.
4. **Next.js only:** route handlers as the API, with no separate backend.

## Decision outcome

Chosen option: **(1) TypeScript full-stack monorepo**.

- It is the only option with one language across UI, API, workers, contracts, and agent code.
- First-class SDKs exist for Anthropic (`@anthropic-ai/sdk`) and the payment providers.
- Zod schemas are shared end to end.

A separate API and worker were chosen over option 4. Long-running agent calls, webhooks,
retries, and queues are a poor fit for serverless route-handler time limits.

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 LTS | — |
| Language | TypeScript (strict) | — |
| Monorepo | pnpm workspaces + Turborepo | Caching and task graph |
| Host portal | Next.js (App Router) + React + Tailwind CSS + shadcn/ui | — |
| Guest guide | Next.js (SSR/ISR, CDN-cached) as a PWA | Separate app from the portal, for security and performance isolation |
| API | NestJS (Fastify adapter) | Modules map to bounded contexts; dependency injection fits ports and adapters |
| Background jobs | pg-boss (Postgres-backed queue) | No Redis in the MVP; revisit with BullMQ when throughput requires it |
| Database | PostgreSQL 16+ (managed) with row-level security | pgvector is available when retrieval is needed (ADR-0005) |
| ORM and migrations | Drizzle ORM + drizzle-kit | SQL-first, typed, RLS-friendly |
| Validation and contracts | Zod + OpenAPI generation | Shared in `packages/contracts` |
| Object storage | S3-compatible (e.g. Cloudflare R2 or AWS S3) | Uploads and media |
| Host authentication | Decided in spec 001's plan. Candidates: Better Auth (self-hosted, organizations) or Clerk (managed) | Must support workspaces, roles, Google sign-in |
| Email | Transactional provider (e.g. Resend or Postmark) | Host notifications only |
| Testing | Vitest (unit, integration), Playwright (E2E), contract tests with recorded fixtures, agent eval harness | — |
| Quality gates | ESLint, Prettier, `tsc --noEmit`, dependency audit, Conventional Commits | Enforced in CI (GitHub Actions) |
| Observability | OpenTelemetry + an error tracker (e.g. Sentry) + structured JSON logs | — |
| Hosting (initial) | Web apps on Vercel; API and worker on a container PaaS (e.g. Railway or Fly.io); managed Postgres (e.g. Neon) | Chosen for speed and low cost. Revisit (e.g. AWS) when scale, compliance, or cost justifies it. Final pick in the foundations spec. |

### Consequences

- **Good:**
  - One language and one toolchain.
  - Contracts shared everywhere.
  - Excellent agent familiarity.
  - Managed infrastructure keeps operations small.
  - Postgres covers relational data, the job queue, and vectors.
- **Bad:**
  - NestJS adds some boilerplate.
  - Several SaaS vendors (Vercel, PaaS, database) to manage.
  - The Postgres-based queue has lower throughput than Redis. Acceptable for the year-1 target
    (NFR-09).

### Confirmation

- The foundations spec scaffolds this layout (see [overview](../overview.md#8-repository-layout-target)).
- CI runs lint, type-check, tests, and evals.
- Any new runtime or datastore needs a new ADR.

## Industry references

Before accepting, the founder asked whether TypeScript matches global industry practice. The
evidence (2026-11-13):

| Company | Backend | Frontend | Takeaway |
|---|---|---|---|
| Hostaway (direct competitor) | Node.js + TypeScript, with legacy PHP | React + TypeScript | New services and AI work are built in Node/TS ([job posting](https://careers.hostaway.com/o/staff-fullstack-engineer-100-remote-europe), [AI role](https://www.workingnomads.com/jobs/senior-software-engineer-ai-hostaway)) |
| Guesty (direct competitor) | Node.js + PostgreSQL | React | One JavaScript ecosystem across a 200+ engineer R&D team ([job posting](https://guesty.com/careers-open-positions/co/israel/46.15C/full-stack-developer/all)) |
| Airbnb, Stripe, Shopify | Ruby or Rails origins; Java, Kotlin, or Go at scale | React + TypeScript | Backends reflect founding era (2006–2010) and massive scale. All three standardized on TypeScript for the frontend. (Public engineering blogs; not re-verified here.) |
| Notion, Linear, Vercel, Cal.com | TypeScript (Node.js) | React + TypeScript | Post-2015 SaaS products often use one language end to end. (Public information; not re-verified here.) |
| AI labs (model training) | Python | React + TypeScript | Python dominates where companies train their own models. Guidesk consumes Claude through an API. |

**Industry signal.** GitHub's Octoverse 2025 reports that TypeScript became the most used
language on GitHub by monthly contributors in August 2025, overtaking Python and JavaScript.
GitHub attributes the rise partly to AI-assisted development
([GitHub blog](https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/)).
This measures activity on GitHub, not code running in production.

**Conclusion:**

- React + TypeScript is the near-universal frontend standard, so Guidesk's frontend would be
  TypeScript whatever the backend language.
- For a 2026 AI-via-API SaaS built by one developer with AI agents, a TypeScript backend is
  mainstream and matches the direct competitors.
- If a specialized workload later needs Python or Go, for example data or ML pipelines, it can be
  added as a separate service behind a port without reworking the core.

## Pros and cons of the alternatives

- **Python + React:** strong AI and data ecosystem, but two languages, duplicated contracts, and
  more context switching for a solo developer.
- **.NET + React:** robust and typed, but two languages and fewer examples for PMS and
  agent-related integrations.
- **Next.js only:** the fewest apps, but serverless time limits and weak background processing
  for webhooks and agent runs. The guest guide and the portal would share a deployment and its
  risk.
