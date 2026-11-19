# Research: Launch Pages and Demo Workspace

Decisions for [spec 014](spec.md). Facts about the current code were checked on 2026-11-19.

## R1. Where the public pages live and how they render

- **Decision:** a `(public)` route group under `apps/portal/app/[locale]/`. The current
  `[locale]/page.tsx` moves into the group (same URL, `/{locale}`), and `privacy/page.tsx` and
  `terms/page.tsx` join it. Every public page is a server component; no client component is added.
  *Implementation note:* the header (sign-in, language link) and footer (legal links, contact,
  company) are a `PublicShell` server component each page renders, not a group layout, because the
  language link needs the current page and a layout doesn't know it.
- **Rationale:** the portal already renders each page per request (the locale layout reads
  `headers()` for the CSP nonce), so runtime stage settings work. Server components keep the public
  routes at the framework's baseline JavaScript, well under 150 KB. One domain, no new deployable
  (constitution VII).
- **Alternatives:** a separate static marketing site (a new deployable, domain, and CDN for three
  pages); client components for the language switch (plain links are enough, since the locale is in the
  path).

## R2. Where the public texts live

- **Decision:** two new catalogs, `packages/i18n/public/es.json` and `en.json`, read only by the
  public pages' server components. *Implementation note:* they started in `messages/`, but the
  next-intl plugin precompiles every JSON file in that folder into ICU structures, which broke the
  plain strings at runtime; the separate folder keeps them out of it. They are plain JSON with structured content (sections
  with titles, paragraphs, and lists, as arrays), not ICU messages. A small helper fills the
  placeholders they use (`{company}`, `{email}`, `{date}`, `{year}`, `{count}`, `{percent}`). The catalog test checks that both files have
  the same structure, keys, and array lengths.
- **Rationale:** the locale layout's `NextIntlClientProvider` inherits the whole portal catalog, so
  every key added to `es.json`/`en.json` ships in every portal page's payload; the legal texts are long
  and only three pages need them. The portal precompiles ICU messages (`next.config.ts`), which makes
  formatting extra catalogs at runtime with the ICU formatter fragile; the public texts need no plurals
  or rich formatting. The guest app already keeps its own catalogs for the same reason.
