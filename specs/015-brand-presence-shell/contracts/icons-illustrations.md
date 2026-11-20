# Contract: Icons and Illustrations (`@guidesk/ui`)

## Icon component

```text
<Icon data={IconData} size?={16 | 20 | 24} className?={string} />
```

- Renders `<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  focusable="false" class="icon …">`.
- `IconData` is a list of SVG shapes (`path`, `circle`, `rect`) with geometry only; no colors.
- Default size 20.

## Icon set (one named export per icon, plus `ICONS` for server-side lookup by name)

| Group | Names |
|---|---|
| Guide sections | `door` (arrival), `wifi`, `rules` (house rules), `appliance`, `amenity`, `car` (parking and transport), `pin` (recommendations), `emergency`, `checkout`, `gift` (extras), `compass` (explore), `bookmark` (custom) |
| Navigation | `inbox`, `bag` (requests), `house` (properties), `chart` (analytics), `layers` (shared content), `people` (team), `sliders` (settings), `more` |
| Inbox reasons | `emergency`, `wrench` (malfunction), `frown` (complaint), `coin` (money), `calendar` (reservation change), `scale` (legal), `question` (not confident), `pencil` (draft ready), `shield` (check failed), `gauge` (limit, monthly limit), `cloudOff` (unavailable), `person` (taken over) |
| Actions and status | `plus`, `message`, `copy`, `key`, `chat`, `phone`, `globe`, `chevron`, `external`, `check`, `clock`, `lock`, `link`, `qr` |

Mappings exported for server code:

- `SECTION_ICONS`: section kind → icon (`arrival`→`door`, `wifi`→`wifi`, `house_rules`→`rules`,
  `appliances`→`appliance`, `amenities`→`amenity`, `parking`→`car`, `local_recommendations`→`pin`,
  `emergency`→`emergency`, `checkout`→`checkout`, `custom`→`bookmark`); extras → `gift`, explore →
  `compass`.
- `REASON_ICONS`: needs-host reason → icon (`limit` and `monthly_limit` → `gauge`).

## Illustration component

```text
<Illustration data={IllustrationData} width?={number} className?={string} />
```

- Scenes, one export each (`doorScene`, `welcomeScene`, `noPropertiesScene`, `inboxClearScene`,
  `noRequestsScene`, `noDataScene`, `offlineScene`, `unavailableScene`, `waitScene`), plus
  `ILLUSTRATIONS` by name for server code and tests.
- View box 240 × 160; `height` follows from `width` (default 240); `aria-hidden="true"`; no text.
- Shapes carry only these classes, colored by each app's CSS tokens in light and dark mode:
  `il-bg`, `il-arena`, `il-terra`, `il-terra-soft`, `il-sol`, `il-line`, `il-dash`, `il-cut`,
  `il-stroke`.
- `BrandMark`: the 16 px mark geometry for 16–31 px, colored by `il-terra` and `il-sol`.
- `SECTION_ICON_DATA` and `REASON_ICON_DATA` (separate modules) give client code the section and
  reason icons without the full registry.

## Tests

- Every icon renders an `svg` with `aria-hidden="true"` and no `fill`/`stroke` color other than
  `none`/`currentColor`; every name in the tables exists.
- Every section kind and reason has a mapping.
- Every illustration renders with only the allowed classes and no `<text>` or `style`.
