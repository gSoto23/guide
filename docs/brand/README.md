# Guidesk Brand Guide

> **Status:** v1.0, chosen 2026-11-17 · **Owner:** Founder · **Last updated:** 2026-11-17 ·
> **Related:** [Design system](../ux/design-system.md) · [Principles and IA](../ux/principles-and-ia.md) · [Performance](../architecture/performance.md) · [Open questions](../open-questions.md) (OQ-11)

This guide covers the logo, color, type, icons, imagery, and usage rules of Guidesk. The visual
identity was decided on 2026-11-17 (direction "Bienvenida", mark variant "Luz"). The name is
still subject to the trademark search and domain choice in OQ-11. UI tokens (semantic colors,
type scale, spacing) are defined in the [design system](../ux/design-system.md); this guide
explains the brand behind them.

<p>
  <img src="logo/guidesk-logo.svg" alt="Guidesk logo: a terracotta speech bubble with an open, sunlit doorway, next to the word guidesk" width="320">
</p>

## 1. Idea

**A home that answers.** The mark is a speech bubble with one square corner (the simplest sign of
a message) and an open doorway with light inside. It joins the two things Guidesk does: it
**answers** guests (the bubble) and it **welcomes** them to the property (the door). The arched
door recalls beach houses and colonial architecture across Latin America; the light is the
porch lamp a good host leaves on.

**Personality:** warm, hospitable, close, and plain-spoken. Guidesk sounds like a host waiting at
the door, not like a hotel chain or a tech product.

## 2. Logo

### 2.1 Files

All files are optimized SVG drawn on whole-unit grids, with no strokes, filters, or embedded
fonts. Colors are fixed in the files; pick the version that matches the background.

