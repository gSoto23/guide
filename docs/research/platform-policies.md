# Platform Policies and Design Constraints

> **Status:** Research — verified as of 2026-11-13 · **Owner:** Founder · **Related:** [PRD](../product/prd.md) · [ADR-0003](../architecture/adr/0003-phased-channel-integration-strategy.md) · [Integrations](integrations.md) · [Monetization partners](monetization-partners.md) · [Open questions](../open-questions.md)

This page sets out the rental-platform and messaging policies that constrain Guidesk's guide, agent and service sales, and turns them into testable design constraints. It is a research summary, not legal advice. Every constraint below needs legal review before it is treated as compliance guidance.

## Executive summary

- **Off-platform and fee transparency policy (Airbnb, May 2025).**
  - Mandatory fees and booking changes must go through Airbnb.
  - Links that take people off the platform are prohibited.
  - Pre-booking communication stays on Airbnb.
  - Optional fees may be paid off-platform if the guest agrees.
- **"Limiting host-imposed contracts and other requirements" (Airbnb, bookings from 2026-11-20).**
  - Hosts may not require a third-party app or registration for access.
  - Hosts may not request contact data or IDs unless legally required.
  - Recommendations of local businesses are allowed only if optional and with any financial benefit to the host disclosed.
- **Airbnb's API Terms prohibit commercial messages** unless partner terms authorize them. Airbnb's content policy reportedly bans advertising businesses unrelated to the listing.
- **Airbnb's Terms of Service ban bots, crawlers and scrapers.** Breaches can lead to account suspension.
- **Booking.com's Messaging API** allows property messages only from reservation until 7 days after checkout.
- **Meta's WhatsApp policy** has banned general-purpose chatbots since 2026-01-15. This was one input to Guidesk's rejection of WhatsApp.
- **Sending the guide link after confirmation is a grey area.** It is common practice and third-party sources consider it permitted, but it is not formally confirmed.

## Airbnb

### Off-platform and fee transparency policy (effective 2025-05-10)

