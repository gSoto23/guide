# Research: Tours and Experiences (Affiliate)

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-18

Decisions for spec 009, building on specs 002 to 007.

## R1. Partners, access, and their terms

- **Decision:** two partners in this spec.
  - **Viator** through its Partner API v2 with **basic access**, which every affiliate gets by default
    (key from the partner dashboard, Tools > Affiliate API; header `exp-api-key`, `Accept:
    application/json;version=2.0`, base `https://api.viator.com/partner`). Basic access allows
    `POST /products/search`, `/search/freetext`, `/destinations`, `/products/tags`, and single products;
    it does not allow `/products/modified-since`, `/products/bulk`, or booking.
  - **Civitatis** through affiliate links: any product URL with `?aid={affiliate number}`. Its feed and
    API are available only on request, so this spec uses a short curated list per destination (R3).
  - GetYourGuide is out of scope (spec: later).
- **Partner terms that shape the design** (Viator technical guide and basic-access golden path,
  read 2026-11-18):
  - Search results may be cached for **at most 1 hour**, and search endpoints must not be used to ingest
    the catalog. Tags are cached and refreshed weekly; destinations weekly.
  - Product previews show title, thumbnail, short description, average rating, review count, and price;
    the traveler books on viator.com through the returned `productUrl`, which carries the affiliate
    parameters (`pid`, `mcid`, `medium`). Attribution lasts 30 days after the click.
  - Civitatis asks feed users to refresh at least monthly and to show content unmodified (applies when
    the feed is granted).
- **Rationale:** FR-014, FR-019; the fastest MVP route (monetization research) without payment
  handling.
