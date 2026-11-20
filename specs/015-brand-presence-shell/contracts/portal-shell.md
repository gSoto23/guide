# Contract: Portal Shell

## Layouts

| Width (CSS px) | Navigation | Content |
|---|---|---|
| < 600 | Top bar (logo, workspace switcher) and a bottom bar | One column, 16 px gutters |
| 600–1023 | Same as compact | Grids get two columns; 24 px gutters |
| ≥ 1024 | Sidebar 15rem (logo, switcher, all destinations); no bottom bar | Up to 75rem, centered in the remaining width |

## Destinations

| Destination | Path | Icon | Bottom bar | Current when the path starts with |
|---|---|---|---|---|
| Inbox | `/{locale}/inbox` | `inbox` | Yes | `/inbox`, `/properties/*/conversations` |
| Requests | `/{locale}/requests` | `bag` | Yes | `/requests` |
| Properties | `/{locale}/properties` | `house` | Yes | `/properties` (except conversations) |
| Analytics | `/{locale}/analytics` | `chart` | In More | `/analytics` |
| More | popover | `more` | Yes | Current when one of its entries is current |
| Shared content | `/{locale}/shared-content` | `layers` | In More | `/shared-content` |
| Team | `/{locale}/settings/members` | `people` | In More | `/settings/members` |
| Settings | `/{locale}/settings` | `sliders` | In More | `/settings` (except members) |

The bottom bar has four columns (three destinations and More), so every Spanish label fits whole at
320 px (research R13). The sidebar groups Inbox, Requests, Properties, and Analytics first, then
Shared content, Team, and Settings.

- The current entry has `aria-current="page"` and the class `is-current` (terracota-tinted
  background and a 3 px bar on its leading edge in the sidebar, a filled pill behind the icon in
  the bottom bar).
- Bottom bar items: icon above label, at least 44 × 44 px, labels wrap to two lines rather than cut.
- The bottom bar reserves its height at the end of the page (padding) and respects
  `env(safe-area-inset-bottom)`; it is hidden in print.

## Page header

```text
<PageHeader title help? action? />
```

`<header class="page-header">` with `h1`, an optional `p.muted`, and an optional action node placed
at the end on wide screens and below the title on compact screens. Used on inbox, requests,
properties, analytics, settings, and shared content.

## Empty state

```text
<EmptyState illustration title body? action? />
```

Illustration (decorative), `h2`, text, and one primary action. Used on properties (no properties),
inbox (nothing needs the host), requests (no requests), and analytics (no data yet).

## Auth layout (`(auth)` route group)

- Compact and medium: the logo (linking to the public home) at the top, a 160 px illustration, then
  the form.
- Expanded: two columns: the form panel (logo, form, consent line) and the brand panel (arena
  background, the `door` illustration at up to 360 px, the tagline in the page language as a
  paragraph).

## Breakpoint classes in CSS only

No JavaScript decides the layout; media queries at 600 px and 1024 px.
