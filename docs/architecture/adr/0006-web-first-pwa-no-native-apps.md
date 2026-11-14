# 0006. Web-first delivery: progressive web apps instead of native apps

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder
- **Related:** [PRD](../../product/prd.md) · [Platform policies (PC-02)](../../research/platform-policies.md) · [Architecture overview](../overview.md) · [ADR-0004](0004-typescript-monorepo-stack.md)

## Context and problem statement

Should Guidesk ship native mobile apps (iOS and Android), or is a responsive web experience
enough? Three facts frame the question:

- **Guests** stay a few nights, and most will not install an app for that.
- **Airbnb policy** forbids requiring a third-party app to access the property or essential
  services (PC-02).
- **From Phase 2**, most guest conversation happens inside the OTAs' own apps (Airbnb,
  Booking.com, Vrbo), through PMS integrations.

On the host side, the individual host (P1) works mainly from a phone, and escalation alerts are
time-critical. Guidesk is built by one developer.

## Decision drivers

- Guest friction and adoption: open instantly from a link or QR code.
- Platform-policy compliance (PC-02).
- Time to market and maintenance cost for a solo developer.
- Reliable, timely escalation notifications for hosts.
- Ability to add native apps later without rework.

## Considered options

1. **Responsive web for guests and hosts, delivered as installable PWAs.**
2. **Native apps for guests and hosts.**
3. **Web for guests, plus a native host app from the MVP.**
4. **Web now; a cross-platform native host app (React Native or Expo) later, only if the pilot
   shows it is needed.**

## Decision outcome

Chosen option: **(1) now, with (4) as a planned re-evaluation after the pilot.** No native apps
in the MVP or Phase 2.

**Requirements this decision implies:**

- **Guest guide.**
  - A mobile-first PWA that opens from a link or QR code, with no install and no account.
  - Content already viewed works offline.
  - Installing to the home screen is optional and never required.
- **Host portal.**
  - Designed mobile-first, not merely responsive: onboarding, guide editing, inbox, and approvals
    must be fully usable on a phone.
  - Installable as a PWA.
- **Host notifications.**
  - Web push and email for every escalation, with email as the guaranteed fallback.
  - On iOS, web push only works for home-screen web apps (iOS 16.4 and later). Onboarding must
    therefore prompt iPhone hosts to add the portal to their home screen and test a notification.

### Consequences

- **Good:**
  - Zero install friction for guests.
  - Compliant with PC-02.
  - One codebase.
  - No app-store review cycles.
  - Instant deploys.
  - The fastest path to the MVP.
- **Bad:**
  - Web push on iOS depends on the host installing the PWA, so notification reliability must be
    measured.
  - Fewer device capabilities than native: background sync, rich widgets.
  - Guidesk gets no app-store presence as a discovery channel.

### Confirmation

During the pilot, measure:

- escalation notification delivery and median time-to-acknowledge, by device and OS;
- the share of host sessions on mobile;
- the share of iOS hosts who completed the PWA install;
- explicit host requests for an app.

### Triggers to revisit (start a native host app, option 4)

Revisit this decision if any of these appears:

- Hosts miss or acknowledge escalations late because web push is unreliable.
- Most inbox and approval activity happens on phones, and hosts report friction.
- Professional managers require a native app for their teams.

A native host app would reuse the TypeScript frontend code and the existing API. It would not
replace the web portal.
