# Research: Brand Presence and Responsive Shell

## R1. Where the icons and illustrations live

- **Decision**: In `@guidesk/ui` (`src/icons`, `src/illustrations`), as React components with no
  hooks and no `"use client"`, so both the portal (server components) and the guide (server render)
  use them.
- **Rationale**: One source for both apps; the package already serves both.
- **Alternatives considered**: A copy per app (drifts); an SVG sprite file loaded by URL (an extra
  request, and `<use>` across files is awkward under CSP).

## R2. Inline SVG instead of a sprite

- **Decision**: Each icon renders its own small inline `<svg>` (24 × 24 view box, `fill="none"`,
  `stroke="currentColor"`, width 2, round caps and joins, `aria-hidden`, `focusable="false"`).
- **Rationale**: Server-rendered, so no JavaScript; a guide home with 12 tiles adds about 4 KB of
  HTML, about 1 KB compressed. The brand guide's "one inline sprite" goal (no icon fonts or
  libraries, about 20 icons) is met in spirit; the guide records this choice.
- **Alternatives considered**: A per-page `<symbol>` sprite with `<use>` (saves a little HTML but
  needs a sprite in every document and complicates the portal's streamed layout).

## R3. Keeping icons out of the portal bundle

- **Decision**: Icon data is exported one constant per icon (tree-shakable; the package declares
  `"sideEffects": false`). The name registry (kind → icon) is imported only by server code. The
  signed-in header is a client component, so the server layout renders the navigation icons and
  passes them as React nodes; they travel in the server payload, not in the bundle.
- **Rationale**: The heaviest portal route had about 1 KB of headroom. Client components import
  only the few icons they show.
- **Alternatives considered**: An `<Icon name>` with a map in client code (pulls every icon into
  every bundle).

## R4. Marking the current page

- **Decision**: A tiny client `NavLink` reads the path (`usePathname`) and sets `aria-current` and a
  class; a destination is current when the path equals or starts with its base (Team owns
  `/settings/members`, Settings owns the rest of `/settings`).
- **Rationale**: Layouts persist across client navigation, so a server-computed mark would go stale.
- **Alternatives considered**: A request header read in the layout (stale after client navigation).

## R5. The More list without JavaScript

- **Decision**: The HTML `popover` attribute with `popovertarget` on the More button.
- **Rationale**: Light dismiss (Escape and outside tap), top-layer rendering, and focus return come
  from the browser, with no script; supported by every target browser.
- **Alternatives considered**: `<details>` (no Escape or outside dismiss); a client menu (bundle).

## R6. Breakpoints and widths

- **Decision**: Compact < 600 px and medium 600–1023 px use the bottom bar; expanded ≥ 1024 px uses
  a 15rem sidebar. Content max width 75rem; forms and reading text at 40rem (`.page-narrow`); grids
  use `repeat(auto-fill, minmax(min(100%, 18rem), 1fr))`. At 200% zoom on a 1280 px window (an
  effective 640 px) the medium layout applies by itself, since media queries use CSS pixels.
- **Rationale**: Matches design system §4; no JavaScript.

## R7. No cut-off text

- **Decision**:
  - Remove `hyphens: auto` and `overflow-wrap: anywhere` from tiles; tile titles use
    `overflow-wrap: break-word` with `hyphens: manual`.
  - Guide tiles become rows (icon in a tinted circle, title, and a chevron): one column under
    560 px, two columns from 560 px. At 320 px a full-width row gives about 200 px to the title, so
    "Electrodomésticos" (about 160 px at 16 px semibold) fits whole.
  - Remove the ellipsis from the guide's top bar name and the workspace switcher name; they wrap.
  - Chips and buttons drop `white-space: nowrap` and fixed heights in favor of `min-height`.
  - User-entered strings (names, emails, links) keep `overflow-wrap: anywhere`, which breaks only a
    word that cannot fit on any line.
  - Data tables stay `nowrap` inside their own horizontal scroll container (allowed by WCAG 1.4.10).
- **Rationale**: The founder's requirement; at two columns, 320 px leaves about 114 px per tile,
  which cannot hold the longest Spanish titles whole.
- **Alternatives considered**: Smaller type in tiles (still breaks with larger text settings).

## R8. Illustrations and theming

- **Decision**: Nine illustrations (door, welcome, no properties, inbox clear, no requests, no
  data, offline, unavailable, wait) drawn on a 240 × 160 view box from flat shapes; each shape
  carries a class (`il-terra`, `il-terra-soft`, `il-sol`, `il-arena`, `il-line`, `il-bg`) whose fill
  comes from CSS tokens defined in each app for light and dark mode. `aria-hidden`, fixed
  `width`/`height` attributes to reserve space.
- **Rationale**: The CSP forbids inline `style` attributes, and presentation attributes cannot use
  `var()`; classes can. Fixed sizes keep CLS at 0.

## R9. Google "G" mark

- **Decision**: The standard four-color Google "G" as a static SVG in `apps/portal/public/brand/`,
  shown at 18 px on the existing Google button, with the existing label.
- **Rationale**: Google's sign-in branding guidelines ask for the "G" on custom buttons and allow
  the label "Continue with Google". Served from Guidesk's origin (CSP `img-src 'self'`).

## R10. Free-plan credit

- **Decision**: The API adds `credit: boolean` to the guest guide payload, true only when the
  workspace plan is `free`; the guest target query joins `workspace.plan`. The guide renders the
  footer when `credit` is true. Missing or unreadable plan → false.
- **Rationale**: The plan lives on the server; the guide never trusts a client value. Guide pages
  are cached for 60 s at the CDN, so a plan change shows within about a minute.

## R11. Link previews

- **Decision**: Guide pages add `og:title` (property name), `og:description` (fixed, per
  language), `og:image` (`{PORTAL_URL}/brand/og-{lang}.png`), `og:type` website, `og:locale`, and
  `twitter:card` `summary_large_image`. The same values for public and stay links; stay pages
  already render from the public guide data. Public pages add the image to the existing
  `openGraph` metadata and a `twitter` block.
- **Rationale**: Messaging apps read these tags; the portal origin already serves brand assets.

## R12. Preview images

- **Decision**: `docs/brand/build/og.mjs` composes a 1200 × 630 SVG (cal background, the logo from
  the brand files, the tagline in carbón, a terracota arch and sol circle) and rasters it with
  `sharp` to `apps/portal/public/brand/og-es.png` and `og-en.png`, checked into the repository.
  The tagline text uses the build machine's system sans serif; the files are reviewed when
  regenerated.
- **Rationale**: Static, cacheable, no runtime image generation.
- **Alternatives considered**: Next.js `ImageResponse` at runtime (adds a server route and a font
  file).

## R13. Four columns in the bottom bar

- **Decision**: The bottom bar shows Inbox, Requests, Properties, and More; Analytics joins Shared
  content, Team, and Settings under More. The sidebar keeps Analytics in the first group.
- **Rationale**: At 320 px, five columns leave about 58 px per label; "Estadísticas" (about 68 px at
  11–12 px semibold), "Propiedades", and "Solicitudes" cannot fit whole, and the founder asked for
  no cut text. Four columns leave about 74 px. Hosts on a phone answer guests and requests far more
  often than they read analytics.
- **Alternatives considered**: Shorter labels only in the bar (two names for one place); 10 px
  labels (too small); icon-only items (icons never replace labels, FR-015).

## R14. Stay-link previews

- **Decision**: The stay-link page gets a generic preview title ("Tu guía de estadía") with the
  fixed description and the branded image.
- **Rationale**: The page never looks the token up before the guest opens it (feature 004 research
  R5), so it cannot know the property; a generic preview also keeps stay links from revealing
  anything when forwarded.
