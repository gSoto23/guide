# Channel Integration Options

> **Status:** Research — verified as of 2026-11-13 · **Owner:** Founder · **Related:** [ADR-0003](../architecture/adr/0003-phased-channel-integration-strategy.md) · [Platform policies](platform-policies.md) · [Competitive landscape](competitive-landscape.md) · [Roadmap](../product/roadmap.md) · [Open questions](../open-questions.md)

How the Guidesk agent can reach guests in the only two channels in scope: the rental platforms' message threads (Airbnb, Booking.com, Vrbo) and the chat inside the Guidesk web guide. Figures marked "(est.)" are researcher estimates and are not verified.

## Executive summary

- **No direct OTA integration is available today.** Airbnb API access is invitation-only. Booking.com has paused onboarding of new connectivity providers. Vrbo/Expedia requires full distribution software, not a messaging-only product.
- **PMS APIs are the shortest official path into the OTA thread.** Hostaway, Guesty, Hospitable, Smoobu, OwnerRez, Hostfully, Beds24 and Hostex document endpoints for this. The path mainly serves professional managers.
- **Individual hosts without a PMS have no cheap, clean path.** White-label providers would make Guidesk their channel manager and move them to Airbnb's 15.5% host-only fee.
- **MVP:** the web guide plus in-guide chat. The guide link is sent through each OTA's native scheduled messages after booking confirmation.
- **Rejected 2026-11-13:** WhatsApp, and email/SMS, by product decision.
- **Prohibited:** unofficial methods (scraping, browser automation, email-reply relays).
- **Integration does not make selling in the thread acceptable.** Airbnb's API Terms restrict commercial messages (see [platform-policies.md](platform-policies.md)).

## Option A — Direct OTA partnerships

**A1. Airbnb**

