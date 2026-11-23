# Brand Application Audit

> **Status:** phases A and B built in [spec 015](../../specs/015-brand-presence-shell/spec.md),
> phase C in [spec 016](../../specs/016-property-photos/spec.md) (2026-11-19); D waits for the
> founder's own photos · **Owner:** Founder · **Related:** [Brand guide](README.md) ·
> [Design system](../ux/design-system.md) · [Screens](../ux/screens.md) ·
> [Performance](../architecture/performance.md)

How strongly the "Bienvenida" identity shows across the product today, and how to make it show
more, including the use of images. The audit ran the product locally with a demo workspace
(`demo:seed`), on a phone (390 px) and a desktop (1280 px) viewport, in light mode, and read the
code of every portal route (50 pages), the guest guide pages, and the emails.

## 1. Summary

- **The foundations are right.** The color tokens, radii, system font stack, and contrast rules
  match the brand guide. The logo is in the portal header and on the public pages, the app icons
  and favicon are the official files, and the emails use the brand palette.
- **The brand shows only through color.** Most screens are text on cal inside one 480 px column.
  There are no icons, illustrations, or photos anywhere in the product, so nothing carries the
  mark's vocabulary (arches, bubbles, sun) beyond the logo itself.
- **Several touchpoints have no logo at all:** sign-in, verify, invitation, the guest guide's
  error and status pages, and link previews of the guide.
- **Part of the design is specified but not built:**
  - the icon sprite of about 20 icons (brand guide §5, design system §8);
  - the portal sidebar at ≥ 1024 px, the phone bottom bar, and the 75 rem content width (design
    system §4 and §5);
  - the property photo on the guide home (design system §8);
  - illustrated empty states (brand guide §6);
  - the "Hecho con Guidesk" / "Made with Guidesk" footer on Free guides (brand guide §2.3).

## 2. Findings by surface