Source: [help article 2799](https://www.airbnb.com/help/article/2799).

- **Fees and changes:** mandatory fees and booking modifications must be processed through Airbnb.
- **Optional fees** (Airbnb's example is pool heating) may be paid off-platform if the guest agrees.
- **Links:** links in listings or messages that take people off the Airbnb platform are prohibited.
- **Pre-booking communication** must stay on Airbnb, and links and contact details are removed ([help 1121](https://airbnb.com/help/article/1121)).
- **A third-party summary** of the May 2025 changes ([Rental Scale-Up](https://www.rentalscaleup.com/airbnb-new-off-platform-policy-may-2025/), third-party source) adds three points for the post-booking period:
  - hosts may not request guest contact details, except for a legal reason or at the guest's request;
  - hosts may not use those details for marketing;
  - hosts may not require a third-party app or account, though optional concierge apps are allowed.

### Limiting host-imposed contracts and other requirements (bookings from 2026-11-20)

Source: [help article 4169](https://www.airbnb.com/help/article/4169), accessed 2026-11-13.

- **Apps and registration:** hosts may not require a third-party app or external registration to enter the property or use an essential service. Optional apps, including concierge apps, are allowed.
- **Personal data:** hosts may not request personal data, including contact details and identity documents, unless the law or a documented community standard requires it. This directly affects any agent that would move the conversation to WhatsApp.
- **Recommendations:** hosts may recommend experiences, restaurants or local businesses if the recommendation is optional and any direct financial benefit to the host is disclosed. The product therefore has to show a commission disclosure.

### API Terms (updated 2025-10-15)

Source: [API Terms](https://www.airbnb.com/terms/api).

- **Commercial messages** are prohibited unless the partner's terms authorize them.
- **Partner conditions:**
  - a mutual NDA and a security review;
  - incident reporting within 1 hour;
  - termination at any time, for any reason.
- **Reach of these terms.** They bind direct API partners. How they flow down to vendors that integrate through a PMS was not researched.

### Content policy

- **Unrelated advertising.** Airbnb's content policy prohibits advertising businesses unrelated to the listing. The research cites this without a specific source URL (unverified).

### Terms of Service — automation

- **Automation ban.** Section 11.1 bans bots, crawlers, scrapers and other automated means. Section 12.3 provides for account suspension ([ToS, updated 2026-02-05](https://www.airbnb.com/help/article/2908)).

### Commercial context

- **Airbnb as a competitor.** Airbnb has sold Services and Experiences in its own app since 2025-05-13 ([Airbnb](https://news.airbnb.com/en-au/2025-may-release-now-you-can-airbnb-more-than-an-airbnb/)). How it interprets "commercial messages" from third parties is therefore a material risk.
- **Damage waivers.**
  - AirCover already protects hosts, and most hosts cannot require a deposit.
  - According to Enso, optional damage waivers remain permitted after booking (see [monetization-partners.md](monetization-partners.md)).

## Booking.com

- **Messaging window.** The Messaging API lets the property message from the reservation until 7 days after checkout. Messaging certification requires PII compliance ([Messaging API](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api), [Going live](https://developers.booking.com/connectivity/docs/going_live)).
- **Guest email aliases.** Booking.com forwards messages through guest email aliases but recommends replying in the extranet ([partner help](https://partnerhelp.booking.com/hc/en-us/articles/115003970605-Why-does-the-guest-s-email-address-end-with-guest-booking-com-)).
- **Automation.** Booking.com prohibits automated access without written permission ([conductatlas](https://conductatlas.com/platform/bookingcom/bookingcom-terms-and-conditions/provision/CA-P-076605/automated-access-to-platform-prohibited-without-written-permission/), third-party source).
- **No direct onboarding.** New connectivity providers are paused, so Guidesk reaches Booking.com threads only through PMS partners (see [integrations.md](integrations.md)).

## Meta WhatsApp Business: context for the rejection

**The policy.** Since 2026-01-15, WhatsApp has barred general-purpose chatbots, while support and sales assistants for a business remain allowed ([TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)).

**The decision.** On 2026-11-13 Guidesk rejected WhatsApp (and email/SMS) as guest channels, for four reasons:

1. product scope;
2. Airbnb's ban on requesting guest contact data, since WhatsApp requires the guest's phone number;
3. this Meta policy, which would have imposed a second set of scope limits on the agent;
4. per-message costs.

See [integrations.md](integrations.md#option-d--guide-chat-adopted-and-whatsapp-rejected).

## How incumbents handle compliance

| Incumbent | Approach | Source |
|---|---|---|
| **Enso Connect** (updated 2026-11-03) | **Optional guide:** the Boarding Pass is offered, never required, and access instructions go through the Airbnb thread if the guest declines it. **ID checks:** identity verification is no longer on by default. **Upsells:** allowed as long as access never depends on buying them, with partner commissions disclosed | [Enso](https://ensoconnect.com/resources/staying-compliant-with-airbnb-s-new-policy-update) |
| **Touch Stay** | Warns that a guide promoting off-platform booking can get a listing delisted | [help](https://help.touchstay.com/article/234-how-to-keep-your-airbnb-listings-safe-from-delisting) |
| **Hostaway** | Warns hosts against requiring registrations or apps | [support](https://support.hostaway.com/hc/en-us/articles/37010617324827-Airbnb-Fee-and-Registration-Requirements) |
| **Hospitable** | In its community, whether upsell links may be sent in messages is still unresolved | No URL captured |

**In practice,** sending the guide link after confirmation is common and third-party sources consider it permitted. Formally it remains a grey area.

## Implications for Guidesk

- **The adopted MVP fits these policies.** A web guide with in-guide chat, linked after confirmation and requiring no guest contact data, matches the policies better than a WhatsApp handoff would.
- **The in-guide chat must be anonymous by default.** Guests are identified by their reservation context, not by phone or email.
- **Selling belongs in the guide, with disclosure.** In OTA threads the agent should stick to stay-related service replies until partner terms on commercial messages are clarified.
- **Policy rules must be per channel.** Airbnb has the most restrictive of the researched rules. The research suggests reserving more prominent offers for Booking.com and Vrbo bookings, subject to their own policies, which were not researched.
- **Copilot drafts carry the same exposure.** A non-compliant draft pasted by the host still puts the host's listing at risk.

## Design constraints

These are written as testable requirements. **All require legal review** before launch and must be re-checked whenever platform policies change.

1. **PC-01:** The guide MUST be optional for the guest. Access instructions and other essential information (check-in, Wi-Fi) MUST also be deliverable through the OTA message thread.
2. **PC-02:** Access to the property or any essential service MUST NOT depend on opening the guide, installing an app, creating an account, or registering with Guidesk or any third party.
3. **PC-03:** Guidesk MUST NOT request phone numbers, email addresses, identity documents or other personal data from Airbnb guests, unless the law (or a documented Airbnb community standard) requires it. The in-guide chat MUST work without any guest contact data.
4. **PC-04:** Identity verification and guest-registration forms MUST be off by default for Airbnb bookings. They may be enabled only where legally required, with the legal basis recorded in the property configuration.
5. **PC-05:** The guide link MUST only be sent after booking confirmation. Pre-booking Airbnb messages generated or drafted by Guidesk MUST contain no links or contact details.
6. **PC-06:** No link or content produced by Guidesk (guide, agent, message templates, copilot drafts) may move the booking, a booking change, or its payment off-platform. Fees that are mandatory for the stay MUST be collected only through the OTA.
7. **PC-07:** Any commission or other direct financial benefit to the host from a recommended service MUST be disclosed in the guest UI at the point of offer. Partner commissions earned by Guidesk SHOULD also be disclosed, as Enso does.
8. **PC-08:** All purchases MUST be opt-in and charged only with the guest's explicit consent. Access to the property MUST never depend on a purchase.
9. **PC-09:** Guidesk MUST NOT be used to require a security deposit from Airbnb guests. Damage waivers, if offered, MUST be optional and offered only after booking.
10. **PC-10:** The agent MUST NOT send unsolicited commercial or promotional messages in OTA threads unless the applicable partner or API terms explicitly authorize it. It MUST NOT advertise businesses unrelated to the listing.
11. **PC-11:** Guest data received through integrations (for example, from a PMS) MUST NOT be used for marketing.
12. **PC-12:** Guidesk MUST NOT read or send OTA messages through scraping, browser automation or email-reply relays. It MUST NOT store hosts' OTA passwords or 2FA codes.
13. **PC-13:** Outbound Booking.com messages through an integration MUST only be sent between reservation and 7 days after checkout. The messaging layer MUST enforce this window.
14. **PC-14:** Copilot drafts that the host pastes into an OTA chat MUST pass the same policy checks as automated messages (PC-05, PC-06, PC-10).
15. **PC-15:** Any new guest channel (for example WhatsApp, email or SMS) MUST pass a policy and legal review before it is built. These channels are out of scope under the 2026-11-13 decision.

## Unverified / open items

- **Date and wording of the contact-data rule disagree between sources.**
  - The third-party summary ([Rental Scale-Up](https://www.rentalscaleup.com/airbnb-new-off-platform-policy-may-2025/)) dates the contact-data and required-app restrictions to May 2025, with an exception for a legal reason or a guest request.
  - Airbnb's article 4169 applies them to bookings from 2026-11-20, with an exception where the law or a documented community standard requires it.
  - Legal review should settle which rule applies to which bookings.
- **The content-policy restriction** on unrelated advertising has no source URL in the research.
- **Whether a post-confirmation guide link** in scheduled messages is formally permitted is unconfirmed (grey area).
- **How Airbnb interprets "commercial messages"** for agent replies inside threads is unknown, and how API Terms flow down to PMS-integrated vendors was not researched.
- **Hospitable's unresolved community thread** on upsell links in messages has no URL captured.
- **Other platform policies:** guest-content policies at Booking.com and Vrbo, beyond Booking.com's messaging window, were not researched. Nor were PMS partner terms on commercial messaging.
- See [open questions](../open-questions.md).

## Sources

- [Airbnb help 2799 — Off-platform and fee transparency policy](https://www.airbnb.com/help/article/2799)
- [Airbnb help 1121 — pre-booking communication](https://airbnb.com/help/article/1121)
- [Airbnb help 4169 — Limiting host-imposed contracts and other requirements](https://www.airbnb.com/help/article/4169)
- [Rental Scale-Up — Airbnb off-platform policy (May 2025)](https://www.rentalscaleup.com/airbnb-new-off-platform-policy-may-2025/)
- [Airbnb API Terms](https://www.airbnb.com/terms/api)
- [Airbnb Terms of Service](https://www.airbnb.com/help/article/2908)
- [Airbnb — May 2025 release (Services and Experiences)](https://news.airbnb.com/en-au/2025-may-release-now-you-can-airbnb-more-than-an-airbnb/)
- [Booking.com Messaging API](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api)
- [Booking.com Going live](https://developers.booking.com/connectivity/docs/going_live)
- [Booking.com partner help — guest email aliases](https://partnerhelp.booking.com/hc/en-us/articles/115003970605-Why-does-the-guest-s-email-address-end-with-guest-booking-com-)
- [conductatlas — Booking.com automated access provision](https://conductatlas.com/platform/bookingcom/bookingcom-terms-and-conditions/provision/CA-P-076605/automated-access-to-platform-prohibited-without-written-permission/)
- [TechCrunch — WhatsApp bars general-purpose chatbots](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)
- [Enso Connect — staying compliant with Airbnb's new policy](https://ensoconnect.com/resources/staying-compliant-with-airbnb-s-new-policy-update)
- [Touch Stay — avoiding delisting](https://help.touchstay.com/article/234-how-to-keep-your-airbnb-listings-safe-from-delisting)
- [Hostaway — Airbnb fee and registration requirements](https://support.hostaway.com/hc/en-us/articles/37010617324827-Airbnb-Fee-and-Registration-Requirements)
