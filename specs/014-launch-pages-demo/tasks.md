---

description: "Task list for feature 014: launch pages and demo workspace"
---

# Tasks: Launch Pages and Demo Workspace

**Input**: Design documents from `/specs/014-launch-pages-demo/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story.

> **Production gates (not development gates):** the legal review of the drafts (OQ-35), the legal
> entity's name (OQ-01, `GUIDESK_COMPANY_NAME`), and `GUIDESK_CONTACT_EMAIL` before a production deploy.

## Format: `[ID] [P?] [Story] Description`

Conventions:
- Public texts live only in `public.{es,en}.json`.
- No client components on public pages.
- The demo never prints secrets, never calls the model or partners, and uses synthetic data only.

---

## Phase 1: Setup

- [ ] T001 [P] Public catalogs and their parity test:
  - Create `packages/i18n/messages/public.es.json` and `public.en.json` with the structure in data-model.md (`meta`, `nav`, `footer`, `legal`, then `home`, `privacy`, `terms` filled by the stories) and add them to the package exports.
  - In `packages/i18n/test/catalogs.test.ts`, add a deep check: same keys, same array lengths, string versus non-string matching, and placeholders limited to `{company}`, `{email}`, `{date}`.
- [ ] T002 [P] Portal public helpers with unit tests in `apps/portal/test/public-helpers.test.ts`:
  - `apps/portal/lib/public/settings.ts`:
    - `CONTACT_EMAIL` is validated as an email; an invalid value counts as unset;
    - `COMPANY_NAME` is 1–120 characters, default "Guidesk";
    - `PORTAL_URL` defaults to `http://localhost:3000`, trailing slash trimmed.
  - `apps/portal/lib/public/text.ts`: `fill(text, values)` and `withoutEmailLines(lines, email)`.
  - `apps/portal/lib/public/catalog.ts`: a server-only loader for `public.{locale}.json`.
  - `apps/portal/lib/public/routes.ts`: the public paths and `alternates(path)`.
- [ ] T003 [P] Settings through infra:
  - `infra/config.ts`: `contactEmail` and `companyName` from `GUIDESK_CONTACT_EMAIL` and `GUIDESK_COMPANY_NAME`. Production refuses to deploy without a valid contact email.
  - `infra/web.ts`: portal environment `PORTAL_URL`, `CONTACT_EMAIL`, `COMPANY_NAME`.
  - `infra/guide.ts`: `PORTAL_URL`.
  - `infra/services.ts`: `STAGE: $app.stage` for the API and the worker.
  - `.github/workflows/deploy.yml`: `GUIDESK_CONTACT_EMAIL` and `GUIDESK_COMPANY_NAME`.
  - `.env.example`: the local equivalents, commented.

## Phase 2: Foundational (public pages)

- [ ] T004 Public layout and page frame:
  - `apps/portal/app/[locale]/(public)/layout.tsx` with `apps/portal/components/public/site-header.tsx` (logo, sign-in link, language link to the same page) and `site-footer.tsx` (privacy, terms, contact when set, "© {year} {company}"). All server components.
  - The locale layout's default metadata becomes `robots: { index: false, follow: false }`.
- [ ] T005 Public styles in `apps/portal/app/globals.css`:
  - brand tokens only;
  - a readable line length for legal text;
  - stacking grids for plans, steps, and features at narrow widths;
  - visible focus states;
  - no new fonts.

## Phase 3: User Story 1 — A visitor learns what Guidesk is and starts free (P1) 🎯 MVP

**Goal**: a real public home page at `/{locale}`.

**Independent test**: Quickstart Scenario 1.

### Tests for User Story 1

- [ ] T006 [P] [US1] E2E home checks in `e2e/specs/public-pages.spec.ts`:
  - `/es` and `/en` show the tagline, three steps, five features, and plans (2 properties, 100 replies, 1 seat; "to be announced"; fees 10%, 7%, 5%; free pilot);
  - "Empieza gratis" reaches `/es/sign-in`;
  - the language link keeps the page;
  - no request leaves the origin (AC-SEC-006);
  - update `e2e/specs/smoke.spec.ts` for the new home.
- [ ] T007 [P] [US1] Unit test `apps/portal/test/public-plans.test.ts`: the plan figures come from `@guidesk/domain` (limits and fee bps), formatted per locale.

### Implementation for User Story 1

- [ ] T008 [US1] Home texts in `public.es.json` and `public.en.json`: `meta.home`, `home.*` (hero, audience, steps, features, plans, CTA), with the copy rules from FR-005 (no partnership claims, copilot as copy and paste).
- [ ] T009 [US1] Home page:
  - `apps/portal/lib/public/plans.ts` for the figures;
  - `apps/portal/components/public/home/` (hero, audience, steps, features, plans, CTA);
  - `apps/portal/app/[locale]/(public)/page.tsx`, moved from `[locale]/page.tsx`, with `generateMetadata` (title, description, alternates, Open Graph, `robots` index).
