# Contract: Guest Guide Brand

## Tiles

- Each home tile is a link row: the section icon in a 40 px tinted circle, the title, and a
  chevron. One column under 560 px, two columns from 560 px. Titles never hyphenate or truncate.
- Icons per section kind follow `SECTION_ICONS`; Extras uses `gift`, Explore uses `compass`.

## Credit footer (`GuestGuide.credit === true`)

```html
<p class="credit">
  <a href="{PORTAL_URL}/{lang}" target="_blank" rel="noopener">
    <svg class="brand-mark" width="18" height="18" aria-hidden="true">…</svg>
    Hecho con Guidesk
  </a>
</p>
```

The mark is inline SVG (the favicon geometry, drawn for 16–31 px), so it adds no request; shown at
the end of the home and section pages, after the privacy link. English: "Made with Guidesk".

## Status pages

| Page | HTTP | Illustration | Property name |
|---|---|---|---|
| Unavailable (link off, expired, unknown) | 404 | `unavailable` | Not shown (the response must not tell cases apart) |
| Rate limited | 429 | `wait` | Not shown |
| Temporary error ("One moment") | 503 | `wait` | Not shown |
| Offline (no saved copy) | — | `offline` | Not shown |
| Explore or Extras unavailable inside a loaded guide | as today | `unavailable` | Shown (the guide loaded) |

Each status page ends with the small Guidesk mark (18 px) and "Guidesk" as text, linking to nothing.

## Link previews (every guide page, public and stay links alike)

```html
<meta property="og:type" content="website" />
<meta property="og:title" content="{propertyName}" />
<meta property="og:description" content="Guía digital de tu estadía" />
<meta property="og:image" content="{PORTAL_URL}/brand/og-es.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:locale" content="es_CR" />
<meta name="twitter:card" content="summary_large_image" />
```

English: "Digital guide for your stay", `og-en.png`, `en_US`. The stay-link page (which never
looks the token up) uses the generic title "Tu guía de estadía" / "Your stay guide" with the same
description and image. Status pages carry no preview tags beyond the page title.
