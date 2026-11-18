# Research: Guest Guide

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-17

Each entry gives the decision, the rationale, and the alternatives considered. This feature serves
what feature 003 publishes (versions, locked fields, the reveal service, media) and uses the stays
of feature 002. Facts measured in this repository on 2026-11-17 are marked **measured**.

## R1. Modules

- **Decision:** the feature adds:
  - **Domain (`packages/domain/src/guest/`):** link and token formats, the confirmation-code
    alphabet, the stay window (R6), the lock state of a field for a session, the lockout backoff
    (R8), emergency numbers by country (R18), and the plain-text message builder (R14). Pure
    TypeScript, no I/O.
  - **API modules (`apps/api/src`):** `guest` (the public routes under `/api/v1/guest`, R2) and
    `share` (the workspace routes behind the Share screen, R14).
  - **Guest app (`apps/guide`, new):** server-rendered HTML for the guide pages, a small browser
    script, and a service worker (R3).
  - **Portal:** the Share screen (H-16) and the printable poster.
  - **Worker:** new rules in `retention.daily` (R16). No new queue.
- **Rationale:** the same layering as features 002 and 003 (constitution IV). The rules that decide
  whether a guest sees a code (window, verification, lockout) are testable without a database.
- **Alternatives:** putting guest routes in the `guides` module was rejected: guest routes run
  without a member session and need their own guard, headers, and rate limits.

## R2. Origins and routing

- **Decision:** the guide gets its own CloudFront distribution with AWS WAF (`GuideRouter`), on the
  guide domain in production (`GUIDESK_GUIDE_DOMAIN`, required for production like the portal and
  API domains; OQ-11 picks the name). It routes:
  - `/api/v1/guest/*` to the API load balancer, as the portal's router does for `/api/*`, so the
    guest session cookie is host-only on the guide origin and every guest call is same-origin;
  - everything else to the guide app (R3).
  The API learns the guide origin from `GUIDE_URL`. Its origin hook (feature 001 T103) accepts the
  guide origin on `/api/v1/guest/*` only and the portal origin everywhere else; the guest guard
  refuses `/api/v1/guest/*` calls that carry the portal origin. Locally the guide runs at
  `http://127.0.0.1:3001` (a different host from the portal's `localhost:3000`, so the two cookie
  jars never mix) and proxies `/api/*` to the API on port 4000.
- **Rationale:** SEC-11 asks for separate origins for the portal, the guide, user content, and the
  API. Routing the guest API through the guide's own distribution keeps cookies host-only and
  avoids CORS, exactly like the portal (ADR-0009, feature 001 R2).
- **Alternatives:** calling the API's own domain from the guide with CORS and a cross-site cookie
  was rejected (`SameSite=None` weakens CSRF protection and SEC-02 asks for `Lax`). Having the guide
  server proxy every guest call was rejected: per-IP limits would see the server's address.

## R3. Guest app rendering

- **Decision:** `apps/guide` renders HTML on the server with React (`react-dom/server`) and never
  hydrates it. Interactive parts (language memory, lock states, Show code, the confirmation form,
  the offline banner, the open count) are progressive enhancements in one small browser script
  (TypeScript bundled by esbuild, budget 15 KB gzip) plus a service worker (R9). The app is a
  web-standard `Request → Response` handler with a few routes (R10), run by a small Node HTTP
  server locally and by an AWS Lambda function behind `GuideRouter` in AWS. Static files (script,
  styles, icons, manifest) are bundled with content hashes and served with
  `Cache-Control: public, max-age=31536000, immutable`.
- **Rationale:** performance.md caps initial JavaScript at 100 KB gzip per guest route. The
  Next.js App Router runtime alone is about 117 KB gzip in this repository (**measured**:
  `rootMainFiles` of the portal build total 128.8 KB gzip, of which 113 KB are React DOM and the
  router runtime), so a Next.js guide would break the budget before any guide code. Server-only
  React keeps one component language across the monorepo, no new runtime or vendor, and makes the
  guide work with scripts disabled except for Show code and the confirmation form.
