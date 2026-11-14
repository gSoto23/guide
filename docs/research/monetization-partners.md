# Monetization Partners

> **Status:** Research — verified as of 2026-11-13 · **Owner:** Founder · **Related:** [Business model](../product/business-model.md) · [Platform policies](platform-policies.md) · [Competitive landscape](competitive-landscape.md) · [Roadmap](../product/roadmap.md) · [Open questions](../open-questions.md)

This page covers the partners Guidesk could use to monetize services sold by the agent: tours and experiences, embedded insurance and damage protection, and payments. Partners for restaurants, transfers and car rental were not researched in depth.

## Executive summary

- **Affiliate links are the fastest MVP path for tours.**
  - Viator pays 8% on bookings made within 30 days of the click.
  - Civitatis pays up to 10% (8–10% by volume on its Mexico page).
  - Both work as redirects, so Guidesk handles no payments.
- **Booking inside the app requires qualification.** The options are Viator Full+Booking or Merchant, and GetYourGuide's BOOKING tier, which needs a commercial agreement.
- **Coverage differs by region.** Civitatis has the broadest Spanish-language catalog in LATAM (a qualitative assessment). Viator is strong in the US and in LATAM tourist hubs.
- **Insurance needs a licensed partner and legal review.**
  - In the US, earning a commission per policy generally requires a producer license.
  - LATAM regulators distinguish referring a customer from selling insurance.
  - Embedded providers such as Cover Genius and Vertical Insure take on licensing.
- **Damage waivers fit Airbnb poorly.** AirCover already protects hosts, and most hosts cannot require a deposit.
- **Payments depend on Guidesk's legal entity.**
  - Stripe accounts exist in LATAM only for Mexico and Brazil; Costa Rica is not supported.
  - The usual path is a US entity using Stripe Connect and Global Payouts, combined with Mercado Pago or dLocal for local methods.
  - Which entity Guidesk uses is an open question.

## Tours and experiences

