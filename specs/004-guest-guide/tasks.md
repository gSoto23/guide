---

description: "Task list for feature 004: guest guide"
---

# Tasks: Guest Guide

**Input**: Design documents from `/specs/004-guest-guide/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. The constitution (Principle V) mandates test-first. Within each story, test
tasks come first and must fail before the implementation tasks start.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested
on its own.

> **Production gates (not development gates):** the guide domain (`GUIDESK_GUIDE_DOMAIN`, OQ-11),
> the legal review of disclosure and template wording (OQ-35), and the quickstart on staging with a
> real phone. See T066 and [research R20](research.md#r20-documentation-and-rollout).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Include exact file paths in descriptions

## Path Conventions

The monorepo of features 001 to 003 plus the new guest app (see [plan.md](plan.md#project-structure)):

- `apps/guide` (new), `apps/api`, `apps/portal`, `apps/worker`
- `packages/*`, `infra/` (SST), `e2e/` (Playwright), `perf/k6/`

Conventions that apply to every task:

- New API modules are registered in `apps/api/src/app.module.ts`.
- Guest routes resolve the workspace and property only from a property link or a session cookie
  hash (research R12); they never accept a workspace or property ID from the client.
- Guest responses are `no-store` unless the contract says otherwise, and always carry
  `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer`.
- Stay tokens, confirmation codes, session cookies, and locked values never appear in a log line, a
  span attribute, an error report, security-event metadata, a count, or a cacheable response.
- Share writes check the capability in code (through `WorkspaceAction`: `restricted.reveal` for stay
  links and messages, `properties.manage` for the property link and settings) and again through
  RLS; refusals are logged as `access.role_denied`.
- Every screen is in Spanish and English and fully usable on a phone; every end-to-end test runs on
  the phone viewport. Test data is synthetic.

## Decisions made while writing these tasks

- The scheduled-message template (US1) and the stay message (US4) share one domain builder in
  `packages/domain/src/guest/messages.ts`; US1 adds the template part, US4 the stay part.
- The guest app reads guide data through the API's public guide route over HTTP (the same route the
  browser could call), so the CDN and the guest app share one source and one cache policy.
- Guest end-to-end tests use a second Playwright project, `guest-mobile`, with
  `baseURL: http://127.0.0.1:3001`; host steps in the same tests use the portal through an explicit
  `PORTAL_URL`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the new guest app package, new dependencies, configuration, and message namespaces.

- [X] T001 Create the guest app package `apps/guide`: `package.json` (`@guidesk/guide`; scripts `build`, `dev`, `start`, `test`, `typecheck`, `lint`, `size:check`; dependencies `react`, `react-dom`, `use-intl`, `@guidesk/ui`, `@guidesk/i18n`, `@guidesk/domain`; dev dependencies `esbuild`, `@types/react`, `@types/react-dom`, `vitest`, `@guidesk/config`), `tsconfig.json` (`jsx: react-jsx`, Node types for the server and DOM types for `src/client`), `vitest.config.ts`, and `eslint.config.js` from `@guidesk/config`; versions must already be in the lockfile (research R10) and respect `minimumReleaseAge`
- [X] T002 [P] Add `qrcode` and `@types/qrcode` to `apps/api/package.json` (research R14); confirm the versions are older than 3 days and need no install scripts
- [X] T003 [P] Add `GUIDE_URL` (required URL) to the API config schema in `apps/api/src/config/` and to `.env.example`; add `GUIDE_URL=http://127.0.0.1:3001` to the local `.env` (back it up, keep `chmod 600`, never commit it)
- [X] T004 [P] Add `guideDomain: process.env.GUIDESK_GUIDE_DOMAIN` to `infra/config.ts` and require it in production with the portal and API domains
- [X] T005 [P] Add empty `guest` and `share` namespaces to `packages/i18n/messages/es.json` and `packages/i18n/messages/en.json` (keys filled by each story; the existing parity test keeps ES and EN aligned)
- [X] T006 [P] Add the `guest-mobile` project (`baseURL` `http://127.0.0.1:3001`, Pixel 7) to `e2e/playwright.config.ts` and a helper `e2e/helpers/guest.ts` (publish a guide for a fresh property through the API, add a manual stay, open the Share screen, read Mailpit)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: domain rules, schema, contracts, the guest API skeleton, and the guest app skeleton
that every story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for the foundation

- [X] T007 [P] Domain tests in `packages/domain/test/guest/links.test.ts` (property link `^[a-z2-7]{26}$`, stay token 43 base64url characters, hashing, well-formedness checks), `window.test.ts` (opens 00:00 on the check-in day, closes checkout time + 2 h, stay times override property times, a US zone across a DST change, invalid zone rejected), `lock-state.test.ts` (public, before, inside, ended; revoked, replaced, cancelled, hidden stays end the link), `verification.test.ts` (code alphabet without 0, 1, I, L, O; normalization of case and spaces; constant-time compare; backoff 15, 30, 60 … capped at 1,440 minutes; reset after 24 quiet hours), and `emergency.test.ts`
- [X] T008 [P] Database test `packages/db/test/guest-rls.test.ts`: agents select no `stay_link` or `guide_session` rows; `token_ciphertext` and `confirmation_ciphertext` are not selectable by `guidesk_app`; members of another workspace see nothing; a `stay_link` whose `property_id` differs from its stay's is refused; the CI RLS check passes with the new tables

### Implementation for the foundation

- [X] T009 Implement `packages/domain/src/guest/` (`links.ts`, `window.ts`, `lock-state.ts`, `verification.ts`, `emergency.ts`, `index.ts`) per research R4, R6, R8, R18, and export it from `packages/domain/src/index.ts`
- [X] T010 Add the security event types and metadata allowlists of data model §5 to `packages/domain/src/security-events.ts`, with cases in `packages/domain/test/security-events.test.ts` (no key may match the forbidden pattern)
- [X] T011 Add `packages/db/src/schema/guest.ts` (`guide_link`, `stay_link`, `guide_session`, `guide_open_daily` with every check, index, and partial unique index of data model §1–§4) and `require_confirmation_code` on `guide` in `packages/db/src/schema/guides.ts`; export from `packages/db/src/schema/index.ts`; generate `packages/db/migrations/0021_guest_guide.sql` with drizzle-kit and run prettier on the generated meta JSON
- [X] T012 Write `packages/db/migrations/0022_guest_guide_rls.sql`: enable and force RLS on the four tables; request-context policies (members read `guide_link` and `guide_open_daily`; owners and admins read `stay_link` and `guide_session` and write `guide_link` and `stay_link` while the workspace is active); system policies `TO CURRENT_USER`; column grants that exclude both ciphertext columns from `guidesk_app`; the trigger that checks `stay_link` against its stay; register it in the migration journal; run `pnpm --filter @guidesk/db migrate` locally
- [X] T013 [P] Add Zod contracts `packages/contracts/src/guest.ts` (`GuestGuide`, `GuestSession`, exchange, verify, reveal, opens bodies and responses) and `packages/contracts/src/share.ts` (`ShareOverview`, stay link, message, settings bodies) per contracts/http-api.md; export from `packages/contracts/src/index.ts`
- [X] T014 Extend the origin hook in `apps/api/src/bootstrap.ts`: accept the `GUIDE_URL` origin on `/api/v1/guest/*` only, refuse the portal origin there, and keep the portal origin everywhere else; add cases to the existing security-headers integration test in `apps/api/test/integration/`
- [ ] T015 Create the guest API skeleton `apps/api/src/guest/`: `guest.module.ts`; `guest-context.ts` (resolve a property link or a session cookie hash in the system context, refuse unless the guide is published, the property is active, and the workspace is `active`, then run the handler inside `RequestDb.run` with a system transaction, research R12); `guest-headers.interceptor.ts` (`noindex`, `no-referrer`, default `no-store`); a per-IP limiter (120 per minute, `guest:ip:{sha256}`); one `unavailable` problem for every unavailable case; register the module; add an ESLint restriction in `apps/api/eslint.config.js` so only `guest-context.ts` in `src/guest/` imports `DB_HANDLE`
- [X] T016 Create the guest app skeleton in `apps/guide/src/`: `handler.ts` (Request → Response router for the paths of contracts/guide-web.md, returning 404 for the rest), `headers.ts` (CSP and security headers of research R15, cache policies), `i18n.ts` (`createTranslator` over the `guest` messages), `api-client.ts` (fetches `GET /api/v1/guest/guides/{id}?lang=` from `API_URL`, maps `404` to unavailable), `server.ts` (Node HTTP server on `127.0.0.1:3001` that proxies `/api/*` to `API_PROXY_URL`), `lambda.ts` (Lambda URL event adapter), `pages/layout.tsx` (document shell with `noindex` and `no-referrer` meta, hashed asset links), `styles/guide.css` (mobile-first, brand palette tokens, system font stack), and `scripts/build-assets.ts` (esbuild bundles `src/client/guide.ts` and `src/client/sw.ts`, copies styles and icons with content hashes, writes `dist/assets-manifest.json`)
- [X] T017 [P] Guest app tests `apps/guide/test/router.test.ts` and `apps/guide/test/headers.test.ts`: every route's status and cache policy, CSP without `unsafe-inline`, `X-Robots-Tag`, `Referrer-Policy`, HSTS only on HTTPS, unknown paths 404
- [ ] T018 Wire local development: `apps/guide` `dev` script (build assets, `node --watch dist/server.js`) picked up by `pnpm dev`; document the port in `README.md`; check `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass with the empty app

**Checkpoint**: foundation ready; user stories can begin.

---

## Phase 3: User Story 1 - Open the guide from the property link or the QR code (Priority: P1) 🎯 MVP

**Goal**: guests open the published guide from the property link or QR in their language with
locked fields as placeholders; hosts get the property link, QR code, poster, and scheduled-message
template on the Share screen.

**Independent Test**: spec US1 independent test; quickstart scenario 1.

### Tests for User Story 1 ⚠️

- [X] T019 [P] [US1] API integration test `apps/api/test/integration/guest-guide.test.ts`: the public guide serves the published version only (draft edits invisible); language choice, `translated: false` for untranslated items, primary language fallback; current check-in time after a property change without republishing; locked fields carry labels and no values; a public Wi-Fi password shows and a locked one does not; benefit flag on recommendations; emergency number for CR; cache header `s-maxage=60`; unpublished guide, archived property, workspace pending deletion, replaced link, and an unknown value all return the identical `404` body; a property restored within 30 days opens again (FR-056); the media route redirects only for media in the published version
- [X] T020 [P] [US1] API integration test `apps/api/test/integration/share-property.test.ts`: `GET /share` for owner, admin, and agent (agents get no `stays` or `settings`); the property link is created once and is stable; regenerate by owner and admin (agent `403`, logged), old link `404`, event `guide.property_link_regenerated`; QR SVG and PNG content types and `Content-Disposition`; templates in ES and EN contain the property link and pass the off-platform phrase check; `guide_not_published` before the first publish
- [X] T021 [P] [US1] Domain test `packages/domain/test/guest/messages.test.ts` (template part): ES and EN templates include the link and the PC-05 instruction, contain no codes or stay data, and pass feature 003's off-platform phrase check
- [X] T022 [P] [US1] Guest app tests `apps/guide/test/pages.test.ts`: `/g/{id}` redirects by `guidesk_lang` cookie, then `Accept-Language`, with `private, no-store`; an unpublished language redirects to the primary; the home lists visible sections in order with Arrival first, check-in and checkout times, Maps and Waze links, the Emergency link, and the language switch only when two languages are published; a section renders documents through `GuideDocumentView` with locked fields as placeholders carrying every state text in `data-` attributes; the disclosure renders next to benefit recommendations; the unavailable page shows no property detail; links get `rel="noopener noreferrer nofollow"`
- [X] T023 [P] [US1] End-to-end test `e2e/specs/guest-us1.spec.ts`: an owner publishes a guide (ES and EN, lockbox code, public Wi-Fi, a benefit recommendation), copies the property link and downloads the QR on the Share screen; a guest context in English opens the link, sees English content, the Wi-Fi password, the lock placeholder, and the disclosure, switches to Spanish and keeps it on reload; the page HTML holds no locked value; after unpublishing (cache bypassed in local runs) the link shows the unavailable page

### Implementation for User Story 1

- [X] T024 [US1] Implement the template part of `packages/domain/src/guest/messages.ts` and its ES and EN strings in the `share` namespace of `packages/i18n/messages/*.json`
- [X] T025 [US1] Implement `apps/api/src/share/`: `share.module.ts`, `property-links.service.ts` (ensure with `ON CONFLICT DO NOTHING` on the partial index, regenerate in one transaction with the event), `qr.service.ts` (`qrcode` SVG and PNG, level M), `share.controller.ts` (`GET /share` property part with `opensLast30Days: 0` for now and templates, `POST /property-link/regenerate`, `GET /qr.svg`, `GET /qr.png`), registered in `app.module.ts`
- [X] T026 [US1] Implement `apps/api/src/guest/guest-guide.service.ts` and `guest.controller.ts` `GET /api/v1/guest/guides/:publicId`: run feature 003's `PublishService.preview` with `source: "published"` in the guest context, add facts, time zone, country, languages, primary language, emergency number, public Wi-Fi, benefit flags, `translated` flags, and guest media URLs; set the public cache header; plus `GET /api/v1/guest/media/:publicId/:mediaId/:variant` (302 to a 5-minute presigned GET, `public, max-age=60`)
- [X] T027 [US1] Implement the guest app pages `apps/guide/src/pages/home.tsx`, `section.tsx`, `emergency.tsx`, `unavailable.tsx`, `root.tsx` and components in `apps/guide/src/components/` (`tiles.tsx`, `locked-field.tsx` with the public state, `wifi.tsx` with Copy, `address.tsx` with Maps and Waze, `media.tsx` with width, height, lazy loading, and video posters, `disclosure.tsx`, `language-switch.tsx`, `top-bar.tsx` with Emergency), and fill the `guest` namespace in ES and EN (labels, placeholders, lock reasons, booking-messages fallback, disclosure, unavailable texts, untranslated note)
- [X] T028 [US1] Implement the browser script base `apps/guide/src/client/guide.ts`: Copy buttons, the language cookie before following the switch, the one-time notice slot from `sessionStorage`; confirm the bundle stays under 15 KB gzip
- [X] T029 [US1] Implement the portal Share screen `apps/portal/app/[locale]/(app)/properties/[propertyId]/share/page.tsx` with `apps/portal/components/share/share-screen.tsx`, `property-link-card.tsx` (Copy, Open, QR downloads, regenerate dialog with the printed-poster warning, owners and admins only), `template-card.tsx` (ES and EN tabs, Copy, steps for Airbnb, Booking.com, and Vrbo), the PC-01 reminder, and the not-published state (FR-043); add a Share entry to the property and guide pages; fill the `share` namespace; add the route to `apps/portal/bundle-budget.json`
- [X] T030 [US1] Implement the poster page `apps/portal/app/[locale]/(app)/properties/[propertyId]/share/poster/page.tsx` (QR SVG, property name, Wi-Fi network name, public-guide line, print styles for A4 and Letter) and add it to the bundle budget

**Checkpoint**: US1 works on its own: published guides open from the property link and QR.

---

## Phase 4: User Story 2 - Send each booking a stay link that unlocks the codes during the stay (Priority: P1)

**Goal**: owners and admins copy a stay link per stay; guests exchange it for a device session and
see codes only inside the stay window; revocation and cancellation apply at once.

**Independent Test**: spec US2 independent test; quickstart scenario 2.

### Tests for User Story 2 ⚠️

- [X] T031 [P] [US2] API integration test `apps/api/test/integration/stay-links.test.ts`: copying needs step-up and returns the same URL on later copies (event `guide.stay_link_copied` each time); regenerate replaces it (old token `404`/ended); revoke; agents get `403` (logged) and see no stays; cancelled, hidden, and ended stays answer `stay_not_eligible`; the overview lists stays by check-in date with link statuses, devices, first opened, values shown, and the may-be-block label; the token appears in no log line
- [X] T032 [P] [US2] API integration test `apps/api/test/integration/guest-sessions.test.ts`: the exchange (JSON only), cookie attributes (`HttpOnly`, `Secure` or local name, `SameSite=Lax`, `Path=/`, no `Domain`), unknown token `404` identical to an unavailable link, `notice: "ended"` for revoked, replaced, cancelled, and closed-window links, `notice: "device_limit"` on the 11th device, a second exchange on the same device reuses the session; session state `public`, `before` (with `opensAt`), `inside`, `ended`, the stay card without guest name or channel, and a date change in the stay followed at once
- [X] T033 [P] [US2] API integration test `apps/api/test/integration/guest-reveals.test.ts`: a reveal inside the window returns the value with `no-store` and records `restricted_value.guest_revealed` with the stay and session IDs (no actor, no IP); `409 not_in_window` before and after; `404` for a field not in the published guide and for another property's field; `401` without a session; the 31st reveal in an hour `429`; after revocation the next reveal is refused; a changed lockbox value shows on the next reveal
- [X] T034 [P] [US2] Guest app test `apps/guide/test/exchange.test.ts`: `/s/{token}` never calls the API on `GET`, is `no-store` and `noindex`, contains the no-script explanation, and its script uses `location.replace`
- [X] T035 [P] [US2] End-to-end test `e2e/specs/guest-us2.spec.ts`: the owner copies a stay link (step-up dialog) for a stay that includes today; a guest context opens it, the address bar shows `/g/{id}/{lang}` and history has no token entry, the stay card shows, Show code reveals the code large with Copy; a second stay starting next week shows "Available from …"; the owner revokes the first link and the guest's next Show code shows the ended state; the owner's reveal history lists the guest reveal

### Implementation for User Story 2

- [X] T036 [US2] Implement `apps/api/src/share/stay-links.service.ts`: create (application-generated ID, vault-encrypted token with AAD bound to the row, hash), copy (decrypt in the system context after the request-context checks, update `last_copied_*`, event), regenerate, revoke, and the stay list for the overview (statuses, devices, first opened, values shown, `locked_until`); routes `POST /stays/:stayId/link`, `/regenerate` (step-up), `/revoke` in `share.controller.ts`
- [X] T037 [US2] Implement `apps/api/src/guest/sessions.service.ts` and routes `POST /api/v1/guest/stay-sessions` (JSON only, 20 per IP per hour, device limit, reuse, cookie) and `GET /api/v1/guest/session` (lock state from the domain, stay card, `codeRequired`, `verified`, `lockedUntil`); extend `guest-context.ts` to read the session cookie
- [X] T038 [US2] Implement `apps/api/src/guest/reveals.service.ts` and `POST /api/v1/guest/reveals`: published-field check, lock state, verification gate (false until US3 sets the flag), 30 per session per hour, the security event, then `RevealService.valueOf`; `Cache-Control: no-store` and `Pragma: no-cache`
- [X] T039 [US2] Redact stay tokens and session cookies from request logs and error reports: `/s/` paths and `token` fields in the API logger configuration and the guest app server log
- [X] T040 [US2] Implement the exchange page `apps/guide/src/pages/exchange.tsx` and its script entry (post, `sessionStorage` notice, `location.replace`), with the no-script explanation
- [X] T041 [US2] Extend `apps/guide/src/client/guide.ts`: fetch the session state, fill the stay card, set every locked field's state (public, before with the time in the property's zone and the device's when different, inside, ended), Show code with "Showing…", the value large with Copy and a character-by-character `aria-label`, error and fallback texts, and removal of the value after 5 minutes hidden
- [X] T042 [US2] Implement the portal stays card `apps/portal/components/share/stays-list.tsx`: stays with dates, channel, may-be-block label, and link status; Copy stay link through `useStepUp`; Regenerate and Revoke with confirmation dialogs; owners and admins only; empty states for no calendar and no stays (FR-043)

**Checkpoint**: US1 and US2 work on their own; the MVP of the guest guide is complete.

---

## Phase 5: User Story 3 - Ask guests for a confirmation code before showing codes (Priority: P2)

**Goal**: an optional per-property confirmation code with limits per device, address, and stay,
lockouts with backoff, and a host alert.

**Independent Test**: spec US3 independent test; quickstart scenario 3.

### Tests for User Story 3 ⚠️

- [ ] T043 [P] [US3] API integration test `apps/api/test/integration/guest-verification.test.ts`: the setting by owner and admin only (event `guide.confirmation_changed`) generates codes for active stay links and shows them on copy; a reveal without verification `409 verification_required`; a wrong code `422` with `attemptsLeft`; 5 wrong codes from one device lock the stay for 15 minutes (`423`, `Retry-After`); 5 wrong codes spread over 5 devices also lock it; per-IP limit; the second lockout lasts 30 minutes; each lockout sends `guides.verification_locked` to owners and admins (Mailpit or the outbox table) and records `guide.verification_locked`; the right code verifies only that device; regenerating changes the code and unverifies earlier devices; turning the setting off removes the step; no code in any log line or event
- [ ] T044 [P] [US3] End-to-end test `e2e/specs/guest-us3.spec.ts`: the owner turns on the confirmation code and copies a stay link with its code; the guest is asked for the code on Show code, a wrong code shows an error, the right code shows the value, and a reload does not ask again

### Implementation for User Story 3

- [ ] T045 [US3] Implement `PATCH /share/settings` in the share module (generate codes for active links in the system context, event) and return `confirmationCode` from the copy and regenerate routes when required
- [ ] T046 [US3] Implement `apps/api/src/guest/verification.service.ts` and `POST /api/v1/guest/verify`: per-session and per-IP limits through `RateLimitService`, the per-stay window and lockout on `stay_link` in one locked row update, backoff from the domain, `verified_at`, the event; switch the reveal gate on
- [ ] T047 [US3] Add `MemberNotices.toOwnersAndAdmins` in `apps/api/src/tenancy/member-notices.ts` and the email `packages/emails/src/guides/verification-locked.tsx` (ES and EN, contracts/emails.md) with its render export; send it once per lockout
- [ ] T048 [US3] Implement the confirmation form (`G-04`) in the guest app: markup in `apps/guide/src/components/locked-field.tsx`, submit, errors, and the countdown in `apps/guide/src/client/guide.ts`; ES and EN texts
- [ ] T049 [US3] Add the "Ask for a confirmation code" switch to the Share screen and show the code next to a copied stay link in `apps/portal/components/share/`

**Checkpoint**: US3 works with US2; US1 is unaffected.

---

## Phase 6: User Story 4 - Deliver the access instructions through the booking thread too (Priority: P2)

**Goal**: a ready-to-paste stay message in ES or EN from the published guide, with codes only after
step-up and recorded as an export.

**Independent Test**: spec US4 independent test; quickstart scenario 4.

### Tests for User Story 4 ⚠️

- [ ] T050 [P] [US4] Domain test cases in `packages/domain/test/guest/messages.test.ts` (stay part): ES and EN messages with greeting, stay link, times, address, arrival steps as plain text, Wi-Fi network, the confirmation code when given, the optional-guide reminder; locked fields as `{label} (shown in your stay link)` without values and as values when given; no guest name; the off-platform phrase check passes
- [ ] T051 [P] [US4] API integration test `apps/api/test/integration/stay-messages.test.ts`: owner and admin get the message without values without step-up; `withValues` needs step-up, includes the values, and records `restricted_value.exported`; agents `403`; the message uses the published version, not the draft; `guide_not_published` and `stay_not_eligible` cases
- [ ] T052 [P] [US4] End-to-end test `e2e/specs/guest-us4.spec.ts`: the owner copies the stay message in English without codes and then with codes (step-up), and the clipboard text matches

### Implementation for User Story 4

- [ ] T053 [US4] Implement the stay part of `packages/domain/src/guest/messages.ts` (uses feature 003's `docPlainText` with a locked-field resolver) and its ES and EN strings
- [ ] T054 [US4] Implement `POST /share/stays/:stayId/message` in the share module: the published Arrival and Wi-Fi sections in the chosen language, current facts, the stay link (decrypted after the checks), the code when required, values through `RevealService` only with `withValues` and step-up, and the export event
- [ ] T055 [US4] Implement the "Copy stay message" dialog in `apps/portal/components/share/stay-message-dialog.tsx` (language, "Include access codes" with step-up, preview, Copy)

**Checkpoint**: US4 works with US2.

---

## Phase 7: User Story 5 - Keep the guide readable with a weak or no connection (Priority: P3)

**Goal**: viewed pages and images stay readable offline with a banner; codes are never stored;
text first and media at reserved sizes.

**Independent Test**: spec US5 independent test; quickstart scenario 5.

### Tests for User Story 5 ⚠️

- [X] T056 [P] [US5] Guest app test `apps/guide/test/sw.test.ts` (service worker routing rules against a fake cache and fetch): guide pages network-first with fallback and the `data-offline-at` mark; assets and guest media cache-first; other `/api/v1/guest/` responses and `no-store` responses never stored; a network `404` removes that guide's cached pages and media; unknown navigations fall back to `/offline`
- [ ] T057 [P] [US5] End-to-end test `e2e/specs/guest-us5.spec.ts`: with a stay link inside the window, open the home and Arrival, reveal the code, go offline (`context.setOffline(true)`): the pages open with the offline banner, the code field asks for a connection, a never-opened section shows the not-saved page, and no cache entry contains the value

### Implementation for User Story 5

- [ ] T058 [US5] Implement the service worker `apps/guide/src/client/sw.ts` (contracts/guide-web.md rules), the `/sw.js` route with `no-cache`, the manifest and icons, and the `/offline` page
- [ ] T059 [US5] Extend `apps/guide/src/client/guide.ts`: register the service worker, show the offline banner from `data-offline-at` with the localized time, and the offline state of locked fields; check the first image is eager and the rest lazy with reserved sizes, and videos use `preload="none"` with posters

**Checkpoint**: US5 works on top of US1 (and US2 for the code state).

---

## Phase 8: User Story 6 - Know that guests open the guide, without tracking them (Priority: P3)

**Goal**: open counts per property, day, and link type, and stay link figures on the Share screen,
with no identifiers.

**Independent Test**: spec US6 independent test; quickstart scenario 6.

### Tests for User Story 6 ⚠️

- [ ] T060 [P] [US6] API integration test `apps/api/test/integration/guest-opens.test.ts`: opens upsert per property, day (property's zone), and kind; bot user agents ignored; over 60 per IP per hour ignored; the row holds no address or device data; the overview reports `opensLast30Days` and each stay's devices, first opened, and values shown
- [ ] T061 [P] [US6] End-to-end test `e2e/specs/guest-us6.spec.ts`: two guest contexts open the property link and one opens the stay link; the Share screen shows the counts and "Opened on 1 device"

### Implementation for User Story 6

- [ ] T062 [US6] Implement `POST /api/v1/guest/opens` in `apps/api/src/guest/opens.service.ts` (bot list, limit, upsert) and the 30-day sum in the share overview
- [ ] T063 [US6] Send the open beacon from `apps/guide/src/client/guide.ts` once per link per day (`localStorage` date) and show the counts on the Share screen cards

**Checkpoint**: all user stories work on their own.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T064 [P] Add cases for every new share route and guest isolation (a session of one property requesting another property's guide data, media, or field) to `apps/api/test/integration/cross-tenant.test.ts` (AC-SEC-015)
- [ ] T065 [P] Security review test `apps/api/test/integration/security-review-004.test.ts`: AC-SEC-001 to AC-SEC-015 that the API owns, end to end on one property, with every log line, security event, and response body searched for the stay token, the confirmation code, the session cookie, and the lockbox value
- [ ] T066 [P] Add retention rules to `apps/worker/src/jobs/retention.ts` (stay links and sessions 30 days after the window or `ended_at`; replaced property links after 30 days) with cases in the worker retention test
- [ ] T067 [P] Extend `e2e/specs/a11y.spec.ts` with axe on the guest home, a section, Arrival with a locked field, the confirmation form, the unavailable page, the Share screen, and the poster; record the manual screen-reader pass of the reveal flow in this file (SC-003)
- [ ] T068 [P] Add the fixture mode to the guest app (`apps/guide/src/fixtures/guide.json`, served when `GUIDE_FIXTURES=true`, never set in infra) and guest URLs to Lighthouse CI (`lighthouserc.json` or a second config run by the performance job, including a slow-3G run of the home); update `.github/workflows/` so the performance job builds and starts the guest app
- [ ] T069 [P] Implement `apps/guide/scripts/check-size.ts` (script ≤ 15 KB gzip, script plus styles plus the home HTML ≤ 150 KB) and run it in the performance job
- [ ] T070 [P] Timing test `apps/api/test/integration/guest.perf.test.ts`: guest guide data p95 ≤ 300 ms and reveal p95 ≤ 500 ms on a 50-item guide (SC-009)
- [ ] T071 [P] k6 script `perf/k6/guest.js` for guide opens, session reads, and reveals
- [ ] T072 Infrastructure `infra/guide.ts`: `GuideRouter` (CloudFront with WAF, `guideDomain`), the guest app function (arm64, bundled handler `apps/guide/src/lambda.ts`, `API_URL`), routes (`/api/v1/guest` to the API with the edge secret header, everything else to the function, cache policy honoring origin headers); `GUIDE_URL` for the API service in `infra/services.ts`; import from `sst.config.ts`; `pnpm typecheck:infra`
- [ ] T073 Observability: spans for guest routes with outcome codes (`exchanged`, `ended`, `device_limit`, `revealed`, `not_in_window`, `locked`) and counters for exchanges, reveals, verification failures, lockouts, and opens in `apps/api/src/guest/`; errors from the guest app to Sentry through `@guidesk/observability`
- [ ] T074 Documentation: `docs/architecture/adr/0010-guest-guide-server-rendered-without-client-framework.md` and the ADR index; `docs/architecture/overview.md` (containers table, repository layout); `docs/architecture/security.md` (SEC-01 to SEC-04 as implemented, guest session, confirmation code, data classification of stay tokens); `docs/architecture/performance.md` (guest script budget); `docs/ux/README.md` (gap 1 and the verification screen); README (guest app)
- [ ] T075 Run the [quickstart](quickstart.md) locally end to end and record the result and the open founder gates in `research.md` R20

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks every story.
- **US1 (Phase 3)**: depends on Foundational. **US2 (Phase 4)**: depends on Foundational and uses
  US1's guest pages and Share screen (it adds to them), so it follows US1.
- **US3 (Phase 5)** and **US4 (Phase 6)**: depend on US2 (stay links); independent of each other.
- **US5 (Phase 7)**: depends on US1 (pages) and touches the US2 script; independent of US3 and US4.
- **US6 (Phase 8)**: depends on US1 and US2 (stay figures).
- **Polish (Phase 9)**: after the stories it covers.

### Within Each User Story

- Tests first, failing; then domain, then API, then guest app and portal.
- The browser script `apps/guide/src/client/guide.ts` and `share.controller.ts` are touched by
  several stories: those tasks run in story order, never in parallel.

### Parallel Opportunities

- Setup T002 to T006 in parallel after T001.
- Foundation tests T007, T008, T017 and contracts T013 in parallel.
- Within each story, all test tasks marked [P] in parallel.
- Polish T064 to T071 in parallel.

## Parallel Example: User Story 1

```bash
# Tests together:
Task: "API integration test apps/api/test/integration/guest-guide.test.ts"
Task: "API integration test apps/api/test/integration/share-property.test.ts"
Task: "Domain test packages/domain/test/guest/messages.test.ts (template part)"
Task: "Guest app tests apps/guide/test/pages.test.ts"
Task: "End-to-end test e2e/specs/guest-us1.spec.ts"
```

## Implementation Strategy

### MVP First (User Stories 1 and 2)

1. Phase 1 and Phase 2.
2. US1: the public guide and the Share screen. Validate with quickstart scenario 1.
3. US2: stay links and codes in the window. Validate with scenario 2. This is the guest guide MVP.

### Incremental Delivery

US3 (confirmation code) and US4 (stay message) next, then US5 (offline) and US6 (counts), then
polish. Each story is committed and pushed when its checkpoint passes.