- **Alternatives:**
  - Next.js (the architecture overview's first choice): over budget, as measured.
  - Preact, Astro, or Hono JSX: smaller runtimes but new frameworks to learn and maintain
    (constitution VII); server-only React reaches the same result without them.
  - Rendering guide HTML inside the API service: no extra deploy unit, but it couples guest
    traffic to the API's capacity and mixes host and guest surfaces in one process; a Lambda behind
    the CDN scales with guest traffic on its own.
- **Follow-up:** ADR-0010 records the change from Next.js, and the architecture overview is updated.

## R4. Links, tokens, and confirmation codes

- **Decision:**
  - **Property link:** `public_id` of 26 characters from the base32 alphabet `a-z2-7` (130 bits from
    `crypto.randomBytes`), lowercase so QR codes stay small and addresses are easy to read. URL
    `{GUIDE_URL}/g/{public_id}`. One active per property; regenerating marks the old one `replaced`.
  - **Stay token:** 32 random bytes in base64url (43 characters, 256 bits), as for invitation
    tokens (feature 001). Stored as its SHA-256 hash for lookup and as vault ciphertext (per-workspace
    data key, AAD bound to the row) so the host can copy the same link again. URL
    `{GUIDE_URL}/s/{token}`.
  - **Confirmation code:** 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31 symbols, no 0, 1,
    I, L, or O; about 29.7 bits), one per stay link, stored as vault ciphertext. Comparison
    normalizes case and spaces and uses `timingSafeEqual` on equal-length buffers.
  - Tokens and codes never appear in logs, job payloads, security-event metadata, or error
    reports; the request logger redacts `/s/{token}` paths.
- **Rationale:** SEC-01 and SEC-02 ask for at least 128 random bits and no guessable identifiers.
  Storing the stay token encrypted (not only hashed) is what lets the host copy a link twice
  without breaking the one already sent. A 6-symbol code meets SEC-03's minimum while staying easy
  to type on a phone; its strength comes from the lockout (R8), not from its length.
- **Alternatives:** storing only the hash and regenerating the link on every copy was rejected (it
  silently breaks links already sent). Numeric 6-digit codes were rejected: 20 bits is weaker for
  the same typing effort. UUIDs for the property link were rejected: they look sequential to some
  readers and make QR codes denser.

## R5. Stay sessions and the token exchange

- **Decision:**
  1. `GET /s/{token}` on the guide app returns a tiny page that never looks the token up (no-store,
     `noindex`, `Referrer-Policy: no-referrer`). Its script posts the token to
     `POST /api/v1/guest/stay-sessions`, then calls `location.replace()` with the address the API
     returns, so the token leaves the address bar and the history entry. Without scripts, a button
     submits the same request as a form post, answered with a `303` redirect.
  2. The API hashes the token, finds the stay link, checks it is working (R6) and under the device
     limit (10), creates a `guide_session` row, and sets the cookie `__Host-guidesk_guest`
     (`guidesk_guest` on plain-HTTP local runs): 32 random bytes, `HttpOnly`, `Secure`,
     `SameSite=Lax`, `Path=/`, no `Domain`, `Max-Age` up to the end of the stay window. Only the
     cookie's SHA-256 hash is stored.
  3. The response names the guide address `/g/{public_id}` and, for a stopped link or the device
     limit, a notice code shown once on the guide home. Unknown tokens get the same `404` body as
     every unavailable link (FR-054).
  4. A device that already has a session for the same stay link reuses it (no new device).
- **Rationale:** link previewers in OTA and messaging apps fetch the URL but do not run scripts or
  post forms, so they neither consume a device slot nor see a session (FR-026). `location.replace`
  removes the token from history, which a `302` alone does not.
- **Alternatives:** exchanging on the `GET` with a `302` was rejected because previews would create
  sessions and count as devices. Putting the session in `localStorage` with a bearer header was
  rejected (readable by scripts; SEC-02 asks for `HttpOnly`).

## R6. The stay window