- **Alternatives:** scraping partner pages (forbidden by their terms); partner widgets in the guide
  (heavy third-party scripts against the guide's budget and CSP, performance §2).
- **To confirm with live keys (founder gate R13):** the `Accept-Language` values Viator supports
  (Spanish), the sort values (rating), the duration field in search results, and rate limits.

## R2. Viator: what is fetched and kept

- **Decision:** a background job searches each active destination (R4) with `filtering.destination`,
  the default ("featured") sort, `pagination {start: 1, count: 30}`, currency USD, once per language
  (`es`, `en`; English only if Spanish isn't supported). Each product is stored with `expires_at =
  fetched_at + 60 minutes`; guest reads ignore expired rows. The job runs every 30 minutes, so one
  failed run keeps the list alive and two failed runs hide it (FR-016). Only product codes survive
  expiry, in host "hidden" lists (identifiers, not content).
- **Rationale:** stays inside the 1-hour cache rule while guests never wait on Viator (FR-017).
- **Alternatives:** calling Viator during the guest's request with a 1-hour cache (a slow or failing
  partner would slow the guide, SC-005); daily ingestion (breaks the terms).

## R3. Civitatis: a curated list

- **Decision:** `packages/integrations/catalog/experiences.json`, reviewed in pull requests, holds a few
  entries per destination key (R5): Civitatis product URL (no `aid`), category, title and a short
  description in Spanish and English written by Guidesk, duration, price from and currency (optional),
  and no photo (cards show the category illustration). The `aid` is added at redirect time from
  configuration. Entries have no expiry. A validation test checks URLs (HTTPS, Civitatis domains, no
  query string), categories, and text lengths.
- **Rationale:** FR-014's fallback without a feed; no copied partner content or photos.
- **Alternatives:** a back-office editor (no back-office exists yet; the list is small during the pilot).

## R4. Refresh job and active destinations

- **Decision:** `explore.refresh`, cron every 30 minutes. Active destinations: distinct destination keys
  of active properties with a published guide whose Explore settings don't turn experiences off. Per
  destination and partner: one search per language with a 10-second timeout; upsert by
  `(partner, product_id, destination_key, language)`; delete that destination's rows not returned; record
  the result on `experience_destination`. After 3 consecutive partner failures in one run, the run skips
  that partner. Weekly, `explore.references` refreshes Viator's destinations and tags. Rows expired for
  more than a day are deleted by the run.
- **Rationale:** FR-015, FR-016; bounded calls (2 languages × destinations × 48 runs a day: under 2,000
  calls a day for 20 pilot destinations).
- **Alternatives:** refreshing on settings changes only (prices go stale beyond the 1-hour rule).

## R5. Destination keys and partner mapping

- **Decision:** a property's destination key is `{country}:{city}` normalized (lowercase, accents
  removed, spaces to hyphens), for example `cr:samara`; no city means no destination (FR-001 falls back
  to tips). Viator mapping: match the city name (normalized) against Viator destinations of type city
  within the country; else the region; else none. The curated file may pin a Viator destination ID per
  key (`viatorDestinationId`) to fix ambiguous names. The mapping is stored on `experience_destination`.
- **Rationale:** FR-014, edge cases (no city, unknown city).
- **Alternatives:** coordinates (properties have no geocoding yet).

## R6. Categories

- **Decision:** `tours`, `food_drink`, `outdoor`, `water`, `culture`, `day_trips`, `other`. Viator tags
  (weekly cache with English names and parents) map by keyword rules on the tag and its ancestors (for
  example "Food & Drink", "Cooking Classes" → `food_drink`; "Water Sports", "Snorkeling", "Boat Tours" →
  `water`; "Day Trips" → `day_trips`; "Museums", "Cultural" → `culture`; "Nature", "Adventure", "Hiking",
  "Zipline" → `outdoor`; "Tours" → `tours`); first matching rule in that order wins; unmatched → `other`.
  Curated entries carry their category.
- **Rationale:** FR-020; stable categories for host settings regardless of partner taxonomy changes.

## R7. Selection

- **Decision:** pure domain function: drop hidden categories and hidden experiences, then rank Guidesk's
  curated entries first (hand-picked for the destination), then partner products by
  `rating × log10(reviews + 10)`, with products under 10 reviews or without a rating last; take at most
  4 per category, at most 12 in total, then group by category in a fixed order.
  Ties break by partner order (Viator, Civitatis) and product ID, so the list is stable.
- **Rationale:** FR-018; deterministic and testable.

## R8. Click redirect

- **Decision:** `GET /api/v1/guest/guides/{publicId}/experiences/{ref}/go?lang=es[&c=1]` on the guide
  origin (the guide's CDN already routes `/api/v1/guest/*` to the API). `ref` is `viator-{code}` or
  `civitatis-{entryId}` (`^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$`). The API recomputes the property's
  selection (R7) and redirects (`302`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`) only
  when `ref` is in it and the stored URL is HTTPS on an allowlisted host (`viator.com`, `www.viator.com`,
  `civitatis.com`, `www.civitatis.com`); Civitatis gets `aid` appended. Anything else redirects to
  `/g/{publicId}/{lang}/explore`. No query parameter can set the destination (AC-SEC-001).
  Counting: the guest page script adds `c=1` the first time a browser taps that experience on a day
  (local storage), as for guide opens (spec 004 research R13); the API counts only with `c=1`, a
  non-automated user agent, and within 60 per network address per hour; nothing about the guest is
  stored.
- **Rationale:** FR-007 to FR-010; same counting model as guide opens.
- **Alternatives:** linking straight to the partner (no count, and partner URLs would sit in cached
  HTML longer than the 1-hour rule).

## R9. Guest pages and data

- **Decision:** the guest API adds `GET /api/v1/guest/guides/{publicId}/explore?lang=` (tips, grouped
  experiences, disclosure; `s-maxage=60`) and `explore: { visible }` in the guide response (for the
  navigation). The guest app adds `/g/{publicId}/{lang}/explore` and `/g/{publicId}/{lang}/explore/{ref}`
  (server-rendered like section pages), an Explore entry in the navigation, and a small script change
  (the `c=1` marker; "Book" disabled offline). Photos come from Viator's image hosts, listed in the guide
  configuration (`EXPERIENCE_IMAGE_ORIGINS`) and added to the guide's CSP `img-src`; the page's
  `Referrer-Policy: no-referrer` covers images and links; images have `width`, `height`, and
  `loading="lazy"`. Partner text is rendered as text nodes (React escaping), never as HTML. The service
  worker caches Explore pages like section pages and never the redirect. Explore opens are counted with
  the existing opens route (`kind: "explore"`) into `explore_open_daily`.
- **Rationale:** FR-001 to FR-006, FR-009, FR-011, FR-028; no new client framework or widget.

## R10. Settings

- **Decision:** `explore_settings` rows: one per workspace (`property_id` null) and one per property
  that has its own settings (`follows_default` false) or hidden experiences. Effective settings: the
  property row when it doesn't follow the default, else the workspace row, else defaults (on, nothing
  hidden). Hidden experiences are always per property. Routes need `properties.manage` (owners and
  admins, as guide editing); agents read. Writes carry a `version` (409 `settings_changed` on conflict,
  as in spec 007) and log `explore.settings_changed` (SEC-16). Guest pages see changes within the guide
  cache time (60 seconds, FR-025).
- **Rationale:** FR-021 to FR-025.

## R11. Assistant and copilot

- **Decision:** `KnowledgeInput` gains `exploreUrl` (string or null). When set, the knowledge adds a
  line: "Tours and activities near the property: the guide's Explore page, {url}". The reply job sets it
  when Explore is visible for the property (tips or selected experiences), using the property link and
  the reply language; the copilot always passes null (FR-027). The guide origin already passes the link
  check. No partner content enters the knowledge (FR-026). New eval cases: a guest asking about tours
  gets a reply with the Explore link (es, en) and never a partner name.
- **Rationale:** FR-026, FR-027, PC-10; the smallest change to the assistant, covered by evals
  (constitution V).

## R12. Configuration, secrets, and retention

- **Decision:**
  - `EXPERIENCES_MODE`: `fixtures` (synthetic Viator responses from a local adapter; default outside
    production) or `live` (required in production).
  - `VIATOR_API_KEY` (worker secret; SST secret `ViatorApiKey` with the placeholder `unset`, treated as
    absent) and `VIATOR_API_URL` (default `https://api.viator.com/partner`).
  - `CIVITATIS_AFFILIATE_ID` (API; numeric; absent hides curated Civitatis entries).
  - `EXPERIENCE_IMAGE_ORIGINS` (guide app; HTTPS origins for partner photos).
  - Retention: experience rows are deleted a day after they expire; partner references are replaced
    weekly; open and click counts follow guide open counts (spec 010 decides their dashboard window).
- **Rationale:** FR-019, SEC-13; deployments without accounts keep working (host tips only).

## R13. Founder gates and implementation notes

- **Gates:** join Viator's affiliate program and set `ViatorApiKey`; join Civitatis's program and set
  `CIVITATIS_AFFILIATE_ID`; ask Civitatis for its feed or API; confirm each partner's content terms and
  Viator's Spanish support with the live key; curate Civitatis entries for the pilot destinations; the
  legal review of the disclosure (OQ-35); a staging check on a phone.
- **Notes (implementation, 2026-11-18):**
  - Ranking: Guidesk's curated entries come first (they are hand-picked), then partner products by
    rating and reviews; ranking unrated curated entries last would have hidden them behind any full
    Viator list (R7 updated).
  - The Explore pointer is a knowledge line, not a section: section IDs are stored as UUIDs, so the
    assistant can't cite it. Answer rule 13 allows sharing the link for tour questions as a "general"
    answer; the fake model can't exercise the wording, so a worker test checks the knowledge and the
    copilot's absence of it, and 3 eval cases (plus 1 copilot case) gate the real model.
  - Explore opens from a tile on the guide home; the guide has no bottom bar yet (FR-001 updated).
  - Partner photos show only from hosts in `EXPERIENCE_IMAGE_ORIGINS`; others fall back to the
    category illustration, so a missing or wrong setting never shows a broken image. Confirm Viator's
    image hosts with the live key.
  - The worker runs one refresh at start, so a deploy or a fresh local stack has experiences at once.
  - `ViatorApiKey` is an SST secret with the placeholder `unset` (treated as absent), so deploys work
    before the account exists; `EXPERIENCES_MODE=live` and the optional `CIVITATIS_AFFILIATE_ID` and
    `EXPERIENCE_IMAGE_ORIGINS` come from the stage configuration. The curated file ships empty; tests
    use their own synthetic catalog.
  - Timings (local, Testcontainers): the guest Explore route, the redirect, and the settings routes
    stay within budget with 60 products in two languages (`apps/api/test/integration/explore.perf.test.ts`).
  - Local quickstart (2026-11-18, fixtures): scenarios 1 to 3 ran as `e2e/specs/explore-us1.spec.ts`
    to `explore-us3.spec.ts` and passed, with the accessibility checks for Explore, the detail, and the
    settings screens; scenario 4 is covered by the worker's refresh tests and scenario 5 by the
    pointer tests and evals. The live partner checks remain for staging.
