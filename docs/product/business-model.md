# Business Model

> **Status:** Draft v0.2 (hypotheses to validate with design partners) · **Owner:** Founder ·
> **Last updated:** 2026-11-24 ·
> **Related:** [Vision](vision.md) · [PRD](prd.md) · [Monetization partners](../research/monetization-partners.md) · [Competitive landscape](../research/competitive-landscape.md) · [Open questions](../open-questions.md)

Guidesk makes money in two ways:

1. **Freemium subscriptions.** The guide is free and acquires hosts. Paid plans unlock
   integrations, more autonomy, and scale.
2. **Commissions on services sold to guests.** These include host add-ons, tours and
   experiences, reservations, and later insurance.

Every number on this page is a hypothesis unless it cites research.

## 1. Lean Canvas

| Block | Content |
|---|---|
| **Problem** | 1) Repetitive guest questions at all hours, in several languages. 2) Property knowledge scattered and unread. 3) Ancillary revenue left on the table. |
| **Customer segments** | Individual hosts (1–5 listings) and professional managers (10+), in LATAM and the US. Early adopters: hosts with international guests in tourist destinations, and managers on Hospitable or Hostaway. |
| **Unique value proposition** | A property guide plus an AI concierge that answers guests where they already talk and turns those conversations into revenue. Works with or without a PMS, in Spanish and English, free to start. |
| **Solution** | Guide builder with AI-assisted onboarding; guest guide with chat; AI agent in the platform chats through PMS integrations; host copilot and inbox; stay calendar with the extras each stay bought; services marketplace. |
| **Channels** | Free guide (product-led growth); SEO content in Spanish and English; host communities; referrals; PMS marketplaces (Hostaway, Guesty, Hospitable) as distribution; direct sales to managers. |
| **Revenue streams** | Pro and Business subscriptions (per property per month); platform fee on host add-ons; affiliate commissions on tours and reservations; revenue share on insurance (later). |
| **Cost structure** | LLM inference; cloud hosting; payment processing; PMS or connectivity fees where charged; support; legal and compliance; the founder's time. |
| **Key metrics** | Activation (guide published and link delivered); automated resolution rate; escalation rate; attach rate; services GMV and take rate; free-to-paid conversion; AI cost per stay; churn. |
| **Unfair advantage** | (To be earned.) Bilingual, compliance-first product for underserved LATAM hosts; a curated local services network; agent-quality evals built on real conversations. |

## 2. Plans (hypothesis)