- **Decision:** a pure function computes, for a stay and its property:
  `opensAt` = 00:00 on the check-in date in the property's time zone, and
  `closesAt` = the checkout time on the checkout date in that zone plus 2 hours, using the stay's own
  times when set and the property's otherwise (spec 002 FR-052). Local times convert to instants with
  `Intl.DateTimeFormat` offsets (two-pass, correct across DST changes, though Costa Rica has none).
  A stay link is **working** when it is `active`, its stay is `active` (not cancelled, hidden, or
  deleted), and `now < closesAt`. A session's lock state is one of `public` (no session),
  `before` (with `opensAt`), `inside`, `ended`. The API always uses its own clock.
- **Rationale:** FR-027 and the 2026-11-17 clarification. Computing from the stay row at request
  time makes date changes from feeds or PMS imports apply at once (acceptance scenario US2-9) and
  lets revocation and cancellation take effect on the next request (SC-005), with nothing cached.
- **Alternatives:** storing `expires_at` on the link was rejected: it goes stale when a feed moves
  the dates. `Temporal` is not enabled by default in Node 24.

## R7. Showing codes to guests

- **Decision:** `POST /api/v1/guest/reveals` with `{fieldId}` checks, in order: a session cookie for
  a working stay link; the field belongs to that property and is referenced by the published
  version (or is the Wi-Fi password); lock state `inside`; verification passed when the property
  requires a code (R8); 30 reveals per session per hour. Then it records the security event
  `restricted_value.guest_revealed` (metadata `propertyId`, `fieldId`, `kind`, `stayId`, `sessionId`; no
  actor, no network address) and calls feature 003's `RevealService.valueOf`, the only decrypt path.
  Responses carry `Cache-Control: no-store` and `Pragma: no-cache`. The browser script puts the value
  in the DOM only after the tap and removes it when the page is hidden for more than 5 minutes.
- **Rationale:** SEC-06 keeps one decrypt path; reusing it means guest reveals inherit its tests and
  the vault lint rule. Recording reveals as security events puts them in the reveal history owners
  and admins already see (feature 003, 2026-11-17 clarification), satisfying SEC-16.
- **Alternatives:** embedding values in the HTML for verified sessions was rejected: the HTML is
  cached by the CDN and the service worker (SEC-04).

## R8. Verification and brute-force limits

- **Decision:** when `guide.require_confirmation_code` is on, `POST /api/v1/guest/verify` compares
  the code (R4). Failures count in three places, each 5 per 15 minutes:
  - per session and per network address with the existing PostgreSQL `RateLimitService`
    (keys `guest-verify:session:{id}` and `guest-verify:ip:{sha256(ip)}`), and
  - per stay on the `stay_link` row (`failure_count`, `failure_window_started_at`), so attempts
    spread over many devices still lock the stay.
  At 5 failures in any scope, the stay locks: `locked_until = now + 15 min × 2^(lockout_count)`,
  capped at 24 hours; `lockout_count` resets after 24 hours without a lockout. Each lockout records
  `guide.verification_locked` and sends one email to the owners and admins (contracts/emails.md)
  through the existing notices service, as the reveal-limit alert does. Success sets `guide_session.verified_at`, clears the stay's
  failure window, and never resets the lockout count.
- **Rationale:** SEC-03 verbatim (limits per IP, session, and stay; 15-minute lockout after 5
  failures; backoff; host alert). Per-stay counting on the row is what stops an attacker who rotates
  devices and addresses.
- **Alternatives:** a CAPTCHA was rejected for the MVP (friction for every guest; SEC-07 reserves the
  bot challenge for abuse signals). Counting only per IP was rejected (mobile carriers share
  addresses, and attackers rotate them).

## R9. Offline and caching

- **Decision:**
  - **CDN:** public guide pages and the public guide data are served with
    `Cache-Control: public, max-age=0, s-maxage=60, stale-if-error=86400`,
    so a published change reaches guests within about 1 minute, and the guide still opens from the
    CDN for a day if the API or the guide app is down (performance.md §2, NFR-02). No
    `stale-while-revalidate`: browsers apply it as well and would show an unpublished guide once
    more (found in the US1 end-to-end test). Everything
    personal (`/api/v1/guest/session`, `reveals`, `verify`, `stay-sessions`, `opens`) is
    `no-store`. The guide pages never contain session state, so caching them is safe.
  - **Service worker** (`/sw.js`, scope `/`, plain JavaScript): pages under `/g/` are
    network-first with a 4-second timeout, falling back to the cached copy; static files are
    cache-first; guest media are cache-first by their stable address (R11). It never stores
    responses from `/api/v1/guest/` other than media, and never stores a response marked
    `no-store`. When it serves a page from cache it sets `data-offline-at` on the root element of the
    cached HTML, and the page script shows the "Offline, saved copy from …" banner. A network `404`
    for a cached guide removes that guide's pages and media from the cache. Pages never opened fall
    back to an offline page that says the page is not saved.
  - **OQ-28:** no offline saving of codes (spec clarification); the lock state is fetched live.
