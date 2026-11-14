# 0007. Tilopay as the initial payment provider

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Founder
- **Related:** [PRD F13](../../product/prd.md#f13--guest-checkout-and-payouts-mvp-month-4) · [Security SEC-21](../security.md#4-controls) · [Monetization partners](../../research/monetization-partners.md) · [Open questions](../../open-questions.md)

## Context and problem statement

The MVP includes guest checkout and host payouts for add-ons (F13) in month 4. Stripe does not
onboard Costa Rica companies, so using Stripe means first creating a supported entity, such as a
US company. That put the legal entity (OQ-01) on the MVP's critical path. We need a provider
that can start with Guidesk's Costa Rica setup and the first pilot hosts.

## Decision drivers

- Available to a Costa Rica company now, without creating a foreign entity first.
- Hosted checkout, so card data never touches Guidesk (smallest PCI DSS scope).
- A way to pay hosts their share, ideally without Guidesk holding third-party funds.
- Currencies used by pilot properties (USD and CRC at least).
- Provider swappable later for other markets.

## Considered options

1. **Tilopay** (Costa Rica fintech).
2. **Stripe Connect** through a new US entity.
3. **Regional alternatives** (Mercado Pago, dLocal, Adyen).

## Decision outcome

Chosen option: **Tilopay for the MVP and the first markets, behind `PaymentPort`.** The founder
decided this on 2026-11-14.

What the public documentation shows (verified 2026-11-14):

- **Hosted payment page.** The backend calls `processPayment`, the guest completes payment on a
  Tilopay-hosted page, and the merchant never sees the card number
  ([hosted payment page](https://tilopay.com/en/developers/hosted-payment-page),
  [processPayment](https://tilopay.com/en/developers/api/hosted-payment-page/process-payment)).
- **Payment links** with a `webhook_url` for the payment result
  ([create payment link](https://tilopay.com/en/developers/api/links-de-pago/create-link-payment)).
- **Tokenization** to save a card without charging it
  ([processTokenize](https://tilopay.com/en/developers/api/tokenizacion/process-tokenize)).
- **Split settlement** (`POST /api/v1/orders/liquidation/split`) divides an approved order's
  settlement among several merchants, but only for merchants that use Tilopay as their payment
  facilitator ([split settlement](https://tilopay.com/en/developers/api/procesos-operativos/split)).
- **Server-to-server** integration requires the merchant's own PCI certification
  ([server-to-server](https://tilopay.com/en/developers/server-to-server)). Guidesk will not
  use it.
- **Coverage (press, not official documentation):** founded in Costa Rica in 2019; presence in
  33 markets across Central America and the Caribbean; charges in colones, US dollars, euros, and
  regional currencies; online onboarding for individuals and companies
  ([Delfino, 2025](https://delfino.cr/2025/04/tilopay-se-consolida-como-un-aliado-para-implementar-y-facilitar-los-pagos-digitales-en-centroamerica-y-el-caribe),
  [El Observador](https://observador.cr/empresa-costarricense-ofrece-facilitar-pagos-en-linea-a-pequenos-y-grandes-comercios/)).

### Integration design

- **Checkout:** the hosted payment page or payment links only. No card fields in Guidesk.
- **Host payouts:** split settlement, with each host onboarded as a Tilopay merchant under the
  payment-facilitator model, so Guidesk never holds the host's share. If split settlement is not
  available for Guidesk's setup, payouts need a different design and a legal review before
  launch, because collecting and forwarding third-party funds carries regulatory and tax
  obligations.
- **Order state:** an idempotent state machine driven by Tilopay's redirect response and
  webhook. The redirect alone never confirms an order; it must be verified server-side.
- **Port:** a `TilopayAdapter` implements `PaymentPort`. Other providers join as adapters when
  Guidesk serves markets Tilopay does not cover.

### Consequences

- **Good:**
  - Payments no longer wait for a foreign entity. A Costa Rica company can process them, which
    takes the US entity off the MVP's critical path (OQ-01).
  - Hosted checkout keeps PCI scope minimal.
  - Local payment methods and Costa Rica's banking rails are available if needed.
- **Bad:**
  - Host payouts depend on split settlement and the payment-facilitator model, which are not
    yet confirmed for Guidesk (OQ-37).
  - Coverage for hosts in the United States, Mexico, and South America is unverified. Those
    markets may need a second provider (for example Stripe through a US entity, Mercado Pago,
    or dLocal), which brings back the entity question for them.
  - The webhook signature scheme for card payments is not documented in the pages reviewed.
    The scheme documented for Tilopay's banking API (AES-GCM) may differ.
  - Fees are not published; they come from the commercial agreement (OQ-09, OQ-37).

### Confirmation

Before F13 ships, in a Tilopay sandbox:

1. Hosted checkout works end to end, and orders are confirmed only after server-side
   verification.
2. Split settlement pays a test host merchant correctly.
3. International cards (US and Latin American) are accepted.
4. Refunds, full and partial, work from the API.
5. The webhook signature or encryption scheme is verified and tested.

Revisit this ADR when Guidesk onboards hosts outside Tilopay's coverage, or if split settlement
is not available.

## Pros and cons of the options

| Option | Pros | Cons |
|---|---|---|
| Tilopay | Works with a Costa Rica company now; hosted checkout; split settlement; local methods | Payout model and coverage outside Central America unconfirmed; fees not public |
| Stripe Connect (US entity) | Mature marketplace payouts; broad coverage; strong docs | Needs a US entity first (weeks of setup, tax and banking overhead); on the critical path |
| Mercado Pago, dLocal, Adyen | Strong in Latin America | Different onboarding per country; Adyen targets larger volumes; not needed for the first pilots |
