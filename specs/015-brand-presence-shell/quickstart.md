# Quickstart: Brand Presence and Responsive Shell

## Prerequisites

- Local stack running (`docker compose up -d postgres mailpit`, migrations applied, `pnpm run dev`).
- A verified local account and a demo workspace (`pnpm --filter @guidesk/api demo:seed -- --email <account>`).

## Checks

1. **Shell at three widths.** Open `/es/inbox`, `/es/properties`, `/es/analytics`, and
   `/es/settings` at 375, 768, and 1280 px. Expect the bottom bar at 375 and 768, the sidebar at
   1280, the current entry marked, and no horizontal scroll ([portal shell](contracts/portal-shell.md)).
2. **More.** At 375 px, tap More: Shared content, Team, and Settings appear; Escape closes it and
   focus returns to More.
3. **No cut text.** Open the Casa Brisa guide home at 320 px in Spanish: "Electrodomésticos" and
   "Recomendaciones" are whole. Rename a property to a 60-character name and check the property
   list, the sidebar, and the guide top bar.
4. **Icons.** Every guide tile, navigation entry, and inbox reason chip shows an icon and its text.
5. **Sign-in.** Sign out, open `/es/sign-in` at 375 px and 1280 px, light and dark: logo,
   illustration, brand panel on wide screens, "G" on the Google button.
6. **Empty states.** Create a new workspace from the switcher and open Properties, Inbox,
   Requests, and Analytics.
7. **Credit.** The demo workspace is Pro: no credit. Open a guide of a Free workspace: the credit
   shows at the end of the home.
8. **Previews.** `curl -s <guide url> | grep -E 'og:|twitter:'` shows the property name, the fixed
   description, and the image URL; the stay link shows the same tags.
9. **Automated.** `pnpm turbo run test lint typecheck`, the portal and guide e2e suites (axe
   included), and `pnpm --filter @guidesk/portal bundle:check` after a production build.
