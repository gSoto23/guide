# Guidesk

**The property guide and AI concierge for short-term rentals.** Guidesk gives every property a
complete digital guidebook. It answers guests inside the rental platforms' chats and in the
guide, and turns those conversations into extra revenue through optional services.

> **Status:** Building the MVP. Spec 001 (workspaces, accounts, roles, and invitations) is implemented and tested locally; it hasn't been deployed yet. See the [roadmap](docs/product/roadmap.md) and the [spec 001 tasks](specs/001-workspace-accounts/tasks.md).

## What Guidesk does

- **Guide:** a mobile-first digital guidebook per property, opened from a link or QR code with
  no app or account. Drafted automatically from a PMS import or the host's own listing text and
  screenshots, then completed with templates, an AI interview, and uploaded documents. Managers
  share content across all their properties.
- **Agent:** an AI concierge that answers from the guide.
  - Where: in Airbnb, Booking.com, and Vrbo chats (through PMS integrations) and in the guide.
  - Control: autonomy per topic, chosen by the host, with mandatory human escalation for
    sensitive cases.
- **Marketplace:** optional, disclosed services: host add-ons, tours and experiences,
  reservations, and later insurance.

Built for individual hosts and professional managers in Latin America and the United States,
in Spanish and English.

## Documentation

Start with the [documentation index](docs/README.md).

| | |
|---|---|
| Product | [Vision](docs/product/vision.md) · [Business model](docs/product/business-model.md) · [Personas](docs/product/personas.md) · [PRD](docs/product/prd.md) · [Roadmap](docs/product/roadmap.md) |
| Research | [Integrations](docs/research/integrations.md) · [Competitors](docs/research/competitive-landscape.md) · [Monetization partners](docs/research/monetization-partners.md) · [Platform policies](docs/research/platform-policies.md) |
| Architecture | [Overview](docs/architecture/overview.md) · [ADRs](docs/architecture/adr/README.md) · [Security](docs/architecture/security.md) · [Performance](docs/architecture/performance.md) |
| Design | [UX index](docs/ux/README.md) · [Principles and IA](docs/ux/principles-and-ia.md) · [User flows](docs/ux/user-flows.md) · [Screens](docs/ux/screens.md) · [Design system](docs/ux/design-system.md) · [Wireframes](docs/ux/wireframes.html) |
| Presentation | [Project overview](docs/presentation/project-overview.md) · [Budget](docs/presentation/budget.md) |
| Process | [Constitution](.specify/memory/constitution.md) · [Open questions](docs/open-questions.md) · [Pilot readiness](docs/pilot-readiness.md) · [AWS operations](docs/operations/aws.md) · [Glossary](docs/glossary.md) |

## Key decisions

| Decision | Choice | Record |
|---|---|---|
| Development method | Spec-Driven Development with GitHub Spec Kit | [ADR-0002](docs/architecture/adr/0002-spec-driven-development-with-spec-kit.md) |
| Guest channels | Platform chats (Airbnb, Booking.com, Vrbo) and the in-guide chat only | [ADR-0003](docs/architecture/adr/0003-phased-channel-integration-strategy.md) |
| Integration strategy | Guide + in-guide chat (MVP) → PMS partner APIs → white-label connectivity; official channels only | [ADR-0003](docs/architecture/adr/0003-phased-channel-integration-strategy.md) |
| Stack | TypeScript monorepo: Next.js, NestJS, PostgreSQL | [ADR-0004](docs/architecture/adr/0004-typescript-monorepo-stack.md) |
| AI | Claude (`claude-opus-5-5`) behind a deterministic policy engine. Full property context with prompt caching in the MVP, then a hybrid with pgvector retrieval when cost or size triggers fire | [ADR-0005](docs/architecture/adr/0005-llm-provider-and-agent-design.md) |
| Payments | Tilopay initially (works with a Costa Rica company), behind `PaymentPort` | [ADR-0007](docs/architecture/adr/0007-tilopay-initial-payment-provider.md) |
| Delivery | Web-first: mobile-first PWAs for guests and hosts, no native apps (host app re-evaluated after the pilot) | [ADR-0006](docs/architecture/adr/0006-web-first-pwa-no-native-apps.md) |

## How we work

Every feature follows the Spec Kit workflow. The rules are in the
[constitution](.specify/memory/constitution.md).

```text
/speckit-specify   → specs/NNN-feature/spec.md     (what & why)
/speckit-clarify   → resolve [NEEDS CLARIFICATION]
/speckit-plan      → plan.md, data-model.md, contracts/   (how; passes the Constitution Check)
/speckit-tasks     → tasks.md                      (tests first)
/speckit-analyze   → cross-artifact consistency check
/speckit-implement → code, tests, evals → pull request
```

`/speckit-checklist` (requirement-quality checklists) is optional, after the plan.

### Spec Kit setup

Spec Kit 1.4.1.dev0 is installed for Claude Code (installed 2026-11-14):

- **Skills:** `.claude/skills/speckit-*`, used as `/speckit-specify`, `/speckit-plan`, and so on.
- **Scripts and core templates:** `.specify/scripts/` and `.specify/templates/`.
- **Guidesk template overrides:** `.specify/templates/overrides/`. They add the Security
  considerations section to specs, and the Constitution Check table and performance budget to
  plans. Spec Kit uses overrides before its core templates, and upgrades don't touch them.

