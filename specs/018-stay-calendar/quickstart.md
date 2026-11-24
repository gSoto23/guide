# Quickstart: Stay Calendar and Guest Details

**Feature**: [spec.md](spec.md)

## Local

Prerequisites: the local stack (`pnpm dev`) and a demo workspace (`pnpm --filter @guidesk/api
demo:seed -- --email <you>`), which has two properties, past, current, and upcoming stays, add-on
requests, and an open escalation.

1. Open **Calendario** (sidebar, or "Más" on a phone). The current month shows both properties with
   their stays; the current stay of Casa Brisa shows the opened-link and add-on marks.
2. Move to next month and back with "Hoy"; filter to one property; turn on "Mostrar canceladas".
3. At phone width (412 px) the page becomes an agenda by day with no horizontal scroll.
4. Open the current stay: dates, channel, link state, the open escalation's conversation, and the
   add-on requests with their states and the total.
5. As owner, "Editar huésped": type "Ana" and 2 → the calendar, the inbox row of that stay's
   conversation, and the Requests screen show "Ana". Copy the stay message on the Share screen → it
   starts with "¡Hola, Ana!". Open the guest guide with the stay link → no name anywhere.
6. Sign in as an agent: the calendar and stay view show the name; no edit action, no link copy.
7. Feed: add a calendar feed whose entries carry an Airbnb reservation link (fixture
   `e2e/fixtures/airbnb.ics` or a test feed) → the stay shows "Huésped de Airbnb · HM…" and no phone
   digits are stored.

## Staging

After the deploy, open https://staging.guidesk.io/es/calendar with the founder's demo workspace and
repeat steps 1, 4, and 5.