- **Alternatives:** adding namespaces to `es.json`/`en.json` (ships legal text to every screen); MDX or
  TSX files per language (no parity check, harder for the lawyer's edits to land); a CMS (out of scope).

## R3. Plan numbers on the home page

- **Decision:** the plans section reads the limits and the platform fees from `@guidesk/domain`
  (`packages/domain/src/plans/` and `PLAN_PLATFORM_FEE_BPS` in `packages/domain/src/payments/`) in the
  server component, and formats them per locale.
- **Rationale:** FR-002: a plan change updates the page. Server-only imports add nothing to the client
  bundle (the portal keeps value imports out of client components for the budget).

## R4. Stage settings for the public pages

- **Decision:** two optional deploy-time variables, `GUIDESK_CONTACT_EMAIL` and `GUIDESK_COMPANY_NAME`,
  passed by `deploy.yml` from the GitHub environment (like the other `GUIDESK_*` settings, PR #20) and set
  on the portal function as `CONTACT_EMAIL` and `COMPANY_NAME`, plus `PORTAL_URL` (the public origin, for
  absolute URLs in metadata and the sitemap). `infra/config.ts` refuses a production deploy without
  `GUIDESK_CONTACT_EMAIL`, as it already does for the domains. Values render as React text, so markup is
  shown, not interpreted (AC-SEC-007). The contact address is validated as an email at deploy time.
- **Alternatives:** hard-coding the address (it changes with the legal entity, OQ-01); reading it from
  the database (no back-office exists).

## R5. Search basics

- **Decision:**
  - `generateMetadata` on each public page: a title and description per language, `alternates`
    (canonical plus `es` and `en`), and `robots: { index: true }`.
  - The locale layout's default metadata becomes `robots: { index: false, follow: false }`, so portal
    screens are never indexed even if linked.
  - `app/robots.ts` (`/robots.txt`): `Allow` lines for `/es$`, `/en$`, `/es/privacy`, `/en/privacy`,
    `/es/terms`, `/en/terms`, then `Disallow: /`, plus the sitemap URL.
  - `app/sitemap.ts` (`/sitemap.xml`): the six public URLs with language alternates.
  - Both live at the app root; the proxy matcher already skips paths with a dot, so they are not
    locale-prefixed. *Implementation note:* both export `dynamic = "force-dynamic"`, because Next.js
    would otherwise prerender them at build time, before the runtime `PORTAL_URL` exists.
  - The guest guide keeps its `noindex` meta and `x-robots-tag`.
- **Rationale:** FR-011, FR-012, AC-SEC-005, with no new dependency.

## R6. The installed portal app

- **Decision:** `app/manifest.ts` sets `start_url: "/start"` (scope stays `/`). The proxy's locale
  detection redirects `/start` to `/{locale}/start` (cookie, then `Accept-Language`), and the start page's
  client guard sends signed-out people to sign-in.
- **Rationale:** FR-013; push on iPhone (spec 006) needs the installed app, which should open where hosts
  work. Existing installs pick up the new start URL when the manifest refreshes.

## R7. Consent line on sign-in and invitations

- **Decision:** a new portal catalog key, `auth.consent`, with rich-text tags for the two links, rendered
  under the primary action on `sign-in` and on `invite/[token]`. Links go to `/{locale}/terms` and
  `/{locale}/privacy`.
- **Rationale:** FR-009. A short key in the main catalog is fine (two screens need it, a few words).

## R8. Privacy link in the guest guide

- **Decision:** the guide app gets `PORTAL_URL` (infra passes the portal's public origin; locally
  `http://localhost:3000`). The guide home's end and the chat panel show "Privacidad" / "Privacy", linking
  to `${PORTAL_URL}/${lang}/privacy` in a new tab (`rel="noopener"`). The text joins the guest catalogs.
- **Rationale:** FR-010. A link needs no CSP change (navigation is not a fetch), adds no script, and keeps
  the guide's 100 KB budget.

## R9. Where the demo command lives

- **Decision:** in the API package: `apps/api/src/demo/` (the synthetic content and the builder) and
  `apps/api/src/cli/demo-seed.ts`, built to `dist/cli/demo-seed.js`, with a `demo:seed` package script
  (`node --env-file-if-exists=../../.env dist/cli/demo-seed.js`). The command loads the API's
  configuration (`loadApiConfig`), opens the database with `createDb`, and builds the vault from
  `createKeyManagement(config.integrations.kms)`, exactly like the API's integrations module.
- **Rationale:**
  - In AWS the KMS key policy lets only the API and worker task roles generate and decrypt data keys,
    and only with a `workspace_id` context (`infra/keys.ts`). The command must therefore run with the API's
    role.
  - `@guidesk/vault` depends on `@guidesk/db`, so a tool inside `packages/db` (where `plan:set` lives)
    cannot encrypt without a package cycle.
  - The API's database role is the owner role with the RLS "system" policies, the same role the tenancy
    service uses to create workspaces, so direct inserts work without `SET LOCAL ROLE`.
  - The API image (`pnpm deploy --filter @guidesk/api`) already contains `dist/`, so no image change is
    needed.
- **Alternatives:**
  - Seeding through the HTTP API with a signed-in session: needs a session for the founder in a script,
    step-up for locked values, and many calls; it would also send notifications.
  - A worker job: needs a trigger surface (queue message) and gives no direct output.
  - Raw SQL from the founder's machine: cannot encrypt in AWS (key policy).

## R10. Running it on staging

- **Decision:** a one-off ECS task from the API's task definition with a command override
  (`node dist/cli/demo-seed.js --email …`), documented in the quickstart with the cluster and service
  names from the SST outputs. Locally: `pnpm --filter @guidesk/api build && pnpm --filter @guidesk/api
  demo:seed -- --email you@example.com`.
- **Rationale:** the task inherits the API's network (private subnets, database access), secrets, and KMS
  permission. The same mechanism is the open plan for running migrations on AWS (spec 001 tasks).
- **Note:** the email passed on the command line appears in the task definition's run history and in the
  command's log line; it is the founder's own address. The command never logs it again.

## R11. Telling production apart

- **Decision:** `infra/services.ts` adds `STAGE: $app.stage` to the API and worker containers; the API
  configuration accepts an optional `STAGE`. The command refuses when `STAGE` is `production`, or when
  `NODE_ENV` is `production` and `STAGE` is missing (an unknown deployed stage). Locally (`NODE_ENV`
  development or test, no `STAGE`) it runs.
- **Rationale:** every AWS stage runs with `NODE_ENV=production`, so `NODE_ENV` alone can't tell staging
  from production (AC-SEC-001).

## R12. All or nothing, including encryption

- **Decision:** the whole seed runs in one database transaction. The vault's data key store is created
  from the transaction (`createDataKeyStore(tx)`), so the workspace's data key row commits or rolls back
  with everything else. A failure anywhere (KMS, a constraint, a bug) rolls back; the command prints a
  short error and exits 1.
- **Rationale:** FR-027, AC-SEC-008. `StayLinkSecrets` writes data keys through the pool, outside a
  transaction, so the command encrypts with the vault directly instead of reusing that service.

## R13. Building the guide, links, and stays

- **Decision:**
  - The guide uses the product's own pieces: `createGuideForProperty` (`packages/db/src/guide-factory.ts`)
    for the guide, the nine default sections, and the fact items; item texts as segment documents in both
    languages, validated with the `@guidesk/contracts` content schema before insert; and the published
    version from `buildSnapshot` (`packages/domain/src/guides/snapshot.ts`), shaped like
    `PublishService.draftSections`.
  - The door code is a `restricted_value` encrypted with the AAD `{workspaceId, "restricted_value",
    "value_ciphertext", rowId}`; the Wi-Fi password uses `public_value`, which the schema allows.
  - The property link uses `encodePropertyLinkId(randomBytes(17))`.
  - Stay links use `encodeStayToken(randomBytes(STAY_TOKEN_BYTES))`, a SHA-256 token hash, and vault
    ciphertext bound to the row ID, like `StayLinkSecrets.create`.
  - Fact values and texts come from a hand-written content module (`apps/api/src/demo/content.ts`).
- **Rationale:** FR-021, FR-022, SEC-06; the guest renderer and the reveal path read the result exactly as
  they read product-made data.

## R14. Sixty days of history

- **Decision:**
  - A deterministic pseudo-random generator (seeded from the workspace ID) with a weekly pattern
    (busier weekends) drives the history.
  - About eight past stays per property over 60 days, most with `guide_opened_at` set.
  - Daily counters: `guide_open_daily` (property and stay links), `explore_open_daily`,
    `experience_click_daily` (Viator and Civitatis refs), `service_request_daily`, and `chat_usage_daily`.
  - Per-question rows, so topics, escalations, and unanswered questions are real: `conversation`,
    `chat_message` (guest question and assistant reply), and `agent_trace` (topic, decision, reason, small
    cost), at 2–6 questions a day per property.
  - Escalation reasons: malfunction, emergency, money, reservation change, guest asked for the host, plus
    `not_confident` for unanswered questions.
  - One recent conversation stays open (`needs_host`, reason malfunction) with an open draft.
  - The workspace and properties are created about 75 days before the run, so 30-day comparisons have a
    full previous period (analytics compares only when `created_at` precedes it).
  - AI-reply usage stays near 150 a month per workspace, under the Pro pool of 600 for two properties.
  - The template is `apps/api/test/integration/analytics.perf.test.ts`, which inserts these tables by SQL.
- **Rationale:** FR-025, SC-006, the demo-and-plan-limits edge case.

## R15. Demo mark and the pilot report

- **Decision:** migration `0037_workspace_demo.sql` adds `workspace.demo boolean NOT NULL DEFAULT false`
  (Drizzle schema in `packages/db/src/schema/tenancy.ts`). Every query in
  `packages/db/src/reports/pilot.ts` joins or filters on non-demo workspaces. The sign-up cohort leaves out
  users who have at least one membership and whose memberships are all in demo workspaces. The column is
  not exposed in the API or the portal.
- **Rationale:** FR-029, AC-SEC-004, SC-008. A column is the simplest durable mark; RLS is unaffected
  (same table).

## R16. Security event and no notifications

- **Decision:** a new security event type, `workspace.demo_seeded`, with metadata `{ properties: 2,
  stays: n }` added to the allowlist in `packages/domain/src/security-events.ts`, actor = the owner, target
  = the workspace. The seed writes rows directly and never calls the services that send email or push, so
  no notification fires (FR-026).

## R17. Output

- **Decision:** the command prints the workspace name and ID, the two property guide URLs
  (`${GUIDE_URL}/g/{publicId}`), and one line telling the founder to copy the current stay link from the
  portal (Stays → Copy link). It never prints or logs tokens, confirmation codes, or the door code
  (FR-028, AC-SEC-003). Errors print a code and a short message.

## R18. Tests

- **Decision:**
  - API integration (Testcontainers, local KMS): the seed builds the full workspace; Analytics returns
    values and comparisons for 30 days; the guest reveal works for the current stay; ciphertext doesn't
    contain the tokens or the door code; output has no secret; refusals (production stage, unknown and
    unverified emails); a forced failure leaves no rows; a second run makes "Demo · Guidesk 2".
  - DB integration: the pilot report ignores a demo workspace.
  - i18n unit: parity of the public catalogs.
  - Portal unit: robots and sitemap, settings parsing, and the `fill` helper.
  - Guide unit: the privacy link.
  - E2E: the home, privacy, and terms pages in both languages, links and the CTA, and axe checks.
  - CI: the new routes in `bundle-budget.json` and `lighthouserc.json`.
  - Infra: the production deploy refusal without a contact address.
