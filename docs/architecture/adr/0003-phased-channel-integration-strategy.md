# 0003. Phased channel integration strategy

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder
- **Amended:** 2026-11-14. Read-only PMS property import moves into the MVP for PMSs that accept
  a customer's own token without a partner agreement. Messaging through PMSs stays in Phase 2.
  Approved by the founder.
- **Related:** [Integrations research](../../research/integrations.md) · [Platform policies](../../research/platform-policies.md) · [Roadmap](../../product/roadmap.md) · [Architecture overview](../overview.md)

## Context and problem statement

Guidesk's agent must read and send guest messages in the chats of Airbnb, Booking.com, and
Vrbo. Hosts must also be able to connect their accounts and properties through a simple portal.
Research done on 2026-11-13 ([integrations](../../research/integrations.md)) found:

- **Airbnb:** API access is invitation-only, and Airbnb is not accepting new requests.
- **Booking.com:** onboarding of new connectivity providers is paused "until further notice".
- **Vrbo / Expedia Group:** partners must be full distribution software (rates, availability,
  reservations). A messaging-only product does not qualify.
- **PMS APIs:** Hostaway, Guesty, Hospitable, Smoobu, OwnerRez, Hostfully, and Beds24 expose
  endpoints to send guest messages that reach the OTA thread, mostly behind partner programs.
  This covers professional managers well.
- **White-label connectivity:** Channex costs about $130 per month plus about $1 per unit;
  NextPax has a $350 per month minimum. These can serve hosts without a PMS, but Guidesk would
  effectively become the host's channel manager. Hosts connected through software also move to
  Airbnb's 15.5% host-only fee.
- **Unofficial methods** (scraping, browser automation, email-reply hacks) violate the OTAs'
  terms and risk suspension of hosts' accounts.

On 2026-11-13 the founder also decided that guests talk to Guidesk **only** in the platform
chats or in the chat inside the Guidesk guide. WhatsApp and email/SMS are out of scope for guest
conversations.

## Decision drivers

- Serve both individual hosts and professional managers.
- Time to market for a one-developer team.
- Zero risk to hosts' OTA accounts (constitution, Principle II).
- Low fixed cost before revenue.
- Keep the architecture ready for direct OTA access later.

## Considered options

| Option | Time to market | Segment covered | Main risk |
|---|---|---|---|
| A. Direct OTA partnerships | Indefinite (closed or paused) | Both | Not available |
| B. PMS partner APIs | 1–3 months plus approvals | Pros (and hosts on Hospitable or Smoobu) | Approval timelines; varied APIs |
| C. White-label connectivity | 3–6 months | Hosts without a PMS | 15.5% fee for hosts; conflicts with existing PMS connections; channel-manager responsibilities |
| D. Guide plus in-guide chat; link delivered through OTA scheduled messages | 4–8 weeks | Both | Guests must leave the OTA chat to use it |
| E. Unofficial methods | Fast | Both | Account bans; terms violations |
| D-variant: WhatsApp channel | 4–8 weeks | Both | Rejected by product decision; Airbnb bans requesting guest contact data |

## Decision outcome

Chosen option: **a phased combination of D → B → C**. Options A and E are excluded.

1. **MVP (months 0–4):**
   - Guest guide with in-guide AI chat.
   - The host delivers the guide link through OTA scheduled messages after booking
     confirmation.
   - Stay windows come from the OTA iCal export.
   - A **reply copilot** for any OTA chat: the host pastes the guest's message and gets a
     grounded draft.
   - **Read-only property import** from PMSs that accept a customer's own token without a
     partner agreement (Beds24, Hostex; Hostaway if its terms allow, OQ-26). It creates guide
     drafts automatically, so managers do not build each guide by hand. Hosts without a PMS
     import their listing by pasting text, uploading screenshots, or using a CSV file.
   - **On day 1, apply** to the Hospitable, Hostaway, Guesty, and Smoobu partner programs.
2. **Phase 2 (months 4–7):**
   - The first PMS adapter goes live as soon as a partner approves. Hospitable (OAuth for
     vendors, no vendor fees reported) and Hostaway (largest among pros) come first.
   - The agent then replies inside the OTA thread under host autonomy settings, and listing
     data and reservations stay in continuous sync.
   - Guesty and Smoobu follow. Validate whether Stays.net's API exposes messaging (LATAM).
3. **Phase 3 (months 7–13):**
   - Serve hosts without a PMS inside the OTA chat, either through a Channex white-label pilot
     (only with hosts who accept the fee implications) or through a referral partnership with
     Hospitable (whose "limited connection" offers messaging only).
   - Re-check the Airbnb and Booking.com partner programs every quarter.

All channels implement the common `ChannelPort` and `PropertySourcePort`
([architecture overview](../overview.md#4-components-and-bounded-contexts)). Adding a provider
doesn't change the core.

### Consequences

- **Good:**
  - Shippable in weeks.
  - Serves both segments from day 1.
  - Zero account risk.
  - Low fixed costs.
  - Direct OTA access can be added later as one more adapter.
- **Bad:**
  - In the MVP the agent cannot answer inside the OTA chat. Guests must open the guide, and the
    copilot needs manual copy and paste.
  - The Phase 2 timing depends on third-party approvals.
  - Every PMS API differs, so adapter maintenance cost grows with each one.

### Confirmation

- Partner applications are submitted during Phase 0 and their status is tracked in
  [open questions](../../open-questions.md).
- Contract tests per adapter.
- Policy constraints (PC-xx) are covered by tests.
- Pilot metric: share of guests who open the guide, compared against automated resolution rate.

## Notes

- Guidesk never fetches OTA listing pages automatically, even from a URL the host provides.
  Listing import comes from host-provided content (pasted text, screenshots, CSV) or PMS APIs:
  read-only in the MVP where a customer token is allowed, and fully synced in Phase 2.
- Revisit this ADR if any OTA reopens partner onboarding, if a PMS denies access, or if pilot
  data shows guests rarely open the guide.
