# Quickstart: Validate the Desktop Design

## Prerequisites

- Local stack running (`dev` preview: portal 3000, guide 3001, API 4000; Docker Postgres 55432 and
  Mailpit 8025), a signed-in owner of a workspace with the demo data (`demo:seed`).
- If sign-in codes stop arriving, clear the local rate limits:
  `delete from rate_limit where key like '127.0.0.1|%'`.

## Checks

1. **Desktop shape (1280 px, light and dark)**: open Inbox, Requests, Properties, a property, its guide,
   a section, Share, Settings, and Add property. Buttons are label-sized, filters share one row, the
   current tab is filled, cards have an edge, badges are text-sized, requests show two columns, the
   property page has a side column, settings and add-property show icon cards.
2. **Phone shape (375 px)**: the same screens keep their single column and full-width primary buttons;
   the section editor toolbar is a compact row; option cards have gaps; dates read "26 sept 2026".
3. **Workspace menu**: at 1280 px open the switcher in the sidebar; the menu covers the navigation.
4. **Loading**: throttle the network (Slow 4G) and reload `/es/inbox`; the logo and navigation show at
   once and the page shows the placeholder until the list arrives.
5. **Guest guide**: open the demo guide at 1280 px (arena backdrop, card column, three tile columns) and
   at 375 px (unchanged).
6. **Automated**:
   - `pnpm --filter @guidesk/portal typecheck && pnpm --filter @guidesk/portal lint && pnpm --filter @guidesk/portal test`
   - `pnpm --filter @guidesk/portal build && pnpm --filter @guidesk/portal bundle:check`
   - `cd e2e && pnpm exec playwright test brand-shell desktop-layout a11y extras-us2 inbox-us1 --workers=1`
