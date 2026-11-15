# Design System Foundations (Provisional)

> **Status:** Draft v0.1, **provisional** · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [UX index](README.md) · [Principles and IA](principles-and-ia.md) · [Screens](screens.md) · [Wireframes](wireframes.html) · [Performance](../architecture/performance.md) · [ADR-0004 stack](../architecture/adr/0004-typescript-monorepo-stack.md)

The visual brand is not decided (OQ-11). Everything here is a **working foundation**: tokens,
type, spacing, components, and rules that make the MVP accessible, bilingual, and fast. Names
and structure should survive the brand work; the color values and the logo will change. The
portal uses Tailwind CSS and shadcn/ui (ADR-0004), so the tokens below are written as CSS custom
properties that map onto Tailwind's theme.

## 1. Scope

| Fixed by recorded decisions | Provisional (brand work may change it) |
|---|---|
| System font stack, no web fonts in the guide ([performance §2](../architecture/performance.md#2-guest-guide-delivery)) | Color values and the primary hue |
| WCAG 2.2 AA contrast and target sizes (NFR-07) | Corner radius and elevation style |
| Spanish and English with equal quality (NFR-06) | Illustration and photo style |
| ≤ 100 KB initial JavaScript per guide route; chat loads on tap | Logo, wordmark, and app icon |
| Disclosure on every offer (PC-07); visible lock on restricted fields (SEC-01 to SEC-04) | Exact microcopy (legal review, OQ-35, may change disclosure wording) |

## 2. Color

Semantic tokens only: components never use raw hex values. The primary hue is a deep teal as a
neutral placeholder. Contrast ratios below were computed with the WCAG 2.x relative-luminance
formula.

### 2.1 Light theme

| Token | Value | Use | Contrast | Passes |
|---|---|---|---|---|
| `--color-bg` | `#FFFFFF` | Page background | — | — |
| `--color-surface` | `#F4F6F7` | Cards, tiles, sheets | — | — |
| `--color-text` | `#1B1F24` | Body text | 16.6:1 on bg · 15.3:1 on surface | AA, AAA |
| `--color-text-muted` | `#505A64` | Secondary text, captions | 7.0:1 on bg · 6.5:1 on surface | AA, AAA |
| `--color-primary` | `#0B6466` | Links, primary text accents | 6.9:1 on bg · 6.4:1 on surface | AA |
| `--color-on-primary` | `#FFFFFF` | Text on primary buttons | 6.9:1 on primary | AA |
| `--color-primary-strong` | `#084C4E` | Pressed and hover | 9.8:1 with white text | AA, AAA |
| `--color-border-strong` | `#7A8691` | Input and control borders | 3.7:1 on bg | AA non-text (3:1) |
| `--color-border` | `#D5DBE0` | Decorative dividers only | 1.4:1 | Not for controls |
| `--color-focus` | `#1E5BD6` | Focus ring, 2 px with 2 px offset | 6.0:1 on bg | AA non-text |
| `--color-danger` | `#B3261E` | Errors, destructive actions | 6.5:1 on bg · 5.7:1 on danger-bg | AA |
| `--color-danger-bg` | `#FDECEA` | Error banners, emergency card | — | — |
| `--color-warning` | `#7A4D00` | Warning text | 6.7:1 on warning-bg | AA |
| `--color-warning-bg` | `#FFF4E0` | Warning banners | — | — |
| `--color-success` | `#1B6E3A` | Success text | 5.6:1 on success-bg | AA |
| `--color-success-bg` | `#E7F5EC` | Success banners, "Paid" | — | — |
| `--color-info` | `#1F5AA6` | Info text | 6.0:1 on info-bg | AA |
| `--color-info-bg` | `#E8F0FB` | Info banners, holding replies | — | — |
| `--color-disclosure` | `#3A444E` | Disclosure text | 8.8:1 on disclosure-bg | AA, AAA |
| `--color-disclosure-bg` | `#EEF1F4` | Disclosure pill | — | — |

### 2.2 Dark theme

Follows `prefers-color-scheme`, with no script and no flash of the wrong theme.

| Token | Value | Contrast | Passes |
|---|---|---|---|
| `--color-bg` | `#121417` | — | — |
| `--color-surface` | `#1C2024` | — | — |
| `--color-text` | `#E8ECEF` | 15.5:1 on bg · 13.8:1 on surface | AA, AAA |
| `--color-text-muted` | `#A9B3BC` | 8.7:1 on bg · 7.7:1 on surface | AA, AAA |
| `--color-primary` | `#5CC8C4` | 9.2:1 on bg | AA, AAA |
| `--color-on-primary` | `#0B1A1A` | 8.9:1 on primary | AA, AAA |
| `--color-border-strong` | `#6B7680` | 4.0:1 on bg | AA non-text |
| `--color-focus` | `#8AB4F8` | 8.8:1 on bg | AA non-text |
| `--color-danger` | `#F2817A` | 7.2:1 on bg | AA |
| `--color-warning` | `#F0B357` | 9.9:1 on bg | AA |
| `--color-success` | `#6FCF97` | 9.7:1 on bg | AA |
| `--color-info` | `#8AB4F8` | 8.8:1 on bg | AA |
| `--color-disclosure` | `#C9D1D8` on `#262B30` | 9.2:1 | AA, AAA |

### 2.3 Color rules

- **Never color alone.** Every status pairs color with text and, where useful, an icon: "Locked",
  "Paid", "Emergency" (WCAG 1.4.1).
- **Disclosure is neutral.** Disclosures use the neutral disclosure tokens, not warning colors.
  They inform; they do not alarm.
- **Emergency is the only red surface in the guide.** Errors use red text and a red border, so
  the emergency card stays distinct.
- **Focus rings sit on the page background,** thanks to the 2 px offset, so they keep 3:1 contrast
  even around primary buttons.

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
  cards, still a bottom bar), expanded `≥ 1024 px` (portal sidebar, inbox split view).
- **Content width:** guide content max 40rem, centered; portal content max 75rem.
- **Reflow:** every screen works at 320 CSS px wide and at 200% zoom, with no horizontal
  scrolling (WCAG 1.4.10).
- **Tap targets:** at least 44 × 44 CSS px, above WCAG 2.2's 24 px minimum, because guests use
  the guide one-handed at the door.
- **Shape (provisional):** radius 8 px (inputs, chips), 12 px (cards, sheets), full (pills,
  avatars). Elevation is a 1 px border plus a light shadow only for sheets and dialogs.
- **Safe areas:** fixed bars respect device safe areas (notches, home indicator).

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

## 10. Tokens as code (starting point)

```css
:root {
  --color-bg: #FFFFFF;
  --color-surface: #F4F6F7;
  --color-text: #1B1F24;
  --color-text-muted: #505A64;
  --color-primary: #0B6466;
  --color-primary-strong: #084C4E;
  --color-on-primary: #FFFFFF;
  --color-border: #D5DBE0;
  --color-border-strong: #7A8691;
  --color-focus: #1E5BD6;
  --color-danger: #B3261E;
  --color-danger-bg: #FDECEA;
  --color-warning: #7A4D00;
  --color-warning-bg: #FFF4E0;
  --color-success: #1B6E3A;
  --color-success-bg: #E7F5EC;
  --color-info: #1F5AA6;
  --color-info-bg: #E8F0FB;
  --color-disclosure: #3A444E;
  --color-disclosure-bg: #EEF1F4;
  --radius-sm: 8px;
  --radius-md: 12px;
  --tap-min: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #121417;
    --color-surface: #1C2024;
    --color-text: #E8ECEF;
    --color-text-muted: #A9B3BC;
    --color-primary: #5CC8C4;
    --color-primary-strong: #7FD8D4;
    --color-on-primary: #0B1A1A;
    --color-border: #2E343A;
    --color-border-strong: #6B7680;
    --color-focus: #8AB4F8;
    --color-danger: #F2817A;
    --color-danger-bg: #3A1D1B;
    --color-warning: #F0B357;
    --color-warning-bg: #3A2C12;
    --color-success: #6FCF97;
    --color-success-bg: #16301F;
    --color-info: #8AB4F8;
    --color-info-bg: #18263D;
    --color-disclosure: #C9D1D8;
    --color-disclosure-bg: #262B30;
  }
}
```

Dark-theme banner pairs were checked too: danger 6.0:1, warning 7.3:1, success 7.5:1, and info
7.2:1 on their `--color-*-bg` tokens, and `--color-on-primary` on `--color-primary-strong` is
10.8:1. Re-check every pair when the brand palette replaces these values.
