---

description: "Task list for feature 009: tours and experiences (affiliate)"
---

# Tasks: Tours and Experiences (Affiliate)

**Input**: Design documents from `/specs/009-tours-affiliate/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required (constitution V): test tasks come first in each story; the agent eval suite gates the
knowledge change.

> **Production gates (not development gates):** Viator and Civitatis affiliate accounts (OQ-34), the
> `ViatorApiKey` secret and `CIVITATIS_AFFILIATE_ID`, the partners' content terms and Viator's Spanish
> support confirmed with the live key, curated Civitatis entries for the pilot destinations, the legal
> review of the disclosure (OQ-35), and a staging check on a phone.

## Format: `[ID] [P?] [Story] Description`

Conventions: member writes need `properties.manage`; every screen in Spanish and English; no partner call
during a guest request; partner text is plain text; synthetic test data only (no password-like literals).

---

## Phase 1: Setup

- [ ] T001 Add the `explore.refresh` and `explore.references` queues and schedules in `packages/domain/src/jobs.ts`, and the `explore.settings_changed` security event with its metadata allowlist in `packages/domain/src/security-events.ts`
- [ ] T002 [P] Catalogs `packages/i18n/messages/{es,en}.json` (portal: `explore` settings, categories, errors) and `guest.{es,en}.json` (Explore, categories, cards, detail, disclosure "Guidesk may earn a commission if you book, at no extra cost to you", offline, English-text note)

## Phase 2: Foundational

- [ ] T003 [P] Domain `packages/domain/src/explore/` with unit tests: categories (`tours`, `food_drink`, `outdoor`, `water`, `culture`, `day_trips`, `other`), destination keys (`{country}:{city}` normalized, ≤ 120 characters), Viator tag mapping rules (R6), selection (hidden categories and refs, rank `rating × log10(reviews + 10)`, at most 4 per category, at most 12, fixed category order, stable ties), effective settings (property, workspace, defaults), ref pattern `^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$`, redirect target (HTTPS, allowlisted hosts, Civitatis `aid`), visibility
- [ ] T004 Schema `packages/db/src/schema/explore.ts` (data model: `experience_destination`, `experience_refresh`, `experience`, `experience_partner_reference`, `explore_settings`, `explore_open_daily`, `experience_click_daily`); generate `0030_explore.sql`; write `0031_explore_rls.sql` (forced RLS, read-only policy for `guidesk_app` on the four global tables, workspace policies and grants on the three tenant tables); `packages/db/test/integration/explore-rls.test.ts`
- [ ] T005 [P] Contracts `packages/contracts/src/explore.ts` (guest explore response, experience card, settings bodies and responses); `GuestGuide.explore.visible`; opens kind `explore`
- [ ] T006 `ExperiencePartnerPort` in `packages/integrations/src/experiences/` with the Viator basic-access adapter (`/products/search`, `/destinations`, `/products/tags`; `exp-api-key`, version header, 10-second timeouts, error codes only) and a fixtures adapter (synthetic products for any destination); config `EXPERIENCES_MODE`, `VIATOR_API_KEY` (`unset` treated as absent), `VIATOR_API_URL`, `CIVITATIS_AFFILIATE_ID`; contract test against a local HTTP server
- [ ] T007 [P] Curated list `packages/integrations/catalog/experiences.json` (synthetic sample entries for `cr:samara` and one more destination) with its loader and a validation test (HTTPS Civitatis URLs without query strings, categories, text lengths, optional `viatorDestinationId`)

## Phase 3: User Story 1 - Guests discover experiences (P1) 🎯 MVP

- [ ] T008 [P] [US1] Worker test `apps/worker/test/integration/explore-refresh.test.ts`: active destinations, Viator mapping by city then region, upsert per language, removed products dropped, `expires_at` 60 minutes, failures recorded without bodies
- [ ] T009 [P] [US1] API test `apps/api/test/integration/explore.test.ts`: explore route (tips first, grouping, limit 12, language fallback note, expired rows ignored, curated entries only with `CIVITATIS_AFFILIATE_ID`), `explore.visible` in the guide response, redirect with `c=1` counting once, opens kind `explore`
- [ ] T010 [P] [US1] End-to-end `e2e/specs/explore-us1.spec.ts` (quickstart 1)
- [ ] T011 [US1] Worker jobs `apps/worker/src/jobs/explore-refresh.ts` (every 30 minutes) and `explore-references.ts` (weekly), registered in the worker
- [ ] T012 [US1] API `apps/api/src/explore/` guest routes (explore list, redirect) and `apps/api/src/guest/` changes (`explore.visible`, opens kind)
- [ ] T013 [US1] Guest app: `/g/{publicId}/{lang}/explore` and `/explore/{ref}` pages, Explore in the navigation, cards with lazy images at reserved sizes, the click marker and offline "Book" state in `apps/guide/src/client/guide.ts`, CSP `img-src` from `EXPERIENCE_IMAGE_ORIGINS`, service worker rules, fixtures for the guide's fixture mode

## Phase 4: User Story 2 - Hosts choose what guests see (P1)

- [ ] T014 [P] [US2] API tests in `apps/api/test/integration/explore.test.ts`: workspace and property settings, follow the default, hidden categories and experiences reflected in the guest route, version conflicts, agents read-only (403 logged), security log event
- [ ] T015 [P] [US2] End-to-end `e2e/specs/explore-us2.spec.ts` (quickstart 2)
- [ ] T016 [US2] API member routes `GET/PUT /explore` and `GET/PUT /properties/{propertyId}/explore`
- [ ] T017 [US2] Portal: property Explore screen `app/[locale]/(app)/properties/[propertyId]/explore/page.tsx` and `components/explore/` (switches, categories, experience list with hide, tips, preview, empty destination note), a workspace default card in settings, a link from the property page; bundle budget entry

## Phase 5: User Story 3 - Disclosures and safe links (P1)

- [ ] T018 [P] [US3] API tests: redirect refuses hidden, removed, other-property, and malformed refs and ignores extra parameters (lands on Explore); only allowlisted HTTPS hosts; `Referrer-Policy: no-referrer` and `no-store`
- [ ] T019 [P] [US3] Guest app tests: partner text with markup renders as text; the disclosure on the page, each card, and the detail in both languages; `rel="noopener noreferrer"` and `target="_blank"`
- [ ] T020 [P] [US3] End-to-end `e2e/specs/explore-us3.spec.ts` (quickstart 3)
- [ ] T021 [US3] Make the tests pass (disclosure component, text rendering, redirect guards)

## Phase 6: User Story 4 - Freshness without slowing the guide (P2)

- [ ] T022 [P] [US4] Worker tests: partner failure keeps rows until `expires_at`, then the guest route hides that partner; 3 failures skip the partner for the run; expired rows deleted after a day; the guest route makes no partner call
- [ ] T023 [US4] Implement the failure handling and cleanup in `explore-refresh.ts`; span attributes per partner

## Phase 7: User Story 5 - The assistant points to Explore (P3)

- [ ] T024 [P] [US5] Worker tests: the reply job's knowledge has the Explore line only when Explore is visible; the copilot's never; no partner content in any model input
- [ ] T025 [P] [US5] Eval cases in `evals/agent` (guide with `exploreUrl`; "¿Qué tours hay por aquí?" and "What tours are there?" mention the Explore link and no partner name)
- [ ] T026 [P] [US5] End-to-end `e2e/specs/explore-us5.spec.ts` (quickstart 5, fake model)
- [ ] T027 [US5] `KnowledgeInput.exploreUrl` in `packages/domain/src/agent/knowledge.ts`; set it in `apps/worker/src/jobs/assistant-pipeline.ts` for guide chat replies; null for the copilot

## Phase 8: Polish

- [ ] T028 [P] Cross-tenant cases for the member routes in `apps/api/test/integration/cross-tenant.test.ts`
- [ ] T029 [P] Security review tests `security-review-009` (AC-SEC-001 to 006)
- [ ] T030 [P] Retention of expired experiences and partner references; tests
- [ ] T031 [P] Accessibility: axe on Explore, the detail, and the settings screen
- [ ] T032 [P] Timing tests: guest explore route, redirect, settings routes; Lighthouse URL for Explore in `lighthouserc.guide.json`
- [ ] T033 Infra: `ViatorApiKey` secret (placeholder `unset`) for the worker, `EXPERIENCES_MODE=live`, `CIVITATIS_AFFILIATE_ID`, `EXPERIENCE_IMAGE_ORIGINS` for the guide
- [ ] T034 Docs: security (SEC-11, SEC-13 notes), overview (as built), screens G-07, G-14, H-28, open questions OQ-08 (decided) and OQ-34, research R13 notes
- [ ] T035 Run the quickstart locally and record it in research R13

## Dependencies

- Phase 2 blocks every story. US1 provides the data and guest pages that US2, US3, and US4 extend; US5
  depends only on Phase 2 and the visibility rule.

## Implementation Strategy

MVP is US1 + US3 (guests see experiences with disclosures and safe links), then US2 (host control),
US4, US5, and the polish phase.
