# Quickstart: Guest Guide

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) ·
**Contracts**: [HTTP API](contracts/http-api.md), [guest app](contracts/guide-web.md),
[emails](contracts/emails.md)

Validation scenarios that prove the feature works end to end. Commands assume the local setup of
features 001 to 003 (README): PostgreSQL in Docker on port 55432, Mailpit, the vault with the local
KMS key, and the fake model.

## Prerequisites

```bash
export PATH="$HOME/.cache/node/corepack/v1/pnpm/12.18.0:$PATH"
pnpm install
pnpm --filter @guidesk/db migrate
pnpm build
```

Start everything with the `dev` launch configuration (API on 4000, worker, portal on 3000, guest app
on `http://127.0.0.1:3001`). `GUIDE_URL=http://127.0.0.1:3001` must be set for the API (`.env`).

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/guide test
pnpm --filter @guidesk/guide size:check
pnpm exec playwright test e2e/specs/guest-us1.spec.ts e2e/specs/guest-us2.spec.ts e2e/specs/guest-us3.spec.ts e2e/specs/guest-us4.spec.ts e2e/specs/guest-us5.spec.ts e2e/specs/guest-us6.spec.ts --workers=1
pnpm exec playwright test e2e/specs/a11y.spec.ts --workers=1
```

Expected: everything passes; the guest script and styles stay within budget (R3); no axe violations.

## Scenario 1: property link and QR (US1)

1. Sign in as an owner, create a property from listing text, confirm core facts, add a lockbox code
   and a Wi-Fi password (public), publish the guide in Spanish and English (spec 003).
2. Open the property's Share screen. Copy the property link; download the QR as SVG and PNG; open
   the poster and print preview it.
3. Open the link in a phone-sized browser with English as its language: the guide shows in English,
   the Wi-Fi password shows with Copy, the lockbox code shows a lock with "Codes appear only with your
   stay link", and a recommendation with a declared benefit shows the disclosure.
4. Switch to Spanish; reload the bare link: it opens in Spanish.
5. View the page source and the network log: no locked value anywhere; responses carry
   `X-Robots-Tag: noindex` and `Referrer-Policy: no-referrer`.
6. Unpublish the guide; after at most about a minute the link shows the unavailable page.

## Scenario 2: stay link (US2)

1. Add a manual stay for the property from today to three days from now, and another starting in a
   week.
2. On the Share screen, copy the stay link of today's stay (confirm the sign-in when asked).
3. Open it in a fresh browser profile: the address changes to `/g/{publicId}/{lang}`, Back does not
   return to the token address, and the stay card shows the dates.
4. Tap Show code on the lockbox code: the value appears large; the owner's reveal history shows a
   guest reveal.
5. Open the second stay's link in another profile: the code shows "Available from …".
6. Revoke today's link on the Share screen; tap Show code again in the first profile: the code is
   hidden and the guide says the stay link ended.

## Scenario 3: confirmation code (US3)

1. Turn on "Ask for a confirmation code" on the Share screen; copy a stay link and note its code.
2. Open the link; Show code asks for the code. Enter a wrong code 5 times: the form shows a 15-minute
   countdown and Mailpit receives `guides.verification_locked` for the owners and admins.
3. In the database, clear `locked_until` for the stay link; enter the right code: the value shows,
   and the device is not asked again.

## Scenario 4: stay message (US4)

1. Copy the stay message in English without codes: it has the stay link, times, address, arrival
   steps, the Wi-Fi network, and "(shown in your stay link)" in place of the code.
2. Copy it again with "Include access codes" (confirm the sign-in): the code and Wi-Fi password are in
   the text, and the reveal history shows an export.
3. Copy the scheduled-message template in Spanish: it has the property link and no codes.

## Scenario 5: offline (US5)

1. Open the guide home and Arrival with a stay link inside the window and reveal the code.
2. In developer tools, go offline and reload: the pages open with the "Offline, saved copy" banner;
   the code field says to connect; Application → Cache Storage holds no value.
3. Open a section never visited: "This page isn't saved for offline use".

## Scenario 6: counts (US6)

1. Open the property link in two profiles and the stay link in one.
2. The Share screen shows the property link opens and, on the stay row, "Opened on 1 device" with the
   first opened time and values shown.
3. `SELECT * FROM guide_open_daily` shows counts only.

## Founder gates before the pilot

- The guide domain (`GUIDESK_GUIDE_DOMAIN`, with OQ-11) for production.
- The legal review of the benefit disclosure and the message template wording (OQ-35).
- CloudFront and WAF logging for the guide distribution that never records `/s/{token}` paths.
- A look at `429` counts for guest page renders on staging (research R20, item 4).
- This quickstart run on staging with a real phone on mobile data (LCP and the reveal flow).