- **Rationale:** SEC-04 and FR-045 to FR-047. A 60-second shared cache is the simplest way to keep
  most guest traffic off the API (performance.md "static first") while honoring FR-004's view-time
  facts closely enough; locked values are never in cached responses at all.
- **Alternatives:** on-demand CDN invalidation on every publish was rejected for the MVP (more moving
  parts for a gain of under a minute); it can be added if hosts notice the delay. Caching pages
  only after an explicit "Save for offline" tap was rejected: FR-045 asks for automatic saving.

## R10. Guest app routes and language

- **Decision:**
  - `/g/{id}`: chooses the language (the `guidesk_lang` cookie set by the language switch, else
    `Accept-Language` among `es`, `en`) and redirects with `302` and `Cache-Control: private,
    no-store` to `/g/{id}/{lang}`.
  - `/g/{id}/{lang}`: the home; `/g/{id}/{lang}/{sectionId}`: a section; `/g/{id}/{lang}/emergency`:
    the Emergency page. A language the guide does not publish redirects to the guide's primary
    language (the first of the property's guide languages). These pages are cacheable (R9).
  - `/s/{token}`: the exchange page (R5). `/offline`: the offline fallback. `/`: a short page saying
    guides open from the host's link.
  - The language switch is a plain link to the other language's page that also sets
    `guidesk_lang` (1 year, `SameSite=Lax`, readable by the script; not personal data).
  - Texts come from `packages/i18n` (new `guest` namespace in `es.json` and `en.json`) through
    `use-intl`'s `createTranslator` on the server; the browser script reads its strings from
    `data-` attributes, so it ships no messages.
- **Rationale:** language in the path keeps the CDN cache key simple (no `Vary` on cookies) and makes
  each language's page cacheable (FR-013 to FR-015). `use-intl` is already in the lockfile as
  `next-intl`'s core, so it adds no new package.
- **Alternatives:** varying one URL on `Accept-Language` was rejected (poor CDN hit rates and
  inconsistent caches).

## R11. Rendering content and media

- **Decision:**
  - The guest data comes from `GET /api/v1/guest/guides/{id}?lang=`, built by feature 003's preview
    assembly (`PublishService.preview` with `source: "published"`) run in the system context for the
    resolved workspace and property (R12), plus the property's time zone, country, check-in and
    checkout times, the public Wi-Fi value, benefit flags, and the guide's languages.
  - Documents render with feature 003's shared `GuideDocumentView` (`packages/ui`, built for this
    feature): paragraphs, headings 3 and 4, lists, bold, italic, links, and `lockedField` nodes,
    which the guest app renders as a lock placeholder with the field label and a Show code control,
    never a value. Links render only for `https:`, `http:`, `mailto:`, and `tel:`, with
    `rel="noopener noreferrer nofollow"` and `target="_blank"`; anything else renders as text
    (AC-SEC-010). React escapes all text; no `dangerouslySetInnerHTML`.
  - **Media:** item media point to `/api/v1/guest/media/{publicId}/{mediaId}/{variant}`, which checks
    the media belongs to that guide's published version and answers `302` to a presigned GET on the
    media bucket (5-minute expiry; `Cache-Control: public, max-age=60`). Pages set `width` and
    `height` from `media_object` and `loading="lazy"` after the first image; videos use
    `preload="none"` with the poster variant.
- **Rationale:** reusing the preview assembly means guests see exactly what the host previewed
  (spec 003 FR-054) and inherits its tests. Stable media addresses let the service worker cache
  images across presigned-URL rotations (FR-045).
