# Design System Foundations

> **Status:** v1.0, brand decided · **Owner:** Founder · **Last updated:** 2026-11-23 ·
> **Related:** [Brand guide](../brand/README.md) · [UX index](README.md) · [Principles and IA](principles-and-ia.md) · [Screens](screens.md) · [Wireframes](wireframes.html) · [Performance](../architecture/performance.md) · [ADR-0004 stack](../architecture/adr/0004-typescript-monorepo-stack.md)

The visual identity was decided on 2026-11-17: direction "Bienvenida" (terracota, sol, arena,
carbón), described in the [brand guide](../brand/README.md). This document turns it into
tokens, type, spacing, components, and rules that make the product accessible, bilingual, and
fast. The portal uses Tailwind CSS and shadcn/ui (ADR-0004), so the tokens are CSS custom
properties that map onto Tailwind's theme. The values live in `apps/portal/app/globals.css`;
[`docs/brand/build/tokens.py`](../brand/build/tokens.py) holds the same values and recomputes
every contrast pair below.

## 1. Scope

| Fixed by recorded decisions | Still open |
|---|---|
| System font stack, no web fonts in the guide ([performance §2](../architecture/performance.md#2-guest-guide-delivery)) | Trademark search and domain for the name (OQ-11) |
| WCAG 2.2 AA contrast and target sizes (NFR-07) | Exact microcopy (legal review, OQ-35, may change disclosure wording) |
| Spanish and English with equal quality (NFR-06) | Host branding on Pro and Business guides (how far a host can recolor the guide) |
| ≤ 100 KB initial JavaScript per guide route; chat loads on tap | |
| Disclosure on every offer (PC-07); visible lock on restricted fields (SEC-01 to SEC-04) | |
| Brand palette, logo, app icon, radius, and elevation ([brand guide](../brand/README.md), 2026-11-17) | |

## 2. Color

Semantic tokens only: components never use raw hex values. Contrast ratios were computed with
the WCAG 2.x relative-luminance formula by `docs/brand/build/tokens.py`, which fails if any pair
drops below its minimum. Text needs 4.5:1; borders of controls, focus rings, and meaningful
icons need 3:1.

### 2.1 Light theme

| Token | Value | Use | Contrast | Passes |
|---|---|---|---|---|
| `--color-bg` | `#FFFCF8` (cal) | Page background | — | — |
| `--color-surface` | `#F7F1EA` (arena) | Cards, tiles, sheets | — | — |
| `--color-text` | `#2B211C` (carbón) | Body text | 15.36:1 on bg · 14.00:1 on surface | AA, AAA |
| `--color-text-muted` | `#66574D` | Secondary text, captions | 6.76:1 on bg · 6.17:1 on surface | AA |
| `--color-primary` | `#B4452A` (terracota) | Links, primary buttons, brand accents in text | 5.37:1 on bg · 4.90:1 on surface | AA |
| `--color-on-primary` | `#FFFFFF` | Text on primary buttons | 5.49:1 on primary | AA |
| `--color-link` | `#8E3420` | Links, always underlined; visited links keep it | 7.71:1 on bg · 7.03:1 on surface · ≥ 6.61:1 on every banner background | AA (AAA on bg and surface) |
| `--color-primary-strong` | `#8E3420` | Hover and pressed | 7.89:1 with on-primary | AA, AAA |
| `--color-accent` | `#F5BC4C` (sol) | Decoration only: illustrations, highlights, the logo's door | 1.85:1 on white: **never text or meaningful icons** | — |
| `--color-border-strong` | `#8C7B70` | Input and control borders | 3.96:1 on bg · 3.61:1 on surface | AA non-text |
| `--color-border` | `#E6DCD1` | Decorative dividers only | — | Not for controls |
| `--color-focus` | `#1E5BD6` | Focus ring, 2 px with 2 px offset | 5.83:1 on bg · 5.32:1 on surface | AA non-text |
| `--color-danger` | `#A0153E` | Errors, destructive actions | 7.69:1 on bg · 7.01:1 on surface · 6.84:1 on danger-bg | AA |
| `--color-on-danger` | `#FFFFFF` | Text on destructive buttons | 7.86:1 on danger | AA, AAA |
| `--color-danger-bg` | `#FCEBEF` | Error banners, emergency card | — | — |
| `--color-warning` | `#7A4D00` | Warning text | 6.61:1 on warning-bg | AA |
| `--color-warning-bg` | `#FFF3DC` | Warning banners | — | — |
| `--color-success` | `#1B6E3A` | Success text | 5.59:1 on success-bg · 6.15:1 on bg | AA |
| `--color-success-bg` | `#E7F5EC` | Success banners, "Paid" | — | — |
| `--color-info` | `#1F5AA6` | Info text, warning badges | 5.95:1 on info-bg · 6.68:1 on bg | AA |
| `--color-info-bg` | `#E8F0FB` | Info banners, holding replies | — | — |
| `--color-disclosure` | `#4A3F38` | Disclosure text | 8.55:1 on disclosure-bg | AA, AAA |
| `--color-disclosure-bg` | `#F1EAE2` | Disclosure pill | — | — |

### 2.2 Dark theme

Follows `prefers-color-scheme`, with no script and no flash of the wrong theme. Every token is
redefined, so no light value leaks into dark mode.

| Token | Value | Contrast | Passes |
|---|---|---|---|
| `--color-bg` | `#17120F` (noche) | — | — |
| `--color-surface` | `#221B17` | — | — |
| `--color-text` | `#F3ECE6` | 15.89:1 on bg · 14.51:1 on surface | AA, AAA |
| `--color-text-muted` | `#BFB1A6` | 8.90:1 on bg · 8.13:1 on surface | AA, AAA |
| `--color-primary` | `#F0906F` (terracota claro) | 7.90:1 on bg · 7.21:1 on surface | AA, AAA |
| `--color-on-primary` | `#2A0F06` | 7.63:1 on primary · 10.05:1 on primary-strong | AA, AAA |
| `--color-primary-strong` | `#F6B29A` | (hover and pressed: lighter in dark mode) | — |
| `--color-link` | `#F0906F` | 7.90:1 on bg · 7.21:1 on surface · ≥ 5.76:1 on every banner background | AA |
| `--color-accent` | `#F5BC4C` | Decoration only | — |
| `--color-border` | `#3A302A` | Decorative dividers only | — |
| `--color-border-strong` | `#8A7A6F` | 4.51:1 on bg · 4.12:1 on surface | AA non-text |
| `--color-focus` | `#8AB4F8` | 8.82:1 on bg · 8.05:1 on surface | AA non-text |
| `--color-danger` | `#FF9BB5` | 9.39:1 on bg · 8.57:1 on surface · 7.82:1 on danger-bg | AA, AAA |
| `--color-on-danger` | `#2B0A12` | 9.19:1 on danger | AA, AAA |
| `--color-danger-bg` | `#3B1A22` | — | — |
| `--color-warning` | `#F0B357` on `#3A2C12` | 7.29:1 | AA, AAA |
| `--color-success` | `#6FCF97` on `#16301F` | 7.48:1 (9.78:1 on bg) | AA, AAA |
| `--color-info` | `#8AB4F8` on `#18263D` | 7.20:1 (8.82:1 on bg) | AA, AAA |
| `--color-disclosure` | `#DDD2C9` on `#2E2621` | 9.99:1 | AA, AAA |

### 2.3 Color rules

- **Never color alone.** Every status pairs color with text and, where useful, an icon: "Locked",
  "Paid", "Emergency" (WCAG 1.4.1).
- **Sol is decoration.** The accent never carries text, meaning, or focus.
- **Danger is not the primary.** Danger is crimson (rose in dark mode), terracota is orange-red,
  and the two differ in lightness too (1.43:1 light, 1.19:1 dark), so a destructive button
  never looks like the primary one. Both always have a text label.
- **Text on a filled color uses its `on-` token:** `--color-on-primary` on primary,
  `--color-on-danger` on danger. Never hard-code white: it fails on the light dark-mode fills.
- **Links are underlined.** `--color-link` differs from body text by only about 2:1, so the
  underline is what marks a link (WCAG 1.4.1). Never remove it from links in running text.
- **Disclosure is neutral.** Disclosures use the neutral disclosure tokens, not warning colors.
  They inform; they do not alarm.
- **Emergency is the only red surface in the guide.** Errors use red text and a red border, so
  the emergency card stays distinct.
- **Focus rings are blue on purpose,** to stand out from terracota buttons, and sit on the page
  background thanks to the 2 px offset, so they keep 3:1 contrast around any button.

### 2.4 Token audit of the portal (2026-11-17)

Hard-coded values found in `apps/portal/app/globals.css` while applying the tokens:

| Rule | Was | Now | Status |
|---|---|---|---|
| `.button-danger` | `color: #ffffff` (about 2:1 on the dark-mode danger fill) | `var(--color-on-danger)` | Fixed 2026-11-17 |
| No `a` rule | Browser default blue and purple links | `a { color: var(--color-link) }`, visited included | Fixed 2026-11-17 |
| `.switcher-menu` | `box-shadow: 0 8px 24px rgb(0 0 0 / 0.15)` | Should use `var(--shadow-sheet)` | Open (cosmetic) |
| `.switcher-option` | `border-radius: 8px` | Should use `var(--radius-sm)` | Open (same value) |

## 3. Typography

**Font stacks** (no downloads, per the performance budget):

```css
--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", "Liberation Mono", monospace;
```

**Scale** (rem-based, so it follows the user's font-size setting):

| Token | Size | Line height | Use |
|---|---|---|---|
| `--text-xs` | 0.8125rem (13 px) | 1.4 | Timestamps and legal footers only |
| `--text-sm` | 0.875rem (14 px) | 1.45 | Captions, chips, disclosures |
| `--text-md` | 1rem (16 px) | 1.5 | Body text, inputs (16 px stops iOS from zooming on focus) |
| `--text-lg` | 1.125rem (18 px) | 1.45 | Lead text, chat messages on the guide |
| `--text-xl` | 1.25rem (20 px) | 1.35 | Section titles on phones |
| `--text-2xl` | 1.5rem (24 px) | 1.3 | Page titles |
| `--text-3xl` | 1.875rem (30 px) | 1.25 | Guide home title on larger screens |
| `--text-code` | 2.5rem (40 px), mono, letter-spacing 0.2em | 1.2 | Revealed access codes |

**Weights:** 400 (body), 600 (labels, titles), 700 (codes and key numbers). **Line length:** at
most about 70 characters (guide content column max 40rem).

**Brand faces outside the product:** the wordmark is outlined in the logo files (no font needed),
and marketing headlines may use Fraunces SemiBold (SIL Open Font License 1.1). Neither is ever
loaded by the portal or the guest guide ([brand guide §4](../brand/README.md#4-typography)).

## 4. Spacing, layout, and shape

| Token | Value | Use |
|---|---|---|
| `--space-1` | 4 px | Icon gaps |
| `--space-2` | 8 px | Minimum gap between tap targets |
| `--space-3` | 12 px | Inside chips, compact lists |
| `--space-4` | 16 px | Page gutter on phones, card padding |
| `--space-5` | 24 px | Between groups |
| `--space-6` | 32 px | Between sections |
| `--space-7` | 48 px | Page top and bottom on large screens |

- **Breakpoints:** compact `< 600 px` (single column, bottom bar), medium `600–1023 px` (wider
  cards, still a bottom bar), expanded `≥ 1024 px` (portal sidebar, two-column layouts; §4.1).
- **Portal shell (feature 015):** under 1024 px, a top bar (logo, workspace switcher) and a bottom
  bar with Inbox, Requests, Properties, and More (Analytics, Shared content, Team, Settings); four
  columns keep every Spanish label whole at 320 px. From 1024 px, a 16.5rem sidebar with every
  destination. Main pages start with the page header (title, help line, primary action); lists and
  dashboards use up to 75rem, other pages 52rem, forms 40rem.
- **No cut text (feature 015):** labels never hyphenate or end in an ellipsis; they wrap between
  words. User-entered names and links wrap anywhere only when one word cannot fit. *Exception
  (founder decision 2026-11-23):* names in compact chrome (the workspace switcher, its menu, and
  the account link in the sidebar) stay on one line and end in an ellipsis (`.truncate-name`); the
  full name stays in the tooltip and the accessible name, and Settings shows it whole.
- **Content width:** guide content max 40rem, centered; portal content max 75rem.
- **Reflow:** every screen works at 320 CSS px wide and at 200% zoom, with no horizontal
  scrolling (WCAG 1.4.10).
- **Tap targets:** at least 44 × 44 CSS px, above WCAG 2.2's 24 px minimum, because guests use
  the guide one-handed at the door.
- **Shape:** `--radius-sm` 8 px (inputs, chips), `--radius-md` 12 px (cards, buttons),
  `--radius-lg` 16 px (sheets, dialogs), `--radius-full` (pills, avatars). The soft corners echo
  the logo's bubble.
- **Elevation:** flat. A 1 px border separates surfaces; only sheets and dialogs get
  `--shadow-sheet` (warm and light in light mode, deeper in dark mode).
- **Safe areas:** fixed bars respect device safe areas (notches, home indicator).

### 4.1 The desktop layer (feature 017)

The phone design is the base; from 600 px and 1024 px the same components change shape so that a
desktop reads as a desktop product, not a stretched phone ([UI/UX audit](ui-ux-audit-2026-11.md),
[spec 017](../../specs/017-desktop-design-polish/spec.md)).

| Width | What changes |
|---|---|
| Under 600 px | Nothing: buttons span the column, fields stack, one column. |
| From 600 px | Buttons size to their label (the auth panel keeps full width); filters and tabs share one toolbar row; short fields share a row (city, state, postal code). |
| From 1024 px | Cards get a 1 px border and 24 px padding; requests, option cards, extras, and guide sections use two columns; settings three; the property page and Share use a main column and a 22rem side column; page titles grow to 28 px. |
| Guest guide from 768 px | The column becomes a card on the arena backdrop; from 1024 px the home tiles use three columns with the icon above the title. |

**Page templates.** *List* (inbox, requests, properties, extras): page header, one toolbar row, then
rows or a grid. *Detail* (property, Share): header with actions, main column, side column. *Form*
(onboarding, new property, settings forms): 40rem column, actions at the end. *Hub* (settings, add
property): a grid of option cards with an icon in a tinted circle, a title, a one-line description,
and a chevron.

**Components added or reshaped:** segmented control for tabs (arena track, the current item on cal
with a terracota outline and text); filter toolbar (`.toolbar-field` keeps each label visible);
status pills by meaning (waiting = warning, confirmed = success, closed = neutral); option cards with
a chosen state (`:has(input:checked)`: terracota edge and tint) and the brand `accent-color`; quiet
buttons for secondary actions next to one primary action; a quiet danger button for delete inside
lists; a chevron back link above sub-page titles; a CSS-only loading placeholder for empty pages and
a shell that renders before the account loads.

## 5. Core components

| Component | Purpose | Variants and states | Accessibility notes |
|---|---|---|---|
| **Top app bar** | Context and global actions | Guest: property name, language, Emergency. Host: workspace name and role, alerts. | Landmark `header`; Emergency is a labeled button, not an icon alone. |
| **Bottom navigation** | Primary destinations on phones | Guest: 3–4 items. Host: 5 items (3 for agents). Badge on Inbox. | `nav` landmark, current item marked with `aria-current`; never hides focused content (WCAG 2.4.11). |
| **Workspace switcher** | Change workspace in two taps | Trigger (name, role), sheet (list, role badges, create) | Announces the switch result; the current workspace is checked. |
| **Guide tile** | Entry to a section from the home screen | Default, with a lock badge, with "New" | Whole tile is one link; minimum 44 px tall. |
| **Stay card** | Dates and times for the guest's stay | Before arrival, during the stay, last day | Times include the property time zone label when it differs from the device. |
| **Locked field** | A restricted value in the guide | Locked (property link), Not yet (before window), Verify, Ready to show, Shown, Offline, Error | The reason is text, not only a lock icon. "Show code" is a button; the value is never in the page until tapped. |
| **Code input** | Verification code, email sign-in code | Default, error, paused with countdown | One field (not split boxes), so paste and screen readers work. `autocomplete="one-time-code"` for sign-in codes. No time pressure beyond the 10-minute validity, which is stated (WCAG 2.2.1, 3.3.8). |
| **Code display** | Shows a revealed access code | Large mono digits, copy button | Read digit by digit (an accessible label with spaced digits). |
| **Chat message** | One message in the guide chat or the inbox | Guest, Assistant, Host, System (holding reply) | Speaker label is text. Streaming text is announced once complete via a polite live region. |
| **Source link** | Shows which guide section an answer used | "From: Wi-Fi" | A real link to the section. |
| **Suggested question** | Quick start in an empty chat | Chip | Buttons, not decorative text. |
| **Emergency card** | Emergency numbers and contacts | In the chat, on G-11 | Phone numbers are `tel:` links with the number spoken in full. |
| **Offer card** | An extra or an experience | Extra (host), Experience (partner), Pinned tip with benefit | The disclosure pill is inside the card, before the action button in reading order. |
| **Disclosure pill** | Commission or benefit notice | Host service fee, Guidesk commission, host and Guidesk commission, host benefit | Text at least 14 px; opens the disclosure explainer (S-05). |
| **Status tracker** | Request progress | Requested, Confirmed, Paid, Not available, Refunded | Current step in text; does not rely on a progress bar alone. |
| **Draft card** | An agent draft waiting for the host | Default, edited, sending, failed | Approve, Edit, and Reject are separate buttons with clear labels; "Why this reply" expands inline. |
| **Reason chip** | Why a conversation needs the host | Emergency, Malfunction, Complaint, Refund, Booking change, Not sure, Draft ready, Extra requested | Text label always present. |
| **Autonomy control** | Per-topic autonomy | Segmented: Draft, Auto, Full auto. Locked rows for mandatory categories. | Radio group semantics; locked rows explain why. |
| **Completeness meter** | Guide completeness score | Percent plus the top 3 missing topics | The number and the list are text; the bar is decorative. |
| **Section status badge** | Draft review | Ready, Needs review, Missing, Machine translation | Text label. |
| **Voice recorder** | Voice-note answers in the interview | Idle, recording (timer), transcribing, transcript to edit | Keyboard operable; the transcript is always editable text. |
| **Upload item** | A file in the uploads list | Uploading, scanning, extracted, rejected (reason) | Status in text; no drag-only upload (WCAG 2.5.7). |
| **Policy check badge** | Copilot and template checks | Passed, Changed (what was removed) | Expandable explanation in plain words. |
| **Buttons** | Actions | Primary, secondary, tertiary, destructive; sizes 44 px and 48 px | Verb labels ("Show code", not "OK"); loading state keeps the label ("Showing…"). |
| **Form fields** | Data entry | Text, select, radio cards (onboarding), toggle, masked (locked fields) | Visible labels, not placeholders; errors next to the field and in a summary. |
| **Banner** | Page-level messages | Info, warning, error, offline | `role="status"` or `role="alert"` by severity. |
| **Toast** | Short confirmations | Success, neutral | Never the only place an error appears; stays at least 5 s; does not cover the bottom bar. |
| **Bottom sheet and dialog** | Short choices, confirmations | Sheet (phones), centered dialog (desktop) | Focus moves in and returns; Esc and back close it. |
| **Empty state** | Nothing yet | With one primary action | Explains why it is empty. |
| **Skeleton** | Loading | Shaped like the final content | Reserves the final size (CLS); announced as "Loading" once. |
| **QR poster** | Printable property QR | A4 and letter, Spanish and English | States "Public guide. Codes are never shown here." |

## 6. Accessibility rules (WCAG 2.2 AA)

The guest guide must meet WCAG 2.2 AA (NFR-07, constitution). The portal follows the same rules.

1. **Contrast:** text 4.5:1 (3:1 for 24 px and up, or 18.66 px bold); controls, focus rings, and
   meaningful icons 3:1 (1.4.3, 1.4.11).
2. **Keyboard:** everything works with a keyboard and a switch device; logical focus order;
   visible focus (2.1.1, 2.4.3, 2.4.7).
3. **Focus not obscured:** fixed bars and the chat composer never cover the focused element
   (2.4.11).
4. **Target size:** 44 px design minimum (2.5.8 requires 24 px).
5. **No drag-only actions:** reordering sections and uploading files have button alternatives
   (2.5.7).
6. **Accessible authentication:** passkeys, Google, and email codes with paste and autofill; no
   puzzles; the bot challenge appears only on abuse signals (3.3.8, SEC-07).
7. **Consistent help:** Emergency in the guide and Help in the portal sit in the same place on
   every screen (3.2.6).
8. **Redundant entry:** never ask the guest or the host for the same information twice in a flow
   (3.3.7).
9. **Status messages:** holding replies, "Confirming your payment…", and saved confirmations use
   live regions; streaming chat is announced on completion (4.1.3).
10. **Language of parts:** each block carries its language (`lang="es"` or `lang="en"`), including
    untranslated host content (3.1.2).
11. **Timing:** no content disappears on a timer; the sign-in code validity is stated; the
    verification pause shows a countdown (2.2.1).
12. **Motion:** transitions ≤ 200 ms and turned off under `prefers-reduced-motion` (2.3.3 is AAA,
    adopted as good practice).
13. **Media:** videos have captions or a text equivalent; photos of access points have
    descriptive alternative text written by the host, with a prompt in the editor (1.1.1, 1.2.2).
14. **Errors:** described in text, next to the field, with a fix (3.3.1, 3.3.3).
15. **Zoom and reflow:** 200% text zoom and 320 px reflow without loss (1.4.4, 1.4.10).

**Testing:** automated checks (axe) in CI on the guide and portal, plus a manual pass with
VoiceOver (iOS) and TalkBack (Android) on each MVP flow before the pilot.

## 7. Internationalization

Spanish and English are required everywhere (NFR-06, constitution IX). Portuguese is pending
(OQ-05).

**Text length.** Spanish runs about 20–30% longer than English, and short labels grow even more:

| English | Spanish | Growth |
|---|---|---|
| Show code (9) | Mostrar código (14) | +56% |
| Request (7) | Solicitar (9) | +29% |
| Paste a guest message (21) | Pegar el mensaje del huésped (28) | +33% |
| Waiting for your host (21) | Esperando respuesta del anfitrión (33) | +57% |

**Rules:**

- **Design in Spanish first.** Mock-ups and wireframes test the longer language. Leave 30% spare
  width in labels and 50% for labels under 12 characters.
- **No fixed widths on text.** Buttons grow; long labels wrap to two lines before they truncate.
  Truncation is allowed only for user content (property names), with the full text available.
- **No text in images,** including the QR poster, which is generated per language.
- **Whole messages, never concatenated fragments.** Use ICU MessageFormat for plurals and
  variables ("{count, plural, one {# night} other {# nights}}").
- **Gender-neutral by design.** Prefer the host's name over "anfitrión" or "anfitriona" ("Ofrecido
  por Ana").
- **Register (provisional):** neutral Latin American Spanish, using "tú" in the interface. The
  agent follows the host's tone setting (FR-07.3). To confirm with pilot hosts.
- **Formats by locale, never by hand:** dates, times, numbers, and currency use the platform's
  `Intl` APIs with the guest's locale and the **property's** time zone. Money is shown with its
  currency code when the symbol is ambiguous (USD and CRC both appear in Costa Rica).
- **Language switch** lists languages in their own names: "English", "Español".
- **Machine translation is labeled** until the host reviews it (FR-03.5).
- **Disclosure wording** exists in both languages and needs legal review (OQ-35):

| Case | English | Spanish |
|---|---|---|
| Host add-on | Offered by Ana. Guidesk receives a service fee. | Ofrecido por Ana. Guidesk recibe una tarifa de servicio. |
| Affiliate experience | Guidesk earns a commission if you book. | Guidesk recibe una comisión si reservas. |
| Affiliate, host shares it (if OQ-08) | Ana and Guidesk earn a commission if you book. | Ana y Guidesk reciben una comisión si reservas. |
| Host tip with a declared benefit | Ana gets a benefit from this business. | Ana recibe un beneficio de este negocio. |

## 8. Performance constraints that shape the UI

From the [performance architecture](../architecture/performance.md) (guide: LCP ≤ 2.5 s, INP
≤ 200 ms, CLS ≤ 0.1, ≤ 100 KB initial JavaScript, ≤ 500 KB initial page weight):

| Constraint | UI consequence |
|---|---|
| Static-first guide on a CDN | Guide pages are server-rendered HTML that works before any script runs. Accordions use native `details` and `summary`. |
| ≤ 100 KB initial JavaScript | No UI framework widgets on first load beyond what the page needs. No carousels, parallax, animation libraries, or embedded maps. |
| Chat loads on tap | The Ask button is plain HTML; tapping it shows a skeleton chat while the code loads. Focusing the input warms the AI cache (no visible effect). |
| System fonts only | No font files; type hierarchy comes from size and weight. |
| Icons | An inline SVG sprite of about 20 icons; no icon fonts. |
| LCP | The first screen of the guide home is text and tiles. The property photo is small, compressed, and has fixed dimensions, so it never becomes a slow LCP element. |
| CLS ≤ 0.1 | Every image and skeleton reserves its final size; banners push nothing after load. |
| Restricted values never cached | Codes load on tap with a button-level loading state; the offline state is designed, not an error page. |
| Usable on slow 3G within 5 s | Arrival, Wi-Fi network name, and house rules are in the first HTML response. Photos and videos load later. |
| Maps | "Open in Google Maps", "Waze", or "Apple Maps" links, not map widgets. Waze is widely used in Costa Rica. |
| Affiliate offers | Plain links to partner pages, no partner scripts. |
| Portal on mobile (LCP ≤ 2.5 s, INP ≤ 200 ms) | The rich-text editor and the voice recorder load only when opened; the inbox paginates (keyset) instead of rendering everything. |
| Dark mode | Pure CSS (`prefers-color-scheme`), no theme script. |

## 9. Voice and microcopy

- **Plain and warm.** Short sentences, verbs first: "Show code", "Paste a guest message".
- **Explain locks and limits.** Say why and what to do: "Codes appear during your stay. Check-in
  is Fri 12 Dec from 3:00 pm."
- **Name the speaker.** "Assistant" for the AI, the host's name for the host.
- **No pressure in offers.** No countdowns, scarcity claims, or pre-checked boxes (PC-08).
- **Errors without blame.** "That code didn't work" instead of "Invalid input".
- **Compliance in the words.** Templates and drafts contain no links before booking and no
  off-platform payment requests (PC-05, PC-06).

## 10. Tokens as code

The portal's `apps/portal/app/globals.css` holds these exact values; change both together, then
run `python3 docs/brand/build/tokens.py` to recheck every contrast pair.

```css
:root {
  --color-bg: #fffcf8;
  --color-surface: #f7f1ea;
  --color-text: #2b211c;
  --color-text-muted: #66574d;
  --color-primary: #b4452a;
  --color-primary-strong: #8e3420;
  --color-on-primary: #ffffff;
  --color-link: #8e3420;
  --color-accent: #f5bc4c;
  --color-border: #e6dcd1;
  --color-border-strong: #8c7b70;
  --color-focus: #1e5bd6;
  --color-danger: #a0153e;
  --color-on-danger: #ffffff;
  --color-danger-bg: #fcebef;
  --color-warning: #7a4d00;
  --color-warning-bg: #fff3dc;
  --color-success: #1b6e3a;
  --color-success-bg: #e7f5ec;
  --color-info: #1f5aa6;
  --color-info-bg: #e8f0fb;
  --color-disclosure: #4a3f38;
  --color-disclosure-bg: #f1eae2;
  --font-sans:
    system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif;
  --font-mono:
    ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", "Liberation Mono", monospace;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 999px;
  --tap-min: 44px;
  --shadow-sheet: 0 8px 24px rgb(43 33 28 / 0.16);
  --radius: var(--radius-md);
  --space: var(--space-4);
  font-family: var(--font-sans);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #17120f;
    --color-surface: #221b17;
    --color-text: #f3ece6;
    --color-text-muted: #bfb1a6;
    --color-primary: #f0906f;
    --color-primary-strong: #f6b29a;
    --color-on-primary: #2a0f06;
    --color-link: #f0906f;
    --color-accent: #f5bc4c;
    --color-border: #3a302a;
    --color-border-strong: #8a7a6f;
    --color-focus: #8ab4f8;
    --color-danger: #ff9bb5;
    --color-on-danger: #2b0a12;
    --color-danger-bg: #3b1a22;
    --color-warning: #f0b357;
    --color-warning-bg: #3a2c12;
    --color-success: #6fcf97;
    --color-success-bg: #16301f;
    --color-info: #8ab4f8;
    --color-info-bg: #18263d;
    --color-disclosure: #ddd2c9;
    --color-disclosure-bg: #2e2621;
    --shadow-sheet: 0 8px 24px rgb(0 0 0 / 0.5);
  }
}
```

`--radius` and `--space` are aliases kept for the existing portal rules.