| | **Free** | **Pro** | **Business** |
|---|---|---|---|
| Target | Individual hosts trying Guidesk | Individual hosts and small managers | Managers with 10+ listings and teams |
| Price (hypothesis) | $0 | ~$9–12 per property per month | Volume pricing per property; annual contracts |
| Properties | Up to 2 | Unlimited | Unlimited |
| Guide and in-guide chat | Yes (Guidesk branding) | Yes (custom branding) | Yes (white-label option) |
| AI replies per month ([§2.1](#21-ai-replies-allowances-top-ups-and-pause)) | 500 during the pilot; after the pilot the direction is no AI replies on Free | 300 per active property, pooled, at least 500; top-ups | 300 per active property, pooled, at least 1,000; top-ups |
| Copilot drafts for OTA chats | Yes | Yes | Yes |
| PMS integration (agent replies in the platform chat) | No | Yes | Yes, with multiple PMS accounts |
| Autonomy levels | Draft and auto | Draft, auto, and full auto | Same as Pro, with approval workflows |
| Host add-ons marketplace | Yes (higher platform fee) | Yes (lower platform fee) | Yes (negotiated fee) |
| Team seats and roles | 1 | Up to 3 | Unlimited, with role-based access |
| Analytics | Basic | Full | Full, plus export and API |

**Benchmarks** (from [competitive landscape](../research/competitive-landscape.md)):

- Touch Stay: from ~$8.25 per property per month.
- HostBuddy AI: ~$7–12 per property per month (third-party figures).
- Enso Connect: $16–28 per unit per month, with a 5-unit minimum.

Pro pricing sits at the low end on purpose, to win individual hosts.

### 2.1 AI replies: allowances, top-ups, and pause

Founder decisions on 2026-11-24 ([spec 019](../../specs/019-ai-reply-allowances/spec.md)):

- **Allowances.** Pro gets 300 AI replies per active property a month, pooled, and **at least 500**.
  Business gets the same per property and **at least 1,000**. During the pilot, Free gets **500** a
  month per workspace.
- **Pace.** A guest device may send at most **25 messages every 10 minutes**. The daily budgets per
  property and per workspace stay as abuse protection.
- **When the month runs out.** The workspace uses a **top-up** (a pack of AI replies) if it has one.
  Otherwise the AI pauses until the 1st. The service itself is never suspended: the guide, the chat
  to the host, add-ons, and Explore keep working, and the host answers by hand.
- **What is sold: replies, not tokens.** Hosts count replies, and a reply is what they can predict.
  Guidesk prices a reply from the measured cost per reply (tokens times model price), which is
  recorded for every model call.
- **Top-ups during the pilot** are free and granted by the founder. After the pilot they are sold
  in the portal (with an optional automatic top-up) once host billing exists (OQ-13).
- **After the pilot**, the direction is AI replies only on Pro and Business. Free keeps the guide,
  the chat to the host, add-ons, and Explore. The founder revisits the numbers with pilot data.

**What the allowances cost Guidesk** (at the §4 estimate of USD 0.03–0.11 per reply):

| Case | Replies | AI cost |
|---|---|---|
| Typical property: 4 stays × 15 replies | 60 | ~$1.80–6.60 |
| Pro minimum fully used (1 property) | 500 | ~$15–55 |
| Business minimum fully used | 1,000 | ~$30–110 |
| Pilot Free workspace fully used | 500 | ~$15–55 |
| Pilot, 20 workspaces at typical use (2 properties each) | 2,400 | ~$72–264 |

**Reading:** the minimums are generous on purpose. At typical use a property needs about 60 replies
a month, so 500 covers about 33 stays and few small hosts will reach it. The exposure is a
single-property Pro host who uses the whole minimum: at the high end of the cost estimate, that
costs more than the Pro price hypothesis ($9–12). The pace limit and daily budgets stop bots, and
top-ups move heavy real use to a paid product. The pilot must measure replies per stay and cost per
reply before prices are set.

**Top-up price (hypothesis, OQ-12):** at least 2.5 times the measured average cost per reply,
rounded to simple packs, for example 250 replies for about USD 20 and 1,000 replies for about USD 70.
Cost levers before raising prices: prompt caching, effort tuning, and cheaper models on routine
questions after evals (OQ-23).

## 3. Commission model (hypothesis)

| Stream | Mechanism | Take rate (hypothesis) | Benchmark | Phase |
|---|---|---|---|---|
| Tours and experiences | Affiliate links (Viator, Civitatis, GetYourGuide); later in-app booking | Affiliate commission, ~8–10% of the order | Viator 8%, Civitatis 8–10%, GetYourGuide ~8% | MVP |
| Host add-ons (early check-in, late checkout, transfers, cleaning, rentals) | Guest pays through Guidesk checkout; host receives a payout minus the platform fee | 5–10% (higher on Free) | Hospitable 7–10% on upsells; Touch Stay 5% on its free plan | MVP, month 4 (needs the legal entity and payments) |
| Tours from a local partner (Localbird, Costa Rica) | Partner integration: Guidesk sends guests to Localbird's tours, and Localbird reports bookings with a Guidesk reference so they appear on the stay ([spec 018](../../specs/018-stay-calendar/spec.md) "Services" area) | Revenue share to negotiate | Localbird pays hosts affiliate commissions through its own guestbook pages (third-party description) | Candidate, after a partnership (OQ-38) |
| Reservations (car rental, transfers, restaurants) | Affiliate or partner programs | Partner-defined | Booking.com affiliate: ~4–6% (third-party) | Phase 2 |
| Insurance (travel, damage, cancellation) | Licensed embedded partner; Guidesk is the distribution channel | Partner revenue share | Not public | Phase 3 |

**Decisions pending** (see [open questions](../open-questions.md)):

- Whether hosts get a share of affiliate commissions, as an incentive to enable the marketplace.
- Who absorbs payment processing fees: the guest (service fee), the host, or Guidesk.

**Localbird note.** Localbird sells tours in Costa Rica and offers hosts a guestbook with tours,
integrated with PMSs such as Guesty and Hostaway. It is a possible supplier for Explore and, through
its guestbook, a partial competitor. A partnership only makes sense if Localbird reports bookings per
stay and the guest stays in the Guidesk guide (OQ-38).

## 4. Unit economics (illustrative)

This scenario covers one active property in one month. It exists to expose the key
sensitivities, not to forecast.

| Assumption | Value | Basis |
|---|---|---|
| Stays per month | 4 | Assumption |
| Agent replies per stay | 15 | Assumption, to be measured in the pilot |
| AI cost per reply | $0.03–0.11 | Estimate for `claude-opus-5-5` at low effort. ~20k-token cached property context, ~3k new input tokens, ~800 output tokens. List prices $4 / $20 per MTok input/output, $0.20 per MTok cache reads. Low end = cache hit, high end = no cache hit. See [ADR-0005](../architecture/adr/0005-llm-provider-and-agent-design.md). |
| Tour attach rate × average order × commission | 10% × $120 × 8% | Assumption; commission from research |
| Add-on attach rate × average order × platform fee | 25% × $35 × 8% | Assumption |

| Result per property per month | Amount |
|---|---|
| AI inference cost | ~$1.80–6.60 (midpoint ~$3.60) |
| Tour commissions | ~$3.84 |
| Add-on platform fees (from MVP month 4) | ~$2.80 |
| **Commission revenue (no subscription)** | **~$6.64** |
| Pro subscription | ~$9–12 |

**What this shows:**

1. **Inference cost is the biggest variable cost.** The Free plan must cap AI replies. Prompt
   caching and effort tuning are the first levers to pull. At scale, the hybrid knowledge
   strategy (core facts in context, long-tail knowledge retrieved) cuts the knowledge input cost
   by about half; ADR-0005 defines when to switch. Whether cheaper models can handle routine
   questions is an eval-driven decision for the founder (see
   [ADR-0005](../architecture/adr/0005-llm-provider-and-agent-design.md)).
2. **Commissions alone barely cover a free property's AI cost.** The model needs either
   free-to-paid conversion or higher attach rates. Host add-ons are the highest-margin lever
   because the host sets the price.
3. **Measure everything in the pilot.** The first pilot must measure replies per stay, cache hit
   rate, and attach rates. These numbers replace the assumptions above.

## 5. Go-to-market

| Stage | Individual hosts | Professional managers |
|---|---|---|
| Pilot (MVP) | 10–20 design partners recruited personally and in host communities | 3–5 design-partner managers on Hospitable or Hostaway |
| Launch | Free guide and templates; Spanish and English SEO ("guía para huéspedes Airbnb", "Airbnb house manual template"); referral credits | Listings in PMS marketplaces once approved; case studies with ROI (hours saved, revenue per stay) |
| Scale | Content and community; partnerships with host associations and co-hosting networks | Sales-assisted onboarding; Business plan; API |

## 6. Key business risks

| Risk | Impact | Mitigation |
|---|---|---|
| PMS partner approvals are slow or denied | No in-platform chat for pros | Apply on day 1 to four PMS programs in parallel; the copilot bridge; white-label option in Phase 3 |
| Airbnb policy changes, or Airbnb competing directly (Services and Experiences) | Upsell restrictions; less demand for tours | Compliance by design; focus on host add-ons and local providers Airbnb doesn't cover; diversify toward Booking.com and Vrbo |
| AI errors damage host reviews | Churn, reputation | Draft-by-default autonomy, eval gate, mandatory escalation categories |
| Inference cost exceeds revenue on Free | Cash burn | Reply caps, caching, effort tuning, the hybrid knowledge strategy at scale, eval-driven model decisions |
| A single-property Pro host uses the whole 500-reply minimum | AI cost above the Pro price | Pace limit and daily budgets; top-ups for heavy use; measure replies per stay in the pilot before setting prices (§2.1) |
| Payments and legal entity (Tilopay for the MVP; Stripe is not available to Costa Rica companies) | No checkout, so no add-on commissions | Tilopay account with split settlement by week 10 of the MVP (ADR-0007, OQ-37); a second provider for markets Tilopay does not cover. Until checkout is live, affiliate tours and host-collected add-ons keep monetization going |
| Insurance licensing | Regulatory exposure | Only through licensed embedded partners, after legal review |
