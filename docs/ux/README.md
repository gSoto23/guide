# UX and UI Design

> **Status:** Draft v0.1 (provisional) · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [PRD](../product/prd.md) · [Personas](../product/personas.md) · [Platform policies](../research/platform-policies.md) · [Security](../architecture/security.md) · [Performance](../architecture/performance.md) · [Spec 001](../../specs/001-workspace-accounts/spec.md)

The UX documentation turns the PRD, the platform policies, and the security and performance
constraints into principles, structure, flows, screens, and a provisional visual foundation.
It does not change any product, policy, or security decision. Feature specs remain the source of
truth for behavior; when a spec and these documents disagree, the spec wins and these documents
are updated.

## Documents

| Document | What it answers |
|---|---|
| [Principles and IA](principles-and-ia.md) | Design principles, sitemaps for the guest guide and the host portal, the mobile navigation model, what each role sees |
| [User flows](user-flows.md) | Nine end-to-end flows with diagrams, narratives, and key states (empty, loading, error, offline, locked, limit) |
| [Screen inventory](screens.md) | Every screen with its purpose, content, actions, states, persona, and phase |
| [Design system](design-system.md) | Provisional color tokens with contrast ratios, typography, spacing, components, accessibility rules, internationalization, and performance constraints |
| [Wireframes](wireframes.html) | Twelve low-fidelity mobile wireframes in one self-contained HTML file (open it in a browser) |

## What is provisional

- **The visual brand (OQ-11).** Colors, the primary hue, radius, the logo, and the product name in
  the wireframes are placeholders. The token names and the accessibility rules should survive the
  brand work; the values will change.
- **The guest verification screen (OQ-20).** The wireframes assume a short code shared in the
  booking thread. Spec 004 decides the method.
- **Offline arrival steps (OQ-28).** The default design never stores codes offline; a "Save until
  checkout" action is shown only as an option.
- **Disclosure wording.** English and Spanish texts are proposals for the legal review (OQ-35)
  and depend on whether hosts share affiliate commissions (OQ-08).
- **Spanish register.** The interface uses "tú" in neutral Latin American Spanish until pilot
  hosts confirm it.
- **Thresholds that need pilot data:** the "5 unchanged approvals" suggestion for more autonomy,
  the request expiry rule for extras, and section order on the guide home.
- **Assumptions about roles:** agents view guides read-only, without restricted values; who may
  confirm extras and issue refunds is settled in specs 008 and 013.

## Gaps found while designing

These need a decision in the relevant spec or open question. The UX documents show an interim
design for each.

1. **Stay links without a PMS.** SEC-01 requires a per-stay link to unlock restricted fields, but
   in the MVP the host delivers the guide through OTA scheduled messages, which send the same text
   to every booking. The interim design lets the host copy a stay link for each booking from the
   Share screen. OQ-20 (spec 004) should decide whether verification can work from the property
   link instead.
2. **Telling the guest that the host replied.** Guide-chat guests share no contact data (PC-03),
   so a host reply or a confirmed extra appears only when the guest reopens the guide. The flows
   remind guests that the platform thread also reaches the host. Whether to offer optional browser
   notifications to guests is undecided.
3. **The `draft` default and the pilot target.** With autonomy at `draft` by default (FR-07.1),
   every guide-chat answer waits for the host, while the pilot targets ≥ 60% of questions answered
   without the host. The design adds a "choose how the assistant replies" onboarding step and a
   suggestion after unchanged approvals; the default itself is unchanged.
4. **Codes typed into AI inputs.** FR-03.9 keeps imported sensitive values away from the AI, but a
   host can still type a door code into the interview or paste listing text or screenshots that
   contain one. Spec 003 should define detection or redaction before text reaches the model.
5. **Wi-Fi password classification.** The security architecture classifies Wi-Fi passwords as
   restricted, while FR-03.7 lets the host choose which fields are sensitive. The UX supports
   both; one rule should be chosen.
6. **The "3–10 properties" onboarding path.** Spec 001 defines the paths for "1–2" and "10+ with a
   PMS" only. The design sends "3–10" to the individual path with bulk options visible.
7. **Passkey sign-up.** Spec 001 lists passkeys as a sign-up method (FR-001), but FR-002 verifies
   new accounts by email code or Google. The design treats passkeys as a sign-in method added
   after the first sign-in.
8. **Voice notes need speech-to-text.** FR-03.3 requires voice-note answers, but no provider is
   named; it would be a new subprocessor (constitution VI).

## How to use these documents

- **When writing a spec:** link the relevant flow and screens, and copy the key states into the
  acceptance scenarios.
- **When writing a plan:** check the performance constraints in the design system against the
  plan's budget.
- **When the brand is decided:** replace the color values, re-check every contrast pair in the
  design system, and update the wireframes.