- **Closed, invitation-only.** An October 2026 analysis cites Airbnb's partner page as not accepting new API access requests ([bnbcalc](https://www.bnbcalc.com/help/articles/does-airbnb-have-an-api), third-party source); a November 2025 forum thread agrees. The official page ([airbnb.com/partner](https://www.airbnb.com/partner)) did not render (unverified first-hand). Partner managers invite partners.
- **Conditions if invited** ([API Terms, updated 2025-10-15](https://www.airbnb.com/terms/api)):
  - a mutual NDA and a security review;
  - mandatory features within 6 months;
  - incident reports within 1 hour;
  - termination at any time, for any reason;
  - no commercial messages unless the partner terms authorize them.
- **Partners:** 32 Preferred/Preferred+ partners in 2025, admitted after audits ([bnbnews](https://bnbnews.gr/en/otas/28919/airbnb-new-list-of-preferred-software-partners-for-2025/)).
- **Messaging endpoints:** Homes API endpoints are confidential; the public portal only lists a Messages API for Activities ([portal](https://developer.withairbnb.com/)).
- **Cost:** not published. **Timeline:** indefinite.

**A2. Booking.com**

- **Paused.** The official page says new connectivity providers are paused "until further notice", with no date ([connect.booking.com](https://connect.booking.com), accessed 2026-11-13). An external evaluator confirmed this in November 2026 ([Supergood](https://supergood.ai/api-report-card/booking-com)).
- **The Messaging API is complete** ([docs](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api)):
  - it reads and sends messages and attachments;
  - it raises a `MESSAGING_API_NEW_MESSAGE` notification;
  - properties can message from the reservation until 7 days after checkout.
- **Certification:** requires PII compliance ([Going live](https://developers.booking.com/connectivity/docs/going_live)).
- **Cost:** not published.

**A3. Vrbo / Expedia Group**

- **Distribution software required.** The program requires "Property Distribution Software": rates/availability and reservations APIs, plus PCI compliance ([CPP, 2027/28 criteria announced Oct 2026](https://developers.expediagroup.com/supply/lodging/cpp/overview)).
- **No public application:** only an eligibility form, with no published minimums.
- **Messaging exists** via GraphQL ([docs](https://developers.expediagroup.com/supply/lodging/docs/property_mgmt_apis/messaging/getting_started/intro)).

**Verdict:** Option A is not viable for the next 12 months. Re-evaluate once Guidesk has thousands of properties.

## Option B — PMS / channel manager APIs

| PMS | Messages reach the OTA thread? | Third-party access | Guide data |
|---|---|---|---|
| **Hostaway** | **Yes.** `POST /v1/conversations/{id}/messages`, 30 req/min per account ([API](https://api.hostaway.com/documentation)). Uses the OTA APIs for Airbnb, Booking.com and Vrbo ([support](https://support.hostaway.com/hc/en-us/articles/9996470461979-Vrbo-How-Messaging-Works)) | **Process:** Partner Program, certification and Marketplace review (200+ integrations). **Fees:** not published ([marketplace](https://hostaway.com/marketplace/)). **Auth:** the customer pastes an API key and Account ID (not true OAuth) | **Yes:** check-in, Wi-Fi, `houseRules`, door codes, amenities |
| **Guesty** | **Yes.** `POST /communication/conversations/{id}/send-message`, with types `airbnb2`, `whatsapp`, `sms` and others ([ref](https://open-api-docs.guesty.com/reference/post_communication-conversations-conversationid-send-message)) | **Process:** Marketplace partners are asked not to use the Open API and to contact partnerships ([quick start](https://open-api-docs.guesty.com/docs/quick-start-guide)). **Plan:** Open API on Pro or higher (unverified). **Fees:** not published | Yes |
| **Hospitable** | **Yes.** `POST /v2/reservations/{id}/messages`, relayed to the OTA ([apis.io](https://apis.io/apis/hospitable/hospitable-messages-api/), third-party source) | **Auth:** vendor OAuth after applying ([help](https://help.hospitable.com/en/articles/16234154-how-can-i-become-an-integration-partner-with-hospitable-com-and-list-my-integration)). **Fees:** says it does not charge vendors ([report](https://en.10minhotel.com/2025/07/15/89-of-tech-vendors-say-pms-imposed-fees-are-blocking-innovation-in-the-short-term-rental-sector-hospitable/)). **Plan:** API only on paid plans, Host USD 29/month ([pricing](https://help.hospitable.com/en/articles/4596748-hospitable-pricing-subscription-costs)) | Yes |
| **Smoobu** | **Yes.** `send-message-to-guest` ([docs](https://docs.smoobu.com/)) | **Auth:** OAuth2 for Smoobu partners only; contact them first. **Legacy:** API key retirement dated 2026-10-31 | Yes |
| **OwnerRez** | **Yes** (`/v2/messages`) | **Auth:** messaging only via an OAuth app. **Process:** a partner agreement is required for public integrations ([staff, 2026-07-03](https://www.ownerrez.com/forums/requests/readonly-messaging-access-via-personal-access-token-no-oauth-required)) | Yes |
| **Hostfully** | **Yes**, when the lead comes from Vrbo, Booking.com or Airbnb ([docs](https://dev.hostfully.com/v3.0/reference/messages)) | **Process:** partner program; terms unverified | Yes |
| **Beds24** | **Yes**, for Airbnb and Booking.com ([doc](https://beds24.com/api/json/setMessage)) | **Auth:** open API with token | Yes |
| **Hostex** | `POST /conversations/{id}` (v3.0 beta) plus webhooks ([docs](https://api-doc.hostex.io/)); per-channel behavior unconfirmed | **Auth:** token | Partial |
| **Lodgify** | **Unverified.** Docs block automated access | — | — |
| **Uplisting** | **Unverified.** "Invite-only" API ([apis.io](https://apis.io/apis/uplisting/uplisting-messages-api/), third-party source) | — | — |
| **Stays.net (LATAM)** | **Product:** open API and Airbnb/Booking.com messaging. **Message endpoints:** unverified | App Center | — |

**Market share.** All of these figures are self-reported; there is no independent data:

- **Guesty:** about 500,000 properties ([Guesty](https://www.guesty.com/comparisons/guesty-vs-hostaway/)).
- **Hostaway:** 100,000+ (a dated figure), and raised USD 365M in December 2024 ([PYMNTS](https://pymnts.com/news/investment-tracker/2024/hostaway-secures-365-million-to-expand-short-term-rental-platform)).
- **Stays:** says it is number one in LATAM with 17,000+ properties ([stays.net](https://stays.net/?gad=1)).

**Profile:**

- **Cost:** 2–6 weeks per PMS (est.), plus approval times that are not published.
- **Recurring fees:** often USD 0 for the vendor. A report published by Hospitable says some unnamed PMSs charge up to USD 10,000 upfront or up to 20% of revenue.
- **Unified API:** Calry covers about 40 PMSs at custom pricing and is used by HostAI and Hostbuddy. Its messaging coverage is unconfirmed ([Calry](https://calry.app/pricing)).
- **Segment:** professional managers, plus individuals on Hospitable or Smoobu.
- **Risks:** approval from each PMS, heterogeneous APIs, and Hostaway's API-key onboarding.

## Option C — White-label unified providers

| Provider | Pricing | Messaging | Notes |
|---|---|---|---|
| **Channex** | **Pricing:** USD 130/month, plus USD 0.50/unit, plus USD 0.50/unit for the Chat add-on ([pricing](https://channex.io/pricing.md), no effective date). **Examples:** about USD 230/month for 100 units, about USD 1,130 for 1,000 | **Covered:** Booking.com, Airbnb, Expedia. **Not covered:** Vrbo ([docs](https://docs.channex.io/api-v.1-documentation/messages-collection)) | **Sales model:** wholesale infrastructure only. **Airbnb:** OAuth, but it **fails if another PMS is connected** ([help](https://help.channex.io/en/articles/8225359-how-to-connect-with-airbnb)) |
| **NextPax** | **Pricing:** USD 3.60/unit/month billed annually, **minimum USD 350/month** ([pricing](https://nextpax.com/nextpax-pricing)) | Airbnb, Booking.com, Vrbo (company claim) | White-label Messaging API |
| **Rentals United** | **Quote only** | **Covered:** Airbnb, Booking.com, Vrbo. **Limits:** e.g. Booking.com structured requests are not synced ([docs](https://docs.rentalsunited.com/external/en-gb/Content/RU-platform/GuestCommunication/Basic-Use-API.htm)) | — |

**Structural issues:**

1. **Guidesk becomes the channel manager.** It would own the host's rates and availability, along with the overbooking risk.
2. **The 15.5% host-only fee.** Since 2025-10-27, Airbnb puts software-connected hosts on its 15.5% host-only fee ([Hostaway](https://support.hostaway.com/hc/en-us/articles/40440128540699-Airbnb-Fee-Structure-Changes-for-Hostaway-Users)). That is strong friction for individuals still on the split fee.
3. **PMS conflict.** Channex cannot serve hosts who already have a PMS.

**A workable alternative.** Airbnb allows a "messaging software" connection alongside a PMS ([Airbnb help](https://www.airbnb.com/help/article/2958)). Hospitable sells this as a "limited connection": messaging without the calendar ([help, 2026-09-08](https://help.hospitable.com/en/articles/8889941-airbnb-using-other-software-with-airbnb-limited-connection)). Whether Channex offers a messaging-only connection is unconfirmed.

## Option D — Guide chat (adopted) and WhatsApp (rejected)

**D1. Web guide + in-guide chat (adopted)**

- **How it works:** the guest opens the guide from a link sent after confirmation through the OTA's [scheduled messages](https://www.airbnb.com/support/article/2897). The agent answers in the guide chat, where offers are opt-in. This follows Airbnb's link and contact-data rules (see [platform-policies.md](platform-policies.md)).
- **Cost:** 4–8 weeks (est.). There are no per-message channel fees; hosting and AI inference costs were not estimated.
- **Segment:** both.
- **Risks:**
  - guests have to leave the OTA chat to use it;
  - how Airbnb interprets "commercial messages";
  - Airbnb has sold tours and services itself since 2025-05-13 ([Airbnb](https://news.airbnb.com/en-au/2025-may-release-now-you-can-airbnb-more-than-an-airbnb/)).

**D2. WhatsApp agent (evaluated, rejected 2026-11-13)**

The research recommended WhatsApp plus web chat for the MVP. The founder rejected the WhatsApp variant for four reasons:

1. **Product decision.** Guest channels are limited to OTA chats and the in-guide chat.
2. **Airbnb's contact-data ban.** WhatsApp needs the guest's phone number, and Airbnb prohibits requesting guest contact data unless legally required (see [platform-policies.md](platform-policies.md)).
3. **Meta's ban on general-purpose chatbots,** in force since 2026-01-15. Business support and sales assistants remain allowed ([TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)), but WhatsApp would add a second policy limiting the agent's scope.
4. **Per-message costs.**
   - **Meta pricing:** per-message since 2025-07-01. From 2026-10-01, service messages are free only up to 1,000 per number per month, then charged at the country's utility rate ([Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)).
   - **Reference rates (secondary sources):** US service about USD 0.0034; Brazil service/utility USD 0.0068 and marketing USD 0.0625 ([Courier](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026)); Mexico marketing USD 0.0397 ([YCloud](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026.md)). Colombia, Argentina and Chile are unverified.
   - **Provider fees:** Twilio adds USD 0.005 per message ([Twilio](https://www.twilio.com/en-us/whatsapp/pricing)). 360dialog charges a USD 49–59 monthly license per number; sources give contradictory figures ([docs](https://docs.360dialog.com/partner/get-started/pricing-and-billing)).
   - **One number per host** would require Tech Provider status ([Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)).
   - **Estimated cost per stay (est.):** about USD 0.22–0.28 with Twilio (US/Brazil), or under USD 0.12 plus a fixed license with Meta direct or 360dialog.

## Option E — Unofficial methods (prohibited)

- **Email replies are unreliable.**
  - Airbnb email replies are reported as unreliable ([forum](https://community.withairbnb.com/t5/Community-cafe/Emails-Responses-not-Forwarded/td-p/1567121)).
  - Booking.com recommends replying in the extranet rather than to its guest aliases ([partner help](https://partnerhelp.booking.com/hc/en-us/articles/115003970605-Why-does-the-guest-s-email-address-end-with-guest-booking-com-)).
  - Guidesk would also need to read hosts' mailboxes, and Gmail's restricted scopes reportedly require an annual security audit (unverified).
- **Scraping and browser automation breach platform terms.**
  - They violate Airbnb ToS §11.1 (no bots, crawlers or scrapers), and §12.3 allows suspension ([ToS, updated 2026-02-05](https://www.airbnb.com/help/article/2908)).
  - Booking.com prohibits automated access ([conductatlas](https://conductatlas.com/platform/bookingcom/bookingcom-terms-and-conditions/provision/CA-P-076605/automated-access-to-platform-prohibited-without-written-permission/), third-party source).
  - Guidesk would have to hold hosts' passwords and 2FA codes.
- **Verdict:** the risk that customers' accounts are blocked is unacceptable.

## Comparison

| Option | One-time cost | Recurring cost | Time to market | Segment | Complexity | Main risk |
|---|---|---|---|---|---|---|
| A1 Airbnb | Audit + dev (not published) | Not published | Indefinite (closed) | Both | Very high | Invitation-only; discretionary termination |
| A2 Booking.com | Certification + PII | Not published | Indefinite (paused) | Both | High | Paused until further notice |
| A3 Vrbo/Expedia | Full distribution software | Not published | 12+ months | Both | Very high | Messaging-only not accepted |
| B PMS APIs | 2–6 weeks/PMS (est.) | Usually USD 0; some up to USD 10k or 20% | 1–3 months + approvals | Professionals (+ Hospitable/Smoobu individuals) | Medium | Per-PMS approval; heterogeneous APIs |
| C White-label | 2–4 months + certification (est.) | Channex USD 130 + ~USD 1/unit; NextPax min. USD 350; RU quote | 3–6 months | Individuals without a PMS | High | 15.5% fee; PMS conflict; no Vrbo on Channex |
| D1 Guide chat (adopted) | 4–8 weeks (est.) | No per-message fees | 4–8 weeks | Both | Low–medium | Adoption; Airbnb interpretation |
| D2 WhatsApp (rejected) | 4–8 weeks (est.) | ~USD 0.1–0.3/stay + provider | 4–8 weeks | Both | Low–medium | Airbnb contact rules; Meta policy; cost |
| E Unofficial (prohibited) | Low | High maintenance | Fast | Both | Medium | Account blocking; ToS violation |

## Adopted strategy (2026-11-13)

The decision is recorded in [ADR-0003](../architecture/adr/0003-phased-channel-integration-strategy.md).

1. **MVP.**
   - The web guide plus in-guide chat.
   - Ready-to-paste templates for Airbnb, Booking.com and Vrbo scheduled messages, sent after confirmation.
   - Opt-in service sales inside the guide.
2. **Day 1: apply to PMS partner programs.** Apply to Hospitable, Hostaway, Guesty and Smoobu; approval times are unknown.
3. **First PMS integration, as soon as one approves.**
   - The agent replies in the OTA thread through the PMS and reads PMS data for the guide.
   - Research priority: Hospitable (vendor OAuth, no reported fees), then Hostaway (largest among professionals), then Guesty.
   - Evaluate Calry if it covers messaging.
   - Check whether Stays.net's API exposes messages (LATAM).
4. **Months 6–12: individuals without a PMS.** Compare two options:
   - a Hospitable partnership (Host plan USD 29/month, with a limited connection that works alongside other PMSs);
   - a Channex white-label pilot (about USD 1/unit), offered only to hosts who accept the 15.5% fee. Ask Channex in writing about a messaging-only connection.
5. **Quarterly:** check whether Airbnb or Booking.com has reopened onboarding.

**Copilot bridge.** For hosts without an integration, the agent drafts a reply in the Guidesk portal and the host pastes it into the OTA chat. Guidesk never automates the OTA account, and drafts follow [platform-policies.md](platform-policies.md).

**Prohibited throughout:** scraping, browser automation and email-reply relays.

## Implications for Guidesk

- **Integrations are additive.** Every phase must work for a host with no integration.
- **No selling in OTA threads yet.** In OTA threads the agent sticks to stay-related replies until partner terms on commercial messages are clear. Selling happens in the guide UI, with disclosure.
- **One conversation model for every source.** It must cover guide chat, PMS-relayed OTA threads (including Booking.com's messaging window) and copilot drafts.
- **Onboarding differs by PMS.** Hostaway's API-key flow needs dedicated UX; Hospitable and Smoobu use OAuth.
- **Budget for unknown fees.** PMS partner fees could be anywhere from zero to material.

## Calendar export (iCal) contents (added 2026-11-24)

Calendar feeds give stay dates but almost no guest data:

- **Airbnb** (since a December 2019 change): reserved entries carry a "Reservation URL" with the
  reservation code and "Phone Number (Last 4 Digits)" in the description; no guest name, email, or
  full phone. Spec 018 keeps only the reservation code, so the host can find the matching Airbnb
  thread and type the guest's name (OQ-39 checks this against a real feed).
- **Booking.com and Vrbo:** entries mark dates as unavailable with no guest data (to be confirmed
  with real feeds, OQ-39).
- Guest names come from a PMS import, a stay added by hand, or the host typing the name on the stay
  (spec 018).

Sources: [Cloudbeds (myallocator) on the Airbnb iCal change](https://myallocator.cloudbeds.com/hc/en-us/articles/360038298514-Airbnb-iCal-Announcement-and-Next-Steps-December-2019),
[Uplisting on the Airbnb iCal change](https://uplisting.io/blog/how-the-airbnb-icalendar-ical-changes-will-affect-you-and-how-to-avoid-disruption),
[Airbnb community: no guest names on iCal](https://community.withairbnb.com/t5/Help/No-Guest-Names-on-ICal-seriously/m-p/1189415).

## Unverified / open items

- **Airbnb's partner page** was cited only through a secondary source.
- **Messaging in Lodgify, Uplisting and Stays.net** is unconfirmed.
- **Partner pricing** for Hostaway, Guesty and Rentals United is not published.
- **Guesty's Open API plan requirement** is unverified.
- **Hospitable's messages endpoint** comes from a secondary source.
- **Hospitable plan access is contradictory.** This research says the API is paid-only, while the [competitive landscape](competitive-landscape.md) research cites a free plan with direct Airbnb API access. Whether free-plan hosts can be integrated is open.
- **Calry's messaging coverage** and a **Channex messaging-only connection** are unconfirmed.
- **No independent PMS market-share data** exists for the US or LATAM.
- **All effort and per-stay cost figures** are researcher estimates.
- **WhatsApp rates for Colombia, Argentina and Chile** are unverified (moot).
- See [open questions](../open-questions.md).

## Sources

- [bnbcalc — Does Airbnb have an API (2026-10-21)](https://www.bnbcalc.com/help/articles/does-airbnb-have-an-api)
- [Airbnb partner page](https://www.airbnb.com/partner)
- [Airbnb API Terms](https://www.airbnb.com/terms/api)
- [bnbnews — 2025 Preferred partners](https://bnbnews.gr/en/otas/28919/airbnb-new-list-of-preferred-software-partners-for-2025/)
- [Airbnb developer portal](https://developer.withairbnb.com/)
- [Booking.com Connectivity](https://connect.booking.com)
- [Supergood — Booking.com](https://supergood.ai/api-report-card/booking-com)
- [Booking.com Messaging API](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api)
- [Booking.com Going live](https://developers.booking.com/connectivity/docs/going_live)
- [Expedia CPP](https://developers.expediagroup.com/supply/lodging/cpp/overview)
- [Expedia messaging](https://developers.expediagroup.com/supply/lodging/docs/property_mgmt_apis/messaging/getting_started/intro)
- [Hostaway API](https://api.hostaway.com/documentation)
- [Hostaway — Vrbo messaging](https://support.hostaway.com/hc/en-us/articles/9996470461979-Vrbo-How-Messaging-Works)
- [Hostaway Marketplace](https://hostaway.com/marketplace/)
- [Hostaway — Airbnb fee changes](https://support.hostaway.com/hc/en-us/articles/40440128540699-Airbnb-Fee-Structure-Changes-for-Hostaway-Users)
- [Guesty send-message](https://open-api-docs.guesty.com/reference/post_communication-conversations-conversationid-send-message)
- [Guesty Open API quick start](https://open-api-docs.guesty.com/docs/quick-start-guide)
- [Guesty vs Hostaway](https://www.guesty.com/comparisons/guesty-vs-hostaway/)
- [apis.io — Hospitable messages](https://apis.io/apis/hospitable/hospitable-messages-api/)
- [Hospitable — integration partners](https://help.hospitable.com/en/articles/16234154-how-can-i-become-an-integration-partner-with-hospitable-com-and-list-my-integration)
- [Hospitable — pricing](https://help.hospitable.com/en/articles/4596748-hospitable-pricing-subscription-costs)
- [Hospitable — limited connection](https://help.hospitable.com/en/articles/8889941-airbnb-using-other-software-with-airbnb-limited-connection)
- [10minhotel — PMS fees report](https://en.10minhotel.com/2025/07/15/89-of-tech-vendors-say-pms-imposed-fees-are-blocking-innovation-in-the-short-term-rental-sector-hospitable/)
- [Smoobu API](https://docs.smoobu.com/)
- [OwnerRez forum — messaging](https://www.ownerrez.com/forums/requests/readonly-messaging-access-via-personal-access-token-no-oauth-required)
- [Hostfully messages API](https://dev.hostfully.com/v3.0/reference/messages)
- [Beds24 setMessage](https://beds24.com/api/json/setMessage)
- [Hostex API](https://api-doc.hostex.io/)
- [apis.io — Uplisting](https://apis.io/apis/uplisting/uplisting-messages-api/)
- [Stays.net](https://stays.net/?gad=1)
- [PYMNTS — Hostaway funding](https://pymnts.com/news/investment-tracker/2024/hostaway-secures-365-million-to-expand-short-term-rental-platform)
- [Calry pricing](https://calry.app/pricing)
- [Channex pricing](https://channex.io/pricing.md)
- [Channex messages API](https://docs.channex.io/api-v.1-documentation/messages-collection)
- [Channex — connect Airbnb](https://help.channex.io/en/articles/8225359-how-to-connect-with-airbnb)
- [NextPax pricing](https://nextpax.com/nextpax-pricing)
- [Rentals United messaging API](https://docs.rentalsunited.com/external/en-gb/Content/RU-platform/GuestCommunication/Basic-Use-API.htm)
- [Airbnb help 2958 — messaging software](https://www.airbnb.com/help/article/2958)
- [Airbnb scheduled messages](https://www.airbnb.com/support/article/2897)
- [Airbnb — May 2025 release](https://news.airbnb.com/en-au/2025-may-release-now-you-can-airbnb-more-than-an-airbnb/)
- [Meta WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing.md)
- [Courier — WhatsApp pricing](https://www.courier.com/blog/whatsapp-pricing-changes-october-2026)
- [YCloud — WhatsApp pricing](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026.md)
- [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing)
- [360dialog pricing](https://docs.360dialog.com/partner/get-started/pricing-and-billing)
- [Meta — Tech Providers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [TechCrunch — WhatsApp chatbot ban](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)
- [Airbnb community — email replies](https://community.withairbnb.com/t5/Community-cafe/Emails-Responses-not-Forwarded/td-p/1567121)
- [Booking.com partner help — guest aliases](https://partnerhelp.booking.com/hc/en-us/articles/115003970605-Why-does-the-guest-s-email-address-end-with-guest-booking-com-)
- [Airbnb Terms of Service](https://www.airbnb.com/help/article/2908)
- [conductatlas — Booking.com automated access](https://conductatlas.com/platform/bookingcom/bookingcom-terms-and-conditions/provision/CA-P-076605/automated-access-to-platform-prohibited-without-written-permission/)