| File | Use |
|---|---|
| [`logo/guidesk-logo.svg`](logo/guidesk-logo.svg) | Primary logo (mark + wordmark) on light backgrounds |
| [`logo/guidesk-logo-dark.svg`](logo/guidesk-logo-dark.svg) | Primary logo on dark backgrounds |
| [`logo/guidesk-logo-mono-black.svg`](logo/guidesk-logo-mono-black.svg) | One color (carbón), for one-ink printing, stamps, and engraving |
| [`logo/guidesk-logo-mono-white.svg`](logo/guidesk-logo-mono-white.svg) | One color white, on terracota or on photos |
| [`logo/guidesk-mark.svg`](logo/guidesk-mark.svg) | Mark only, full color |
| [`logo/guidesk-mark-mono-black.svg`](logo/guidesk-mark-mono-black.svg) · [`-mono-white`](logo/guidesk-mark-mono-white.svg) | Mark only, one color (the door is a real hole) |
| [`logo/guidesk-wordmark.svg`](logo/guidesk-wordmark.svg) · [`-dark`](logo/guidesk-wordmark-dark.svg) | Wordmark only, for places where the mark already appears nearby |
| [`icons/favicon.svg`](icons/favicon.svg) · [`favicon.ico`](icons/favicon.ico) | Browser tab (optical version drawn for 16–32 px) |
| [`icons/app-icon.svg`](icons/app-icon.svg) | Square app icon: the full-color mark on a cal tile (#FFFCF8), full bleed; platforms apply their own corner mask, and the bubble stays inside the maskable safe zone (38.6 % from the center, limit 40 %) |
| [`icons/app-icon-rounded.svg`](icons/app-icon-rounded.svg) | App icon with corners, for documents and presentations |
| [`icons/apple-touch-icon.png`](icons/apple-touch-icon.png) | 180 px, iOS home screen |
| [`icons/icon-192.png`](icons/icon-192.png) · [`icon-512.png`](icons/icon-512.png) · [`icon-maskable-512.png`](icons/icon-maskable-512.png) | PWA manifest icons (`any` and `maskable`) |

The portal uses `apps/portal/app/icon.svg`, `apple-icon.png`, and `favicon.ico`, copied from
these files by the build (section 9).

### 2.2 Anatomy

<p>
  <img src="logo/guidesk-mark.svg" alt="The Guidesk mark" width="96">
</p>

- **Bubble:** a 20 × 19 rounded rectangle (corner radius 6 on a 24-unit grid) with a square
  bottom-left corner. The square corner is what makes it a speech bubble: never round it.
- **Door:** an arch 7 units wide, standing on the bubble's floor, filled with **sol**.
- **Wordmark:** "guidesk" in lowercase, set in Poppins SemiBold (SIL Open Font License 1.1),
  tracked −1 %, converted to outlines, with the dot of the **i** in **sol**. Never retype it:
  use the files.
- **Lockup:** horizontal only. The gap between mark and wordmark is about a quarter of the
  mark's height, and the wordmark's baseline sits on the bubble's floor.

### 2.3 Clear space and minimum size

- **Clear space:** keep empty space at least the width of the door (about a third of the mark's
  height) on every side of the logo or the mark.
- **Minimum size:** the full logo at 100 px wide on screens or 25 mm in print. The mark alone
  at 16 px. From 16 to 31 px use the favicon version (`icons/favicon.svg`), which has thicker
  walls aligned to whole pixels; from 32 px use `logo/guidesk-mark.svg`.
- In the guest guide on the Free plan, the "Made with Guidesk" / "Hecho con Guidesk" footer
  uses the mark at 16–20 px next to the text. The host's brand always leads.

### 2.4 Color versions

| Background | Version |
|---|---|
| White, cal (#FFFCF8), arena (#F7F1EA), light photos with a calm area | Full color |
| Noche (#17120F) and other dark backgrounds | Full color dark (light wordmark) |
| Terracota, busy photos, colored backgrounds | One color white |
| One-ink printing, embossing, fax-like contexts | One color black (carbón) |

### 2.5 Do and don't

| Do | Don't |
|---|---|
| Use the supplied files as they are | Retype the wordmark or set it in another font |
| Scale proportionally | Stretch, rotate, skew, or flip the logo |
| Keep the clear space | Crowd it with text, borders, or other logos |
| Use one color white on terracota | Put the full-color logo on terracota (the bubble disappears) |
| Keep the bubble's square corner and the door on the floor | Round all four corners, move the door, or add a door knob |
| Use the favicon version under 32 px | Use the full logo below 100 px wide |
| Put the logo on calm, solid areas | Place it on busy photos without a solid backing |
| Keep it flat | Add shadows, gradients, outlines, glows, or 3D effects |
| Use the mark for Guidesk itself | Use the mark as a UI icon for "chat", "home", or "notifications" |

## 3. Color

### 3.1 Brand palette

<p>
  <img src="palette.svg" alt="Swatches, left to right: terracota, terracota oscuro, sol, cal, arena, carbón, terracota claro, noche" width="440">
</p>

| Name | Hex | Role |
|---|---|---|
| **Terracota** | `#B4452A` | Brand color: the bubble, primary buttons, links. White text on it: 5.49:1. |
| **Terracota oscuro** | `#8E3420` | Hover and pressed states. White text on it: 7.89:1. |
| **Sol** | `#F5BC4C` | Accent: the door, the dot of the i, small highlights. **Never text**, never the only sign of anything. |
| **Cal** | `#FFFCF8` | Page background (warm white) |
| **Arena** | `#F7F1EA` | Cards, sheets, quiet sections |
| **Carbón** | `#2B211C` | Text and the wordmark: 15.36:1 on cal |
| **Terracota claro** | `#F0906F` | The primary color in dark mode: 7.90:1 on noche |
| **Noche** | `#17120F` | Dark mode background |

**Proportions:** mostly cal and arena with carbón text; terracota for actions and brand moments
(about a tenth of a screen); sol in small touches only. A screen should never feel orange.

### 3.2 Contrast rules

- All UI text pairs meet WCAG 2.2 AA in light and dark mode; the full list, with ratios, is in
  [design system §2](../ux/design-system.md#2-color). `build/tokens.py` recomputes every pair
  and fails if one drops below its minimum.
- **Sol** reaches only 1.85:1 on white: use it for decoration, never for text, icons that carry
  meaning, or focus. On the terracota bubble it reaches 3.18:1, enough for a graphic.
- **Terracota** text works on cal (5.37:1) and arena (4.90:1) at any size. Don't put it on
  darker tints.
- **Links** use terracota oscuro (`#8E3420`, 7.71:1 on cal) and terracota claro in dark mode,
  always underlined: the underline, not the color, is what tells a link from body text.
- **Danger is not terracota.** Errors use a crimson (`#A0153E`, rose `#FF9BB5` in dark mode) so
  a destructive button never looks like a primary one; both always carry a text label.
- The **focus ring** is blue (`#1E5BD6`, `#8AB4F8` in dark mode) on purpose: it must stand out
  against terracota buttons.

## 4. Typography

| Use | Typeface | Why |
|---|---|---|
| Product (portal and guest guide) | System font stack (`--font-sans`) | No downloads, fastest load, native in every language; recorded in the [performance budget](../architecture/performance.md) |
| Wordmark | Outlines of Poppins SemiBold, in the logo files | Works without any font installed |
| Marketing headlines (website, social, print) | [Fraunces](https://fonts.google.com/specimen/Fraunces) SemiBold, optional | A warm, soft serif for big headlines. SIL Open Font License 1.1. Never in the product. |

- Sizes, weights, and line heights for the product are the type scale in
  [design system §3](../ux/design-system.md#3-typography): 16 px body, 600 for labels and
  titles, 700 for key numbers.
- If the marketing site self-hosts Fraunces, subset it to Latin with Spanish and Portuguese
  characters and load one weight.

## 5. Icons

- **Grid and style:** 24 × 24 px with 2 px of padding, 2 px strokes, round caps and joins,
  corner radius about 2 px. Shapes echo the mark: rounded rectangles, arches, circles.
- **Color:** `currentColor`, so icons follow the text color. Meaningful icons need 3:1 against
  their background; sol is never an icon color on light backgrounds.
- **Delivery:** one inline SVG sprite of about 20 icons; no icon fonts and no icon libraries in
  the guest guide (100 KB JavaScript budget).
- **Labels:** status icons always come with text ("Locked", "Paid", "Emergency"). Icon-only
  buttons have an `aria-label`.
- The logo mark is not a UI icon.

## 6. Illustration and photography

**Illustration** (empty states, onboarding, marketing):

- Flat shapes from the mark's vocabulary: arches, bubbles with one square corner, sun circles,
  simple horizons.
- Palette: terracota, sol, arena, carbón, and their tints. No gradients, 3D, or glossy
  AI-generated imagery.
- No text inside illustrations (each language needs its own text).
- Decorative illustrations have empty `alt` text; informative ones describe what they show.

**Photography** (marketing and examples):

- Real places and arrivals: doors, entrances, keys, views, a lamp left on. Warm natural light.
- People shown naturally, from behind or in action; no posed stock smiles.
- Every photo has written alternative text. Guide photos belong to the host and follow the
  host's brand.

## 7. Layout, shape, and elevation

- **Spacing:** a 4 px base (4, 8, 12, 16, 24, 32, 48). Phone gutter 16 px.
- **Corner radius:** 8 px for inputs and chips, 12 px for cards and buttons, 16 px for sheets,
  full for pills and avatars. The rounded corners of the mark (6 on a 24-unit grid) set this
  soft, friendly shape.
- **Elevation:** flat. A 1 px border separates surfaces; only sheets and dialogs get a soft
  shadow (`--shadow-sheet`).
- **Motion:** 200 ms or less, ease-out, and none under `prefers-reduced-motion`.

## 8. Voice

The interface rules are in [design system §9](../ux/design-system.md#9-voice-and-microcopy);
the brand adds warmth.

- **Like a host at the door:** warm and personal, never effusive. One exclamation mark at most,
  only in welcomes.
- **Plain and short:** verbs first, no jargon, the same quality in Spanish and English.
- **Explain, then reassure:** say what happens and why ("Codes appear on arrival day, from
  3:00 pm").

| | Spanish | English |
|---|---|---|
| Welcome | ¡Bienvenida, Emily! Aquí está todo lo de tu estadía. | Welcome, Emily! Everything for your stay is right here. |
| Error | Ese código no funcionó. Revisa los 6 dígitos y prueba otra vez. | That code didn't work. Check the 6 digits and try again. |
| Tagline (marketing) | Tu casa, siempre lista para responder. | Your home, always ready to answer. |

## 9. Rebuilding the files

Every file in `logo/` and `icons/` comes from one geometry source, `build/build.py`. To change
the logo, edit the geometry there and rebuild; never edit the SVG files by hand.

```bash
cd docs/brand/build
python3 tokens.py            # contrast check of every color pair
python3 build.py             # SVG files, including apps/portal/app/icon.svg
node raster.mjs              # PNG icons, including apps/portal/app/apple-icon.png (uses sharp from node_modules)
python3 ico.py               # favicon.ico for docs and the portal (uses Pillow)
```

The scripts need Python 3 with `fontTools` and `Pillow`, and Node.js after `pnpm install`. The
wordmark outlines are cached in `build/wordmark.json`, so Poppins is needed only to regenerate
them (`POPPINS=/path/to/Poppins-SemiBold.ttf python3 build.py`).

## 10. Ownership and licenses

- The mark, the logo files, and this guide are original work made for Guidesk.
- The wordmark is drawn from Poppins (Indian Type Foundry, SIL Open Font License 1.1); the
  license allows using the font's shapes in a logo. Fraunces (optional, marketing) is also under
  the SIL Open Font License 1.1.
- No third-party logos, icons, or images are used.
- Trademark registration and the final domain are still open (OQ-11).