- **Alternatives:** a separate guest snapshot format was rejected (two renderings of one version
  drift). Serving media bytes through the API was rejected (bandwidth through Fargate).

## R12. Data access for guest routes

- **Decision:** guest routes have no member and therefore no request RLS context. A `GuestContext`
  helper resolves the link (property link `public_id` or session cookie hash) with one query in the
  system context (the owner connection, as worker jobs and the reveal service do), refuses unless the
  guide is published, the property is active, and the workspace is `active`, and then runs the
  request inside `RequestDb.run` with a system transaction, passing the resolved `workspaceId` and
  `propertyId` explicitly to every query. Guest code never accepts a workspace or property ID from the
  client. The cross-tenant suite gains guest cases (AC-SEC-015), and a lint rule limits imports of the
  system handle in `apps/api/src/guest/` to `guest-context.ts`.
- **Rationale:** the reveal service and the worker already read tenant data this way (feature 003
  migration 0019); a new database role with guest policies on ten tables would add risk without a
  clear gain while every guest query is scoped by IDs that come only from a hashed secret.
- **Alternatives:** a `guidesk_guest` role with per-table policies keyed on a
  `app.guest_property_id` setting was considered; it is recorded as a hardening option for the
  security review before public launch (SEC-19), not for the MVP.

## R13. View counts

- **Decision:** the browser script sends `POST /api/v1/guest/opens` with `{publicId, kind}` once per
  link, device, and day (deduplicated with a `localStorage` date per link; no identifier). The API
  upserts `guide_open_daily (property_id, day, link_kind)` with `opens = opens + 1`, `day` in the
  property's time zone. Stay link figures come from existing rows: devices = `guide_session` count,
  first opened = earliest `created_at`, values shown = `restricted_value.guest_revealed` events for
  the stay. Requests whose `User-Agent` matches a bot list are ignored, and scripts do not run for
  link previews, so they are not counted.
- **Rationale:** FR-049 and FR-050 with no device identifier at all. Counting from the browser is the
  only option once pages are CDN-cached.
- **Alternatives:** counting at the CDN from logs was rejected (needs a log pipeline and counts
  previews).

## R14. The Share screen, QR codes, and messages

- **Decision:**
  - **Portal page** `/[locale]/properties/[propertyId]/share` (H-16) with three cards (property link
    and QR, scheduled-message template, upcoming stays) and the PC-01 reminder; a print page
    `/[locale]/properties/[propertyId]/share/poster` with the QR code, the property name, the Wi-Fi
    network name, and the public-guide line, styled for A4 and Letter.
  - **QR codes** are generated by the API with `qrcode` (MIT, server only): SVG and PNG at error
    correction level M, encoding the property link; served with `Content-Disposition: attachment`.
  - **Messages** are plain text built by a domain function from the published version's Arrival and
    Wi-Fi sections (feature 003 `docPlainText`), the property's current facts, and message templates
    in `packages/i18n`. Locked fields become `{label} (shown in your stay link)` unless the host asks
    for values, in which case the API resolves them through the reveal service after the step-up and
    records `restricted_value.exported`. The template and messages pass feature 003's off-platform
    phrase check (PC-06) in a unit test.
  - **Endpoints** live in a `share` module (contracts/http-api.md). Stay link routes and the stay list
    are owners and admins only; agents get the property link, the template, and the QR code.
- **Rationale:** FR-037 to FR-044. Server-side QR generation keeps the portal bundle unchanged and
  gives hosts files they can print. One message builder serves both languages and both variants.
- **Alternatives:** client-side QR generation was rejected (about 25 KB more on a portal route that is
  already near its budget for some pages).

## R15. Security headers for the guest app

- **Decision:** every guest app response sets:
  `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self' {media origin} data:; media-src 'self' {media origin}; connect-src 'self';
  manifest-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`,
  `X-Content-Type-Options: nosniff`, `Cross-Origin-Opener-Policy: same-origin`,
  `Permissions-Policy` with every feature off, and HSTS on HTTPS. Pages also carry
  `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">`.
  Guest API responses get the same `noindex` and referrer headers.