To upgrade Spec Kit with [uv](https://docs.astral.sh/uv/) (the existing constitution is
preserved):

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --here --force --non-interactive --integration claude --ignore-agent-tools
```

## Development setup

You need Node.js 24 (see `.nvmrc`), pnpm 12 (Corepack: `corepack enable`), and Docker.

```bash
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` to at least 32 random characters (for example `openssl rand -hex 32`).
If port 5432 is taken, set `POSTGRES_PORT` (for example 55432) and use it in `DATABASE_URL`.

```bash
docker compose up -d postgres mailpit
```

```bash
pnpm install
```

```bash
pnpm db:migrate
```

```bash
pnpm build
```

```bash
pnpm dev
```

- The API, the worker, migrations, and the portal read the repository's `.env` themselves.
  On the first start the API and worker restart a few times while package builds settle.
- Portal: `http://localhost:3000`. It forwards `/api/*` to the API on port 4000
  (`API_PROXY_URL`), so the browser sees one origin.
- Guest guide: `http://127.0.0.1:3001` (feature 004). A different host from the portal, so the
  two cookie jars never mix; it forwards `/api/*` to the API too. It runs from `apps/guide/dist`,
  so run `pnpm --filter @guidesk/guide build` after changing it. `GUIDE_FIXTURES=true` serves a
  fictional guide at `/g/demoguidedemoguidedemoguid/es` for design and Lighthouse work.
- Emails, including sign-in codes: Mailpit at `http://localhost:8025`.
- Google sign-in needs a development OAuth client in `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`; email codes and passkeys work without it.

### Checks

| Command | What it runs |
|---|---|
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | ESLint, TypeScript, Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | API and database tests against a disposable PostgreSQL (Testcontainers; needs Docker) |
| `pnpm lint:rls` | Fails if a tenant table lacks forced row-level security |
| `pnpm --filter @guidesk/db report:pilot -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--json]` | The founder's pilot metrics (PRD §8) for a sign-up cohort, aggregates only (feature 010); needs `DATABASE_URL` with the migration user |
| `pnpm --filter @guidesk/db plan:set -- --workspace <uuid> --plan free\|pro\|business [--properties <n>\|plan] [--seats <n>\|plan] [--ai-replies <n>\|plan] [--fee-percent <0-30>\|plan] --note "<text>"` | The founder sets a workspace's plan and custom limits (feature 011); logged in the workspace's security log; needs `DATABASE_URL` with the migration user |
| `pnpm --filter @guidesk/db plan:show -- --workspace <uuid> [--json]` | A workspace's plan, each limit with its source, and this month's usage (feature 011) |
| `pnpm test:e2e` | Playwright end-to-end and accessibility tests (needs the running stack) |
| `pnpm --filter @guidesk/portal bundle:check` | Initial JavaScript per route ≤ 175 KB gzip |
| `pnpm perf:lighthouse` | Lighthouse CI budgets on a production build of the portal |
| `pnpm --filter @guidesk/domain tz:check` | Checks the time zone reference data against its sources (feature 002, research R11); `tz:generate` rebuilds it |
| `pnpm --filter @guidesk/evals-extraction eval` | The listing extraction eval suite: 30 synthetic listings and 5 injection cases (SC-002). Calls the real model, so it needs `ANTHROPIC_API_KEY`; CI runs it on every pull request. The report goes to `evals/extraction/report/` |
| `pnpm --filter @guidesk/sandbox build && node apps/sandbox/scripts/ocr-accuracy.ts` | Text recognition accuracy on the 30 rendered sample listings (research R3) |

The [spec 001 quickstart](specs/001-workspace-accounts/quickstart.md) has the full validation
scenarios, the k6 load test, and notes for local end-to-end runs. The
[spec 002 quickstart](specs/002-property-onboarding/quickstart.md) covers the property scenarios.

### Calendar feeds locally (feature 002)

The feed reader only accepts public HTTPS links. To try calendar links on your machine, start
the iCal fixture server, which serves fictional feeds over HTTPS with a test certificate:

```bash
node e2e/helpers/ical-server.ts
```

It prints a feed link and two settings, `SANDBOX_TEST_ALLOW_HOST` and `SANDBOX_TEST_CA_FILE`.
Add them to `.env` and restart `pnpm dev`, so the API and the worker read them. Both settings are refused in production (research R2). The end-to-end test of calendars
(`e2e/specs/properties-us3-calendar.spec.ts`) needs them too. The PMS import uses recorded
fixture servers by default (`PMS_MODE=fixtures`); turn on `PMS_BEDS24` or `PMS_HOSTEX` to see
it in the portal, with the fixture invite code `FIXTURE-BEDS24-INVITE` or the token
`FIXTURE-HOSTEX-TOKEN`.

Load tests run with k6 in Docker against the local stack:

```bash
docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 -e ORIGIN=http://localhost:3000 -e MAILPIT_URL=http://host.docker.internal:8025 grafana/k6:1.8.2 run - < perf/k6/properties.js
```

## Repository layout

```text
apps/portal/                      # Host portal (Next.js)
apps/guide/                       # Guest guide (server-rendered React, ADR-0010)
apps/api/                         # API (NestJS on Fastify, Better Auth)
apps/worker/                      # Background jobs (pg-boss)
packages/                         # domain, contracts, db, emails, i18n, integrations, observability, ...
infra/                            # AWS infrastructure (SST)
e2e/                              # Playwright tests
perf/                             # k6 load tests
docs/                             # Product, research, architecture, ADRs
specs/                            # Feature specs (one folder per feature)
.specify/                         # Spec Kit: constitution, templates, scripts
.claude/skills/                   # Spec Kit skills for Claude Code (/speckit-*)
```

The full layout, including what later features add, is in the
[architecture overview](docs/architecture/overview.md#8-repository-layout).

## License

Proprietary. All rights reserved (to be confirmed).