| Partner | Commission | API access | LATAM / US coverage | In-app vs redirect |
|---|---|---|---|---|
| **Viator** | **8%** on bookings within 30 days of the click ([official](https://partnerresources.viator.com/)) | **Basic:** automatic. **Full and Full+Booking:** "basic qualification". **Merchant:** qualification plus infrastructure ([affiliates](https://partnerresources.viator.com/travel-commerce/affiliate/)) | 300,000+ products in 2,500 destinations; strong in the US and LATAM tourist hubs | **Affiliate:** redirect. **Full+Booking:** API booking via Viator's payment gateway. **Merchant:** in-app, with Guidesk as merchant of record, able to add margin ([API](https://partnerresources.viator.com/travel-commerce/)) |
| **GetYourGuide** | ~8% (third-party source; others say 5–7%) | LIMITED_READ, READ and BOOKING tiers. BOOKING needs a commercial agreement (third-party source) ([spec](https://github.com/getyourguide/partner-api-spec)) | Strong in Europe, good in the US; weaker in LATAM (unverified) | **Affiliate:** redirect. **BOOKING tier:** in-app booking with payment processing |
| **Civitatis** | **Up to 10%** (Spain page); **8–10% by volume** (Mexico page); plus EUR 1 per free-tour attendee ([MX](https://www.civitatis.com/mx/afiliados/)) | Feed and API on request; widgets; co-branded page ([official](https://www.civitatis.com/es/afiliados/otras-empresas-del-sector-turistico)) | Broadest Spanish-language catalog in LATAM (qualitative); US limited (unverified) | Probably redirect (unconfirmed) |
| **Klook** | 2–5% typical; some sources say 2–20% (third-party source, contradictory) | Via affiliate networks; API unverified | Asia-focused; weak in LATAM (unverified) | Redirect |
| **Tiqets** | 3–7% (third-party source, contradictory) | Awin and Travelpayouts | Museums and attractions in Europe and US cities | Redirect |
| **Booking.com affiliates** | 4% attractions, 6% cars, 4% taxis via CJ since June 2025 (third-party source, contradictory) ([guide](https://www.makeinfluence.com/en/academy/booking-coms-affiliate-program-how-travel-creators-earn-commission)) | CJ network | Global | Redirect; session cookie |

**Bottom line.** For booking inside the app, the realistic options are Viator Full+Booking or Merchant, or GetYourGuide's BOOKING tier. All of them require qualification. For the MVP, Viator and Civitatis affiliate links are the fastest route.

## Embedded insurance and damage protection

| Provider | Product | Model for an unlicensed startup | Licensing / coverage |
|---|---|---|---|
| **Cover Genius (XCover)** | Travel, cancellation and booking protection via API | **Provider handles:** licensing, claims and payouts ([site](https://covergenius.com/embedded-insurance-for-seamless-protection/)). **Commission:** not public. **Fit:** large enterprises; XCover Go serves the mid-market | **Licences:** 60+ countries and 50 US states. **LATAM:** with Volaris it covers MX, US, CR, SV, GT, HN, CO and PE ([case](https://covergenius.com/?p=29989)). **Partners:** HomeToGo |
| **battleface** | API platform for insurers, brokers and MGAs | Sandbox and premium trust account; designed for licensed partners | With HBX, LATAM comes "later" ([Coverager](https://coverager.com/hbx-group-partners-with-battleface/)) |
| **Vertical Insure** | Embedded insurance API for travel and STR SaaS | Commission per policy; provider handles compliance; implementation in under 60 days ([site](https://verticalinsure.com/verticals/travel)) | US |
| **Generali Global Assistance** | Travel insurance and damage protection for managers; powers Vrbo's Accidental Damage Protection (USD 59/89/119) | Commission program; rate not public ([site](https://generalitravelinsurance.com/sales.html)) | US |
| **SafetyWing** | Medical insurance for nomads | Ambassador link, **10% recurring** (up to 1 year per third-party source) ([help](https://intercom.help/safetywing/en/articles/9796053-the-ambassador-program)) | Global, including LATAM |
| **Faye** | US travel insurance | Affiliate via Impact, USD 32–48 per sale (third-party source) | Probably US residents only (unverified) |
| **Europ Assistance / Assist Card** | Travel assistance | Europ Assistance pays 20% on Awin, but for the Spanish market. Assist Card had a Brazil affiliate program (2021), rate not published | LATAM via local entities |
| **Truvi (formerly Superhog)** | Guest screening and damage waiver (not insurance) | **Guest-paid waiver:** Truvi keeps a "small %". **Host-paid option:** ~USD 10–28 per booking (third-party source) ([Superhog](https://knowyourguest.superhog.com/damage-waiver/)) | US, UK, EU |
| **Safely** | Per-booking STR insurance | Host-oriented; partner program unverified | US |
| **ProtectMyStay** | — | **No verifiable information found** | — |

### Licensing notes

- **United States: commission generally needs a producer license.**
  - Earning commission per policy generally requires a producer license.
  - NAIC Model Law #632 lets a "travel retailer" offer insurance under a limited-lines producer that registers and supervises it ([NAIC](https://content.naic.org/sites/default/files/model-law-632.pdf)).
  - Each state adopts the model law on its own terms, and compensation rules vary by state (unverified).
- **LATAM: legal review needed.** Each regulator (CNSF in Mexico, SUSEP in Brazil, SUGESE in Costa Rica) distinguishes referring a customer from selling insurance. Legal review is required (unverified).
- **Damage waivers on Airbnb add little.**
  - AirCover already protects hosts, and most hosts cannot require a deposit.
  - According to Enso, optional waivers remain permitted after booking.
  - The product performs better on direct bookings, Vrbo or Booking.com.

## Payments

> **Decision 2026-11-14:** Tilopay is the initial payment provider; it works with a Costa Rica
> company. See [ADR-0007](../architecture/adr/0007-tilopay-initial-payment-provider.md). The
> research below remains the reference for later markets.

| Provider | Availability | Marketplace / payouts | Fees (general) |
|---|---|---|---|
| **Stripe Connect** | In LATAM, only **Mexico and Brazil** have Stripe accounts. **Costa Rica, Colombia, Chile, Peru and Argentina do not** ([global](https://stripe.com/global)) | **Cross-border payouts:** only among US, UK, EEA, Canada and Switzerland ([docs](https://docs.stripe.com/connect/cross-border-payouts)). **Global Payouts** (US or UK sender): reaches **CR (CRC), MX, PE, DO, EC, GT, PA, SV**; BR, CO and AR in preview; **Chile and Uruguay not listed** ([list](https://docs.stripe.com/global-payouts/recipient-countries)) | **Platform sets prices:** USD 2 per active account/month + 0.25% + USD 0.25 per payout; cross-border from 0.25% ([pricing](https://stripe.com/connect/pricing)). **US card:** ~2.9% + USD 0.30 (unverified this session) |
| **Mercado Pago** | AR, BR, CL, CO, MX, PE, UY (general knowledge, unverified); **not Costa Rica** | Split via per-seller OAuth and `marketplace_fee`. In CO and BR, the 1:1 split only works with balances between MP accounts ([docs](https://www.mercadopago.com.mx/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)) | **Mexico:** 3.49% instant, 2.95% at 30 days, plus a fixed fee and VAT (third-party source) ([official](https://www.mercadopago.com.mx/herramientas-para-vender/link-de-pago)). **Entity:** requires a local entity per country |
| **dLocal for Platforms** | 60+ emerging markets, including LATAM | Pay-ins, payouts, splits and seller onboarding in one API ([site](https://dlocal.com/our-solution/dlocal-for-platforms/)) | Custom pricing; minimums not public |
| **Adyen for Platforms** | Global, including MX and BR | Yes | Interchange++ + EUR 0.11 + method fee; possible minimum billing (third-party source). Better suited to a later stage |
| **PayPal Commerce Platform** | 200+ markets | Yes, with approval | ~2.9% + USD 0.30 plus split fees (third-party source); complex structure |

### Can a Costa Rican company use Stripe?

**Not directly,** because Costa Rica is not a supported country.

- **The usual path** is a US entity, for example a Delaware C-corp through Stripe Atlas. From that entity, Guidesk could:
  - charge guests from any country;
  - pay hosts and providers through Connect (US) or Global Payouts (CR, MX and others).
- **Merchant-of-record exposure.** Under Global Payouts the platform is the merchant of record, which has tax and regulatory implications that need review.
- **A plausible architecture:** Stripe (US) plus Mercado Pago or dLocal for local payment methods.

## Implications for Guidesk

- **Tours: affiliate links first.**
  - The MVP monetizes tours through Viator and Civitatis affiliate links: no payment handling, no merchant-of-record exposure, and fast setup.
  - In-app booking (Viator Full+Booking/Merchant, GetYourGuide BOOKING) is a later milestone that depends on qualification.
- **Disclosure applies to every sale.** Every recommendation that earns a commission must be disclosed to the guest (see [platform-policies.md](platform-policies.md), PC-07). Affiliate redirects are no exception.
- **Owner add-ons.**
  - Airbnb's off-platform policy allows optional fees to be paid outside Airbnb if the guest agrees ([help 2799](https://www.airbnb.com/help/article/2799)). Mandatory fees must stay on Airbnb.
  - Add-ons must therefore be optional, and collecting them depends on the payments setup below.
- **Insurance comes after the MVP.**
  - It requires a licensed embedded partner (Cover Genius, Vertical Insure, Generali) and legal review by market, starting with the US NAIC model-law position and the CNSF, SUSEP and SUGESE rules.
  - Among the embedded API providers researched, only Cover Genius documents LATAM coverage (MX, CR, CO, PE and others, through its Volaris deal).
- **Payments depend on the legal entity.** Building marketplace payments should wait until the entity question is resolved (see [open questions](../open-questions.md)).
- **Local payments as a differentiator.** Pix, OXXO, PSE and SINPE Móvil (see [competitive-landscape.md](competitive-landscape.md)) argue for adding Mercado Pago or dLocal alongside Stripe.

## Unverified / open items

- **Commission rates are contradictory or third-party only** for GetYourGuide, Klook, Tiqets and Booking.com affiliates.
- **Civitatis:** in-app booking capability and US coverage are unconfirmed.
- **GetYourGuide:** LATAM coverage is unverified.
- **Insurance unknowns:**
  - ProtectMyStay could not be verified;
  - insurance commission rates in LATAM are unknown;
  - US state-by-state compensation rules are unverified;
  - Faye's residency restriction is unverified;
  - Safely's partner program is unverified.
- **Mercado Pago's country availability** is general knowledge, not verified.
- **Stripe's standard US card fee** was not verified in this session. Adyen's minimum billing comes from a third-party source.
- **Insurance licensing and merchant-of-record status** both require legal advice before launch.
- **Restaurant, transfer and car-rental partners** were not researched in depth.

## Sources

- [Viator Partner Resources](https://partnerresources.viator.com/)
- [Viator affiliate program](https://partnerresources.viator.com/travel-commerce/affiliate/)
- [Viator travel commerce API](https://partnerresources.viator.com/travel-commerce/)
- [GetYourGuide partner API spec](https://github.com/getyourguide/partner-api-spec)
- [Civitatis affiliates (Mexico)](https://www.civitatis.com/mx/afiliados/)
- [Civitatis — other tourism businesses](https://www.civitatis.com/es/afiliados/otras-empresas-del-sector-turistico)
- [Make Influence — Booking.com affiliate program](https://www.makeinfluence.com/en/academy/booking-coms-affiliate-program-how-travel-creators-earn-commission)
- [Cover Genius — embedded insurance](https://covergenius.com/embedded-insurance-for-seamless-protection/)
- [Cover Genius — Volaris case](https://covergenius.com/?p=29989)
- [Coverager — HBX and battleface](https://coverager.com/hbx-group-partners-with-battleface/)
- [Vertical Insure — travel](https://verticalinsure.com/verticals/travel)
- [Generali Global Assistance — sales](https://generalitravelinsurance.com/sales.html)
- [SafetyWing ambassador program](https://intercom.help/safetywing/en/articles/9796053-the-ambassador-program)
- [Superhog — damage waiver](https://knowyourguest.superhog.com/damage-waiver/)
- [NAIC Model Law #632](https://content.naic.org/sites/default/files/model-law-632.pdf)
- [Stripe global availability](https://stripe.com/global)
- [Stripe Connect cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts)
- [Stripe Global Payouts recipient countries](https://docs.stripe.com/global-payouts/recipient-countries)
- [Stripe Connect pricing](https://stripe.com/connect/pricing)
- [Mercado Pago marketplace split](https://www.mercadopago.com.mx/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)
- [Mercado Pago Mexico — payment link pricing](https://www.mercadopago.com.mx/herramientas-para-vender/link-de-pago)
- [dLocal for Platforms](https://dlocal.com/our-solution/dlocal-for-platforms/)
- [Airbnb help 2799 — off-platform and fee transparency](https://www.airbnb.com/help/article/2799)