- **Rationale:** SEC-02 and SEC-11. With no inline script or style at all, `'self'` is stricter than
  a nonce and works with CDN-cached HTML, where a per-response nonce cannot.
- **Alternatives:** a nonce-based CSP (the portal's) was rejected here: nonces in cached pages repeat
  across responses and stop meaning anything.

## R16. Retention

- **Decision:** `retention.daily` deletes stay links (with their sessions, by cascade) 30 days after
  their stay window closed or after they were revoked or replaced, and property links 30 days after
  they were replaced. `guide_open_daily` rows are kept (counts only) until spec 010 sets a period.
  Rate-limit buckets expire as today. Security events follow feature 001's retention.
- **Rationale:** FR-055 and SEC-20.

## R17. Roles, step-up, and limits

- **Decision:** reuse `WorkspaceAction` (feature 001) and the existing capabilities: any member reads
  the Share screen's property part; `restricted.reveal` (owners and admins) guards stay links, the
  stay list, and stay messages, because a stay link shows codes to whoever opens it;
  `properties.manage` (owners and admins) guards regenerating the property link and the
  confirmation-code setting. Step-up (10 minutes) on copying and regenerating stay links and on
  messages with values. Guest
  routes have a per-IP limit of 120 requests per minute (`guest:ip:{hash}`), 20 token exchanges per
  IP per hour, and the reveal and verification limits above. A refused guest request gets `429` with
  `Retry-After` and a plain page in the guest app.
- **Rationale:** FR-022, FR-044, FR-053, SEC-05, SEC-07.

## R18. Emergency numbers

- **Decision:** a domain table maps the pilot countries to their emergency number: CR 911, US 911,
  CA 911, MX 911, PA 911, CO 123, GT 110, NI 118, SV 911, HN 911, DO 911. Unknown countries show the
  host's Emergency section only.
- **Rationale:** FR-007. The list is short, versioned in code, and reviewed with pilot hosts.

## R19. Testing

- **Decision:**
  - **Unit (domain):** window edges (00:00, checkout + 2 h, DST in a US zone), token and code formats,
    code normalization, lockout backoff, lock-state table, message builder (both languages, with and
    without values, PC-06 phrases), emergency numbers.
  - **Integration (API, Testcontainers):** every guest route (public view, media redirect, exchange,
    session state, verify, reveal, opens) and share route, including roles, step-up, the device
    limit, lockouts across devices, revocation within one request, cancelled stays, and the headers
    (`no-store`, cookie attributes, `noindex`). A security review test (`security-review-004`) holds
    the abuse cases AC-SEC-001 to AC-SEC-015 that the API owns, with every log line searched for
    tokens, codes, and values. Cross-tenant cases for every new route. A timing test for SC-009 on the
    guest view and reveal.
  - **Guest app (Vitest):** the router, language choice, document renderer (links, locked fields,
    escaping), headers, and the service worker's routing rules (with a fake cache).
  - **End to end (Playwright, phone viewport):** `guest-us1` to `guest-us6`, including offline mode
    (`context.setOffline`), the token leaving the address bar and history, and the Share screen.
  - **Accessibility:** axe on every guest page and the Share screen, plus a manual screen-reader pass
    on the reveal flow (SC-003).
  - **Performance:** Lighthouse CI on guest pages served from a fixture guide (the guest app's
    `GUIDE_FIXTURES=true` mode, never set in AWS), a size check of the guest script and styles, and a
    k6 script for guide opens and reveals.
- **Rationale:** constitution V; SC-001 to SC-009.

## R20. Documentation and rollout

- **Decision:**
  - **ADR-0010** (guest guide rendered without a client framework); the architecture overview
    (containers table and repository layout); security.md (SEC-01 to SEC-04 marked implemented, the
    guest session and the confirmation code); open questions OQ-20 and OQ-28 (decided); UX README
    (gap 1 updated, verification screen no longer provisional).
  - **Rollout:** no feature flag; the guide is the product. Production needs `GUIDESK_GUIDE_DOMAIN`
    (with OQ-11) and the legal review of the disclosure and template wording (OQ-35) before the pilot.
    Both are founder gates, recorded in the quickstart, and do not block development.