- [ ] T010 [US1] Budgets:
  - add `/es` and `/en` to `apps/portal/bundle-budget.json`;
  - add `/es` to `lighthouserc.json`;
  - add the home to `e2e/specs/a11y.spec.ts`.

## Phase 4: User Story 2 — Privacy policy, terms, consent, and the guest link (P1)

**Goal**: draft legal pages from what Guidesk does, linked from sign-in, invitations, and the guide.

**Independent test**: Quickstart Scenario 2.

### Tests for User Story 2

- [ ] T011 [P] [US2] E2E legal checks in `e2e/specs/public-pages.spec.ts`:
  - `/es/privacy` and `/en/privacy` show the date, the responsible party, every provider (AWS us-east-1, Anthropic, Amazon SES, Google, payment provider, Viator and Civitatis, Sentry), the 12-month retention, the cookies without a banner, and rights within 30 days;
  - `/es/terms` and `/en/terms` show the FR-007 sections and the governing law;
  - the consent line on sign-in and on an invitation links to both pages;
  - add the legal pages to `e2e/specs/a11y.spec.ts`.
- [ ] T012 [P] [US2] Unit test `apps/portal/test/robots-sitemap.test.ts`: robots allows only the six public paths, disallows `/`, and names the sitemap; the sitemap lists exactly the six URLs with alternates (AC-SEC-005).
- [ ] T013 [P] [US2] Guide unit test in `apps/guide/test/`: the privacy link appears on the guide home and in the chat panel, points to `${PORTAL_URL}/${lang}/privacy`, and opens in a new tab with `rel="noopener"`.

### Implementation for User Story 2

- [ ] T014 [US2] Privacy texts (`privacy.*`, `meta.privacy`) in both public catalogs, following FR-006 and the section IDs in data-model.md, written from `docs/architecture/security.md` and the infrastructure. `{email}` appears only in lines that can drop out.
- [ ] T015 [US2] Terms texts (`terms.*`, `meta.terms`) in both public catalogs, following FR-007.
- [ ] T016 [US2] Legal pages:
  - `apps/portal/lib/public/legal.ts` (`LEGAL_UPDATED = "2026-11-19"`, formatted per locale);
  - `apps/portal/components/public/legal-document.tsx` (title, date, table of contents, sections, lists; email lines dropped when unset);
  - `apps/portal/app/[locale]/(public)/privacy/page.tsx` and `terms/page.tsx` with `generateMetadata`.
- [ ] T017 [US2] `apps/portal/app/robots.ts` and `apps/portal/app/sitemap.ts`, from `lib/public/routes.ts` and `PORTAL_URL`.
- [ ] T018 [US2] Consent line:
  - portal catalog key `auth.consent` (es and en, with `<terms>` and `<privacy>` tags);
  - render it under the primary action on `apps/portal/app/[locale]/(auth)/sign-in/page.tsx` (or `components/sign-in-form.tsx`) and `invite/[token]/page.tsx`.
- [ ] T019 [US2] Guest privacy link:
  - `apps/guide/src/config.ts` `portalUrl` (from `PORTAL_URL`, default `http://localhost:3000`);
  - guest catalogs `privacy.link`;
  - render the link at the end of the guide home and in the chat panel (`apps/guide/src/pages/guide-pages.tsx` and the chat component).
- [ ] T020 [US2] Budgets: add `/es/privacy` and `/en/terms` to `bundle-budget.json`, and `/es/privacy` to `lighthouserc.json`.

## Phase 5: User Story 3 — The founder fills a stage with a realistic demo (P2)

**Goal**: `demo:seed` builds a complete demo workspace in one transaction.

**Independent test**: Quickstart Scenario 4.

### Tests for User Story 3

- [ ] T021 [P] [US3] API integration test `apps/api/test/integration/demo-seed.test.ts` (Testcontainers, local KMS), run against an account created through the test app:
  - **Dataset:** the workspace is demo, Pro, with one owner; 2 ready properties with published guides in es and en; past, current, and upcoming stays; the current stay link resolves and its session reveals the door code; extras and requests in three states.
  - **Inbox and Analytics:** one `needs_host` conversation with reason malfunction; the Analytics service for 30 days returns values and comparisons in every block.
  - **Secrets (AC-SEC-003):** `stay_link.token_ciphertext` and `restricted_value.value_ciphertext` don't contain the plaintext; the command output contains no token, code, or door code.
  - **Refusals (AC-SEC-001, AC-SEC-002):** `STAGE=production`; `NODE_ENV=production` without `STAGE`; an unknown email; an unverified email.
  - **Failure (AC-SEC-008):** a failure forced after the first inserts leaves no rows.
  - **Second run:** creates "Demo · Guidesk 2".
  - **No outside calls:** no LLM, email, or push adapter call (spies).