| Surface | Today | Proposal | Priority |
|---|---|---|---|
| Sign-in, verify, invitation | No logo. A plain form in a narrow column; Google and passkey buttons are text only. | Logo at the top. On desktop, a two-panel layout: the form, and an arena panel with an illustration (open door, bubble, sun) and the tagline. On phones, logo plus a small illustration. Google "G" mark on the Google button (Google's sign-in branding asks for it) and a key icon on the passkey button. | High |
| Portal shell (all signed-in pages) | Small logo and a row of seven underlined text links with no current-page mark. Every page sits in a 480 px column, even on a wide screen. | Build the shell the design system already describes: a sidebar from 1024 px with icons and a terracota-tinted current item, a five-item bottom bar on phones, content up to 75 rem, and a page header pattern (title, short help line, primary action). | High |
| Start and onboarding | "Cargando…" text, then a form. | A welcome moment: an illustration and a three-step progress line. | Medium |
| Properties list | Cards with a name and status chips only. | Cards in a grid with the property photo (section 3), the city, and the completeness meter in brand colors. Illustrated empty state with the "Add property" action. | High (after the photo exists) |
| Property overview and guide editor | Text lists. | A header with the property photo and name; section rows with the same icons the guest sees, so the host recognizes the guide. | Medium |
| Inbox, requests | Text cards; reason chips are text only. | Keep the text labels and add an icon per reason (emergency, malfunction, complaint, refund, booking change, extra). An illustrated "all caught up" empty state. | Medium |
| Analytics | Plain stat cards and CSS bars. | Terracota bar fills, trend arrows as icons, a short "what this means" line, and an illustrated state for "no data yet". | Low |
| Settings and plan | Long forms; the plan page does not look like the public plan cards. | A settings sub-navigation and plan cards that match the public home. | Low |
| QR poster | Property name, QR, Wi-Fi name, and a note. | A branded frame: the property photo when it exists, a bubble-shaped QR frame, and the small mark with "Guía digital por Guidesk". The host's name leads. | Medium |
| Guest guide home | Property name, stay times, and text tiles with a terracota left border. No photo, no icons, no welcome. | A property photo at the top (fixed size, small variant), "¡Bienvenida, {first name}!" when the stay link carries a first name, and an icon on every tile. | High |
| Guest guide status pages | "One moment" and similar pages are a bare heading and line. | The property name when known, a small illustration, and the Guidesk mark at the bottom. | Medium |
| Free guides | No Guidesk credit anywhere. | The "Hecho con Guidesk" footer with the 16–20 px mark, linking to the public home. It also brings new hosts. | High |
| Guide link previews (WhatsApp, email) | No Open Graph tags, so a shared link shows no image or description. | `og:title`, `og:description`, and `og:image` (the property photo, or a branded default card). | High |
| Public home | Text sections with a tagline. No product image, no icons. | A hero with an illustration or a phone mockup of a real guide, an icon per feature, illustrated "how it works" steps, and an Open Graph card with the logo and tagline. Optionally Fraunces for headlines on the public pages only, as the brand guide allows. | Medium |
| Emails | Brand palette and a CSS bubble before "Guidesk". | The logo as a hosted PNG once the domain exists (images may be blocked, so keep the text name). | Low |

## 3. Images

### 3.1 What exists

- **Guide photos and videos.** A guide item can be an image or a video. Uploads are scanned,
  stored per workspace, and served in variants (`small`, `large`); the guest page uses `srcset`,
  fixed dimensions, and lazy loading.
- **Explore.** Partner experiences carry an image URL and size from the catalog.
- **Profile pictures.** The account table keeps `image` from Google, unused in the UI.
- **Missing:** a property photo, extras photos, illustrations, and product images for marketing.

### 3.2 Opportunities, in order of value

1. **Property photo.** One cover photo per property, chosen from an upload (or from the photos a
   listing import already brought). It appears on the guide home, the guide's link preview, the
   property cards and header in the portal, and the QR poster. It reuses the media pipeline; the
   data change is one media reference on the property.
2. **Guide link previews.** The property photo as `og:image`, so the link the host sends looks
   like the house, not a bare URL.
3. **Photo prompts where a photo explains best.** The interview and the editor suggest a photo in
   arrival (the door, the lockbox), parking, Wi-Fi (the router), appliances, and checkout. These
   photos answer questions the chat would otherwise get.
4. **Extras photos.** An optional photo per extra (airport pickup, surfboard). Offer cards with a
   photo sell better than text.
5. **Illustrations.** About eight original flat SVGs from the mark's vocabulary: sign-in, welcome,
   no properties, inbox clear, no requests, no data yet, link expired, offline. Inline SVG, no
   JavaScript, recolored by the theme tokens so dark mode works.
6. **Public home product images.** Screenshots of the demo guide and the inbox, in a simple phone
   frame, exported as AVIF/WebP with fixed sizes.
7. **Demo photos.** The demo workspace with photos for Casa Brisa and Loft Escazú, so the demo
   looks like a real guide.
8. **Avatars.** The Google profile picture (or initials) in the header, members list, and inbox.

### 3.3 Rules

- **Performance.** The guest guide keeps its budgets (LCP ≤ 2.5 s, CLS ≤ 0.1, ≤ 500 KB initial
  weight). The home photo uses the small variant with fixed dimensions and is never the only
  content above the fold; the arrival times and tiles stay in the first HTML. Photos below the
  fold load lazily. Icons and illustrations are server-rendered SVG, so they add no JavaScript to
  the portal's JavaScript budget (150 KB per route then, 175 KB since 2026-11-23).
- **Security.** Images come only from the media origin already allowed by the content security
  policy; no third-party image hosts besides the Explore partners already listed.
- **Accessibility.** Decorative illustrations have empty `alt`; property and guide photos get alt
  text (the host can edit it); icons never replace a text label.
- **Ownership.** Guide photos belong to the host. Illustrations are original work for Guidesk.
  Demo and marketing photos must be photos Guidesk owns or licenses (brand guide §6 and §10); no
  glossy AI-generated imagery.

## 4. Proposed plan

| Phase | Scope | Data changes | Size |
|---|---|---|---|
| A. Brand presence | Logo and illustration on sign-in, verify, and invitation; icon sprite on guide tiles, portal navigation, and reason chips; illustrated empty and status pages; "Hecho con Guidesk" footer on Free guides; Open Graph tags and a default card for guides and public pages. | None | About 2 days |
| B. Portal shell | Sidebar from 1024 px, phone bottom bar, current-page mark, 75 rem content, page headers, grids for properties and analytics. | None | About 2–3 days |
| C. Photos | Property photo (upload, choose, show in the guide, previews, cards, poster); photo prompts in the interview and editor; extras photos; guest welcome by first name; avatars. | Media references on property and extra | About 3–4 days |
| D. Marketing polish | Public home hero, product screenshots, feature icons, Fraunces on public pages, demo photos, email logo. | None | About 2 days |

A and B can run in parallel; C depends on nothing in A or B; D needs the screenshots from A–C.
Every phase keeps the existing checks: the portal bundle budget, Lighthouse, axe, and the
WCAG 2.2 AA rules.

## 5. Decisions for the founder

1. **Photos for the demo and the public home:** your own photos of a real property (with the
   owner's permission), or licensed stock. **Decided 2026-11-19: the founder's own photos.**
2. **Fraunces on the public pages:** the brand guide allows it for marketing headlines.
   Recommendation: yes, self-hosted, one weight, Latin subset, public pages only.
3. **"Hecho con Guidesk" on Free guides:** the brand guide already says so. Recommendation: yes.
4. **Host branding** (the host's own logo or color on the guide): useful for property managers,
   but a separate feature. Recommendation: later, as a Business plan feature.