- [ ] T022 [P] [US3] DB integration test in `packages/db/test/integration/pilot-report.test.ts`: adding a demo workspace with activity and an account that belongs only to it leaves every pilot report number unchanged (AC-SEC-004).
- [ ] T023 [P] [US3] Unit test `apps/api/test/unit/demo-history.test.ts`:
  - the generator is deterministic for a seed and a date;
  - it covers 60 days with variation;
  - it keeps monthly AI replies under the Pro pool;
  - it includes the escalation reasons and unanswered questions.

### Implementation for User Story 3

- [ ] T024 [US3] Migration `packages/db/migrations/0037_workspace_demo.sql` (`workspace.demo boolean NOT NULL DEFAULT false`), the Drizzle schema in `packages/db/src/schema/tenancy.ts`, and the generated meta (prettier on `packages/db/migrations/meta`).
- [ ] T025 [P] [US3] Security event type `workspace.demo_seeded` (metadata `properties`, `stays`) in `packages/domain/src/security-events.ts`, with its unit test.
- [ ] T026 [US3] Pilot report: in `packages/db/src/reports/pilot.ts`, leave demo workspaces out of every metric, and leave out accounts whose memberships are all demo.
- [ ] T027 [P] [US3] API config `STAGE` (optional string) in `apps/api/src/config/config.ts`.
- [ ] T028 [P] [US3] Synthetic content in `apps/api/src/demo/content.ts`:
  - the two properties with facts and time zones;
  - section items in es and en as segment documents (arrival, Wi-Fi, house rules, amenities, checkout, local tips, emergencies);
  - fictional door codes and Wi-Fi;
  - extras;
  - a bank of guest questions and assistant replies by topic in both languages;
  - fictional first names.
  - Platform rules: no deposits, extras optional, no off-platform payments.
- [ ] T029 [US3] History generator in `apps/api/src/demo/history.ts`: a seeded PRNG with a weekly pattern; the plan for past stays, daily counters, and per-day questions (topic, decision, reason).
- [ ] T030 [US3] Builder in `apps/api/src/demo/seed.ts`, running in one transaction with `createDataKeyStore(tx)`:
  - the guards;
  - the workspace (demo, Pro, numbered name, backdated) and its membership;
  - properties through `createGuideForProperty`, then the texts (validated with the contracts schema) and the published snapshot from `buildSnapshot`;
  - the door code as `restricted_value` and the Wi-Fi as `public_value`;
  - the property link;
  - stays and stay links (vault);
  - assistant and Explore settings;
  - extras and requests;
  - conversations, messages, and traces, including the open malfunction escalation with its draft;
  - the daily counters;
  - the security event.
- [ ] T031 [US3] Command `apps/api/src/cli/demo-seed.ts` and the `demo:seed` script in `apps/api/package.json`: argument parsing, exit codes, and text and JSON output per `contracts/demo-seed-cli.md`. It never logs data values.

## Phase 6: User Story 4 — The installed app opens where hosts work (P3)

- [ ] T032 [P] [US4] Unit test `apps/portal/test/manifest.test.ts`: `start_url` is `/start` and `scope` is `/`.
- [ ] T033 [US4] `apps/portal/app/manifest.ts`: `start_url: "/start"`.

## Phase 7: Polish and cross-cutting

- [ ] T034 Docs:
  - `docs/pilot-readiness.md`: the contact and company settings, the demo command, and that the legal review covers the drafts at `/privacy` and `/terms`;
  - `docs/ux/screens.md`: public screens P-01 home, P-02 privacy, P-03 terms;
  - the presentation's status slides, marking public pages and demo data as built, then republish the artifact.
- [ ] T035 Full checks: `pnpm format:check`, `lint`, `typecheck`, `test`, `test:integration`, `build`, the portal `bundle:check`, and the e2e suites for public pages and a11y. Run the quickstart scenarios 1–4 locally and record the results in the Implementation notes below.

---

## Dependencies and order

- Setup (T001–T003) comes before everything. Foundational (T004–T005) comes before US1 and US2.
- US1 and US2 are independent of each other, apart from sharing the layout.
- US3 depends only on Setup (T003 for `STAGE`), so it can run in parallel with US1 and US2.
- US4 is independent.
- Within US3: T024 → T026; T027, T028, and T029 can run in parallel; T030 needs T024, T025, T027, T028, and T029; T031 needs T030.
- Polish comes last.

## Parallel examples

- After Setup: T006, T007, T011, T012, T013, T021, T022, T023, and T032 can be written in parallel (different files).
- US3 content and generator (T028, T029) can be built alongside the public pages (T008, T014, T015).

## Implementation strategy

1. Setup and Foundational, then US1 (home) and US2 (legal pages): together they unblock the SES request and Google sign-in.
2. US3 (demo) next, for the partner demo.
3. US4 and Polish last. Each story is shippable on its own; one PR for the feature.

## Implementation notes

(Filled during implementation.)
