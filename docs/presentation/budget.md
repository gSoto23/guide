# Budget: Development and Operating Costs

> **Status:** Draft v0.1 · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [Project overview](project-overview.md) · [Business model](../product/business-model.md) · [Roadmap](../product/roadmap.md) · [ADR-0005 AI cost model](../architecture/adr/0005-llm-provider-and-agent-design.md) · [ADR-0009 AWS hosting](../architecture/adr/0009-mvp-hosting-and-transactional-email.md) · [Open questions](../open-questions.md)

This page estimates what Guidesk costs to build and to run, in US dollars. It feeds the open
budget question (OQ-02). It is a planning tool, not a forecast.

**How to read the labels:**

- **Verified 2026-11 (source)** means a public price checked in November 2026, with a link.
  "Third-party" means the source is not the vendor itself.
- **Estimate** means our own assumption or a calculation built on verified unit prices and
  assumed usage. Every scenario total is an estimate.
- **TBD** means the figure is not public or not decided yet.

Ranges are used on purpose. The low end assumes light usage and the cheapest sensible setting;
the high end assumes heavier usage and safer settings.

## 1. Summary

| | **Pilot** | **Launch** | **Year-1 design target** |
|---|---|---|---|
| Properties | ~30 | ~500 | 5,000 (NFR-09) |
| Agent replies per month (60 per property) | 1,800 | 30,000 | 300,000 |
| **Monthly operating cost** (estimate) | **$370–1,100** | **$1,500–6,200** | **$11,500–48,700** |
| of which AWS hosting | $150–260 | $230–550 | $620–1,310 |
| of which AI inference | $110–600 | $1,160–5,400 | $10,700–47,100 |
| of which other services and tools | $100–240 | $130–270 | $180–360 |
| Cost per property per month | $12–37 | $3.0–12.4 | $2.3–9.7 |
| Illustrative revenue per month ([§6](#6-revenue-illustrative)) | ~$200 (pilot is free) | $4,200–5,700 | $42,200–57,200 |

- **One-time and pre-launch costs:** about **$9,700–41,100**, plus optional items
  ([§4](#4-one-time-and-pre-launch-costs)).
- **Development, 4-month MVP:** about **$1,200–5,900** in tools, AI, and cloud, **plus the
  founder's own compensation**, which is left as an input ([§5](#5-development-phase-1-4-months)).
- **Payment fees** on add-ons are **TBD**, because Tilopay's fees are not public (OQ-37).
- **AI is the main cost driver at every scale beyond the pilot.** Hosting is mostly fixed cost
  in the pilot and becomes a small share later.

## 2. Scenarios and assumptions

| Assumption | Value | Label |
|---|---|---|
| Stays per property per month | 4 | Estimate ([business model §4](../product/business-model.md#4-unit-economics-illustrative)) |
| Agent replies per stay | 15, so 60 per property per month | Estimate (business model, A-03) |
| AI cost per reply | $0.03 (cache hit) to $0.11 (no cache) | Estimate from [ADR-0005](../architecture/adr/0005-llm-provider-and-agent-design.md) and the business model |
| Claude Opus 5.5 list prices | $4 per million input tokens, $20 per million output, $0.20 per million cache reads; cache writes 1.25× (5-minute) or 2× (1-hour) input; Batch API 50% off | Verified 2026-11 ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)) |
| Guide views per stay | ~15, about 10 requests each | Estimate |
| Host emails per property per month | 15–30 (alerts, codes, digests) | Estimate |
| Hosting | AWS, `us-east-1`, per [ADR-0009](../architecture/adr/0009-mvp-hosting-and-transactional-email.md) (accepted 2026-11-14) | Decided 2026-11-14 (cloud and services) |
| Month length | 730 hours | Convention |

**About the scenarios:**

- **Pilot:** 10–20 individual hosts and 3–5 managers (roadmap Phase 1 exit criteria), about 30
  properties. The pilot is free for hosts.
- **Launch:** the first months after the public launch, about 500 properties.
- **Year-1 design target:** the capacity target in NFR-09 (5,000 properties). It is a design
  target, not a sales forecast.

## 3. Monthly operating costs

### 3.1 AWS hosting

The design follows ADR-0009 (accepted 2026-11-14): CloudFront with AWS WAF in front of the Next.js apps
(OpenNext on Lambda and S3, deployed with SST), an Application Load Balancer and two ECS Fargate
services (API and worker), RDS for PostgreSQL 16, SES, KMS, Secrets Manager, CloudWatch, and one
VPC with a NAT gateway.

**Sizing assumptions (estimate):**

| | Pilot | Launch | Year-1 target |
|---|---|---|---|
| API tasks (Fargate, Arm) | 1–2 × 0.5 vCPU, 1 GB | 2 × 0.5–1 vCPU, 1–2 GB | 2–4 × 1 vCPU, 2 GB |
| Worker tasks | 1 × 0.25 vCPU, 0.5 GB | 1–2 × 0.5 vCPU, 1 GB | 2–3 × 1 vCPU, 2 GB |
| Database (RDS PostgreSQL) | db.t4g.micro–small, Single-AZ, 20 GB | db.t4g.small–medium, Multi-AZ, 50 GB | db.t4g.large–db.m7g.large, Multi-AZ, 200 GB |
| NAT gateways | 1 | 1–2 | 1–2 |
| Staging account | Minimal, can be stopped when idle | Same | Slightly larger |

**Monthly cost (scenario amounts are estimates built on the verified unit prices):**

| Item | Unit prices (us-east-1) | Pilot | Launch | Year-1 |
|---|---|---|---|---|
| CloudFront (pay as you go) | $0.085/GB out and $0.01 per 10,000 HTTPS requests after an always-free 1 TB and 10M requests per month. Verified 2026-11 ([AWS](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)) | $0 | $0–5 | $0–20 |
| AWS WAF | $5 per web ACL, $1 per rule or managed rule group, $0.60 per 1M requests; Bot Control $10 per month extra. Verified 2026-11 ([AWS](https://aws.amazon.com/waf/pricing/)) | $11–15 | $12–20 | $16–32 |
| Lambda (Next.js server rendering, image optimization) | $0.20 per 1M requests, $0.0000133 per GB-second (Arm); always-free 1M requests and 400,000 GB-seconds. Verified 2026-11 ([AWS](https://aws.amazon.com/lambda/pricing/)) | $0–2 | $0–10 | $10–40 |
| S3 (static assets, page cache; uploads later) | $0.023/GB-month, $0.005 per 1,000 writes, $0.0004 per 1,000 reads; S3 to CloudFront free. Verified 2026-11 ([AWS](https://aws.amazon.com/s3/pricing/)) | $0–1 | $1–5 | $25–35 |
| Application Load Balancer | $0.0225/hour ($16.43/month) plus $0.008 per LCU-hour; 2 public IPv4 addresses at $0.005/hour each ($7.30/month). Verified 2026-11 ([ELB](https://aws.amazon.com/elasticloadbalancing/pricing/), [VPC](https://aws.amazon.com/vpc/pricing/)) | $24–27 | $27–30 | $35–53 |
| ECS Fargate (Arm) | $0.03238 per vCPU-hour, $0.00356 per GB-hour; a 0.5 vCPU / 1 GB task is $14.42/month. Verified 2026-11 ([AWS](https://aws.amazon.com/fargate/pricing/)) | $22–36 | $43–72 | $115–202 |
| RDS for PostgreSQL | Single-AZ per hour: t4g.micro $0.016, t4g.small $0.032, t4g.medium $0.065, t4g.large $0.129, m7g.large $0.168; Multi-AZ doubles the instance price. gp3 storage $0.115/GB-month (Multi-AZ possibly $0.23). Backups free up to the provisioned storage. Verified 2026-11 (third-party mirror: [Vantage](https://instances.vantage.sh/aws/rds/db.t4g.micro?region=us-east-1); backups: [AWS FAQ](https://aws.amazon.com/rds/faqs/)) | $14–26 | $52–106 | $211–311 |
| NAT gateway | $0.045/hour ($32.85/month) plus $0.045 per GB processed, plus its public IPv4 ($3.65/month). Verified 2026-11 ([AWS](https://aws.amazon.com/vpc/pricing/); us-east-1 rate confirmed by third parties) | $37–38 | $39–80 | $46–109 |
| VPC interface endpoints (optional) | $0.01 per endpoint per AZ per hour ($14.60/month across 2 AZs) plus $0.01/GB. S3 gateway endpoint free. Verified 2026-11 ([AWS](https://aws.amazon.com/vpc/pricing/)) | $0 | $0–60 | $0–60 |
| Data transfer | Internet out: first 100 GB/month free, then $0.09/GB; between AZs $0.01/GB each way. Verified 2026-11 ([AWS Price List](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.json)) | $0–2 | $1–10 | $5–40 |
| Amazon SES | $0.10 per 1,000 emails (pay as you go) or $0.16 (Essentials plan, the default for new accounts since July 2026). Verified 2026-11 ([AWS](https://aws.amazon.com/ses/pricing/), [announcement](https://aws.amazon.com/about-aws/whats-new/2026/07/amazon-ses-pricing-plans/)) | $0–1 | $1–3 | $10–24 |
| AWS KMS | $1 per customer-managed key per month; $0.03 per 10,000 requests after 20,000 free. Verified 2026-11 ([AWS](https://aws.amazon.com/kms/pricing/)) | $1–3 | $2–5 | $3–10 |
| Secrets Manager (Parameter Store standard is free) | $0.40 per secret per month, $0.05 per 10,000 calls. Verified 2026-11 ([AWS](https://aws.amazon.com/secrets-manager/pricing/), [SSM](https://aws.amazon.com/systems-manager/pricing/)) | $2–4 | $3–5 | $4–8 |
| CloudWatch (logs, metrics, alarms) | Logs $0.50/GB ingested, $0.03/GB-month stored; metrics $0.30 each; alarms $0.10 each; 5 GB logs and 10 alarms free. Verified 2026-11 ([AWS](https://aws.amazon.com/cloudwatch/pricing/)) | $0–5 | $5–25 | $60–190 |
| ECR (container images) | $0.10/GB-month. Verified 2026-11 ([AWS](https://aws.amazon.com/ecr/pricing/)) | $0–1 | $0–1 | $1–2 |
| Route 53 (DNS) | $0.50 per hosted zone, $0.40 per 1M queries. Verified 2026-11 ([AWS](https://aws.amazon.com/route53/pricing/)) | $1–2 | $1–3 | $2–5 |
| Malware scanning of uploads (SEC-10) | Tool not chosen; assumes a small scanner task or a managed scan. Estimate | $0–10 | $5–20 | $20–50 |
| Staging account | A reduced copy of production that can be stopped when idle. Estimate | $40–90 | $40–90 | $60–120 |
| **AWS subtotal** | | **$152–263** | **$232–550** | **$623–1,311** |

**What drives AWS cost in the pilot:** fixed hourly items, not traffic. The load balancer, the
NAT gateway, and their public IPv4 addresses cost about $60 per month before a single guest opens
a guide. RDS and Fargate add about $35–60. Guest traffic fits in CloudFront's always-free
allowance until well past the launch scenario.

**Notes on the AWS line items:**

- **VPC endpoints do not pay off at pilot scale.** Each interface endpoint costs about $14.60 per
  month across two zones. It only saves money when more than about 400 GB per month of that
  service's traffic would otherwise go through the NAT gateway. The free S3 gateway endpoint is
  always worth it. (ADR-0009 prefers endpoints; see [§9](#9-most-uncertain-items).)
- **Lower-cost options exist but trade off safety or simplicity:** a NAT instance, or tasks in
  public subnets without a NAT gateway, could save about $35 per month in the pilot. They are
  not assumed here.
- **CloudFront flat-rate plans** (Free $0, Pro $15, Business $200 per month per distribution)
  bundle WAF rules, DDoS protection, and DNS with no overage charges. With separate distributions
  for the portal and the guide, Pro would cost about $30 per month, which is more than pay as you
  go at pilot traffic. Accounts on the AWS Free Tier plan are not eligible. Verified 2026-11
  ([AWS](https://aws.amazon.com/cloudfront/pricing/),
  [docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)).
- **SES:** switch the account from the default Essentials plan ($0.16 per 1,000) to pay as you
  go ($0.10). Request production access early; AWS answers within 96 hours. Verified 2026-11
  ([AWS docs](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)).
- **RDS burstable instances** (t4g) in "unlimited" mode can add $0.075 per vCPU-hour of surplus
  credits under sustained load. Verified 2026-11 ([AWS](https://aws.amazon.com/rds/postgresql/pricing/)).
- **AWS Support** is not included. The cheapest paid plan, Business Support+, costs the greater
  of $29 per month or 9% of AWS spend. Verified 2026-11
  ([AWS](https://aws.amazon.com/premiumsupport/pricing/)).
- **SST and OpenNext** are free and open source (MIT). The optional SST Console is free up to
  350 active resources. Verified 2026-11 ([SST](https://sst.dev/docs/console/),
  [OpenNext](https://github.com/opennextjs/opennextjs-aws)).
- **Compared with the earlier PaaS proposal** (Vercel, Railway, Neon), AWS costs roughly $40–150
  more per month in the pilot, mostly because of the fixed network items above. The gap shrinks
  as usage grows. Estimate.

### 3.2 AI inference

Built on the ADR-0005 cost model and the business-model unit economics.

| Item | Basis | Pilot | Launch | Year-1 |
|---|---|---|---|---|
| Guest replies | Replies × $0.03–0.11 (estimate; prices verified 2026-11) | $54–198 | $900–3,300 | $9,000–33,000 |
| Classification, output checks, cache pre-warming, copilot drafts | +15–35% of guest replies. Estimate | $8–69 | $135–1,155 | $1,350–11,550 |
| Guide drafting for new properties (interview, extraction, translation) | $0.50–3 per new property, one time. Estimate; new properties per month: 0–10, 50–150, 300–500 | $0–30 | $25–450 | $150–1,500 |
| Evals and development use | Eval suite runs in CI plus prompt work. Estimate | $50–300 | $100–500 | $200–1,000 |
| **AI subtotal** | | **$112–597** | **$1,160–5,405** | **$10,700–47,050** |

**What moves this number most:**

- **Cache hit rate.** A cache hit costs about a third of a miss. The pilot measures it (ADR-0005).
- **Replies per stay.** 15 is an assumption (A-03). Every extra reply per stay adds $0.12–0.44 per
  property per month.
- **The hybrid knowledge strategy at scale.** ADR-0005 estimates it saves about $1.26 per property
  per month at 10,000 properties. At 5,000 properties that is roughly $6,300 per month. Estimate.
- **Evals.** The constitution runs the eval suite on every pull request. Running a small subset
  on every pull request and the full suite on agent changes, and using the Batch API (50% off)
  where waiting is acceptable, keeps this line low. Estimate.
- **Cheaper models per route** are allowed only with eval evidence and founder approval (OQ-23).
  Not assumed here.

### 3.3 Other services and tools

| Item | Price | Pilot | Launch | Year-1 |
|---|---|---|---|---|
| Sentry (errors) | Developer free (1 user, 5,000 errors); Team $26/month annual or $29 monthly; Business $80/$89. Verified 2026-11 ([Sentry](https://sentry.io/pricing/)) | $0–29 | $26–60 | $80–150 |
| Domains (main domain plus a separate user-content domain, SEC-10) | .com about $10.46–11.17/year at cost (Cloudflare) or $15–16/year (Route 53; sources disagree). Verified 2026-11 (third-party: [CostGoat](https://costgoat.com/compare/domains/com)) | $2–3 | $2–3 | $2–3 |
| Founder's tools: Claude plan and GitHub | Claude Max $100/month or Ultra $200/month; GitHub Free $0 or Team $4 per user. Verified 2026-11 ([Claude](https://claude.com/pricing/max), [GitHub](https://github.com/pricing)) | $100–204 | $100–204 | $100–204 |
| **Other subtotal** | | **$102–236** | **$128–267** | **$182–357** |

Postmark stays the fallback email provider (ADR-0009): $15 per month for 10,000 emails. Verified
2026-11 ([Postmark](https://postmarkapp.com/pricing)).

### 3.4 Payment fees (Tilopay)

**TBD (OQ-37).** Tilopay does not publish its fees; they come from the commercial agreement
(ADR-0007). Who absorbs them is also open (OQ-09). To size the impact, this is the add-on volume
they would apply to, using the business-model assumptions (25% of stays buy a $35 add-on):

| | Pilot (from month 4) | Launch | Year-1 |
|---|---|---|---|
| Add-on sales per month (estimate) | ~$1,050 | ~$17,500 | ~$175,000 |
| Cost of each 1% of payment fees | ~$10.50 | ~$175 | ~$1,750 |

### 3.5 Totals

| | Pilot | Launch | Year-1 |
|---|---|---|---|
| AWS hosting | $152–263 | $232–550 | $623–1,311 |
| AI inference | $112–597 | $1,160–5,405 | $10,700–47,050 |
| Other services and tools | $102–236 | $128–267 | $182–357 |
| Payment fees | TBD | TBD | TBD |
| **Total per month** | **$366–1,096** | **$1,520–6,222** | **$11,505–48,718** |
| Per property | $12.20–36.54 | $3.04–12.44 | $2.30–9.74 |

## 4. One-time and pre-launch costs

| Item | Range | Label | When |
|---|---|---|---|
| Legal review (OQ-35): Airbnb policies, selling add-ons through checkout, privacy policy and terms, data-protection laws in the US and Latin America | $3,000–15,000 | Estimate. A terms of service and privacy policy alone cost about $1,000–2,500. Verified 2026-11 (third-party: [Revision Legal](https://revisionlegal.com/services/internet-lawyer/terms-of-service-and-privacy-policies-the-fine-print/), [terms.law](https://www.terms.law/services/)) | Payments part before month 4; the rest before the public launch |
| External penetration test (SEC-19) | $5,000–15,000 | Verified 2026-11 (third-party ranges: [Astra](https://www.getastra.com/blog/penetration-testing/cost/), [Blaze](https://www.blazeinfosec.com/post/how-much-does-penetration-testing-cost/), [RedFox](https://www.redfoxsec.com/blog/how-much-does-web-application-penetration-testing-cost-2026-pricing-guide)) | Before the public launch |
| Brand identity (OQ-11) | $500–5,000 | Verified 2026-11 (third-party; sources disagree, some quote $5,000–20,000 for a boutique studio: [ManyPixels](https://www.manypixels.co/blog/brand-design/brand-identity-design-cost), [Branx](https://thebranx.com/blog/startup-branding-cost-guide)) | Before the public launch |
| Trademark search and filings (OQ-11), 2 classes in the US, Costa Rica, and Mexico | $1,200–6,000 | Official fees: USPTO $350 per class, verified 2026-11 ([USPTO](https://www.uspto.gov/trademarks/trademark-fee-information)); Costa Rica about $50 per class and $500–800 per class with an attorney (third-party: [Alpi](https://alpilaw.com/trademark-registration-costs-costa-rica/)); Mexico about MXN 2,814 per class (third-party: [Praxium](https://praxiumconsultores.com/blog/cuanto-cuesta-registrar-una-marca-en-el-impi)). The range is an estimate: official fees alone at the low end, attorneys at the high end | Before the public launch |
| AI drafting for the first ~30 pilot guides | $15–90 | Estimate ($0.50–3 per property) | Pilot onboarding |
| Spec Kit, SST, OpenNext | $0 | Free and open source (MIT). Verified 2026-11 ([Spec Kit](https://github.com/github/spec-kit)) | — |
| **Total** | **$9,715–41,090** | Estimate | |
| *Optional:* company formation, only if a new entity is needed (OQ-01) | $835–2,500 | Third-party estimates for Costa Rica, verified 2026-11 ([Expat.com](https://www.expat.com/en/guide/central-america/costa-rica/12572-setting-up-a-business-in-costa-rica.html)) | Before payments |
| *Optional:* a mid-range Android phone for performance testing | $150–400 | Estimate | Before the pilot |

## 5. Development (Phase 1, 4 months)

The founder works full time for 4 months with AI coding agents (roadmap). The founder's
compensation is an input for the founder to fill in; this document does not estimate it.

| Item | Per month | 4 months | Label |
|---|---|---|---|
| **Founder's compensation** | **[input]** | **[input × 4]** | Input |
| Claude plan for AI coding (Max or Ultra) | $100–200 | $400–800 | Verified 2026-11 ([Claude](https://claude.com/pricing/max)) |
| GitHub | $0–4 | $0–16 | Verified 2026-11 ([GitHub](https://github.com/pricing)) |
| Claude API for development and evals | $100–1,000 | $400–4,000 | Estimate |
| AWS development and staging account | $40–90 | $160–360 | Estimate |
| Pilot operations, about 1.5 months from the end of month 3 (AWS production, AI replies, Sentry, domains) | $176–472 | $264–708 | Estimate (from §3) |
| **Total, excluding the founder** | | **$1,224–5,884** | Estimate |

## 6. Revenue (illustrative)

From the [business model](../product/business-model.md#4-unit-economics-illustrative), per active
property per month: tour commissions about $3.84 (10% of stays × $120 × 8%), add-on platform fees
about $2.80 (25% of stays × $35 × 8%), and an optional Pro subscription of about $9–12. These are
hypotheses to validate in the pilot.

| | Pilot | Launch | Year-1 |
|---|---|---|---|
| Tour commissions | ~$115 | ~$1,920 | ~$19,200 |
| Add-on platform fees (from month 4) | ~$84 | ~$1,400 | ~$14,000 |
| Subscriptions (assumes 20–40% of properties on Pro at $9–12; billing starts in Phase 2) | $0 (pilot is free) | $900–2,400 | $9,000–24,000 |
| **Illustrative revenue per month** | **~$200** | **$4,200–5,700** | **$42,200–57,200** |
| Revenue per property | ~$6.64 | $8.44–11.44 | $8.44–11.44 |
| Operating cost per property ([§3.5](#35-totals)) | $12.20–36.54 | $3.04–12.44 | $2.30–9.74 |

**What this shows:**

- **The pilot costs more than it earns.** That is expected: it exists to measure replies per
  stay, cache hit rate, and attach rates.
- **At scale, the margin depends on AI cost.** At the low end of AI cost the model is healthy; at
  the high end (no cache hits, more replies) it is close to break-even. Caching, the hybrid
  knowledge strategy, and Free-plan reply caps are the levers (business model §4).
- **Payment fees (TBD) reduce add-on revenue** by about 1% of add-on sales for each 1% of fees,
  unless the guest pays a service fee (OQ-09).
- Affiliate payout timing and minimums depend on each partner program (not researched).

## 7. Ways to lower early costs

All of these are **unverified for Guidesk**: eligibility depends on the account and the company.

- **AWS Free Tier (accounts created after 2025-07-15):** $100 in credits at sign-up and up to
  $100 more for completing activities. The free account plan ends after 6 months or when the
  credits run out. Free-plan accounts are not eligible for AWS Activate or for CloudFront
  flat-rate plans. Verified 2026-11 ([AWS FAQ](https://aws.amazon.com/free/free-tier-faqs/),
  [docs](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)).
- **AWS Activate:** Founders credits start at $1,000 (up to $5,000 for selected participants);
  Portfolio credits go up to $200,000 through an accelerator or investor. Requires a company
  before Series B, founded within 10 years, on a paid AWS account. Verified 2026-11
  ([AWS](https://aws.amazon.com/startups/credits)). $1,000 would cover about 4–6 months of pilot
  AWS costs (estimate).
- **Always-free allowances** for CloudFront, Lambda, CloudWatch, and others are already included
  in the figures above.
- **Settings that save money:** SES on pay as you go, Arm (Graviton) for Fargate, staging stopped
  outside working hours, and no interface endpoints until traffic justifies them.
- **Claude through Amazon Bedrock** could let AWS credits pay for some AI usage. Guidesk uses
  Anthropic's API directly (ADR-0005); switching would need its own ADR, and Bedrock prices
  differ. Not assumed. See the [open items](#9-most-uncertain-items).

## 8. What is not included

- The founder's compensation (an input) and any future salaries, including support staff at
  scale.
- Marketing, sales, travel, and design-partner incentives.
- Phase 2 and Phase 3 costs: PMS partner fees (often $0 but not guaranteed), white-label
  connectivity (Channex is about $130 per month plus per-unit fees, per the
  [integrations research](../research/integrations.md)), insurance partners.
- Taxes, accounting, bank fees, and business insurance (for example cyber liability, worth
  considering for a company that holds door codes).
- Currency exchange costs.

## 9. Most uncertain items

| Item | Why it is uncertain | What settles it |
|---|---|---|
| AI cost per reply and replies per stay | Assumptions until the pilot measures them (A-03) | Pilot telemetry and the ADR-0005 dashboard |
| Eval and development AI usage | Depends on the size of the eval suite and how often it runs | First month of CI runs |
| Tilopay fees | Not public | OQ-37 |
| Legal review scope | OQ-35 covers several jurisdictions and topics. Costa Rica also published a new digital services and e-commerce law in June 2026, reportedly not yet in force (third-party law-firm report, not verified) | Quotes from counsel |
| Speech-to-text for voice notes | FR-03.3 needs audio transcribed, but no provider is chosen; it would be a new subprocessor. Not in the figures above | The guide-builder plan (spec 003) |
| RDS Multi-AZ storage price | Sources disagree ($0.115 or $0.23 per GB-month) | The AWS pricing calculator |
| NAT and VPC endpoint design | ADR-0009 prefers interface endpoints, which cost more than they save at pilot scale | Founder decision when ADR-0009 is accepted |
| Malware scanning tool | Not chosen (SEC-10) | The guide-builder plan (spec 003) |
| Credits | Eligibility for Activate and other programs is unverified | Applications |

## 10. Sources

All checked in November 2026. Third-party sources are marked.

- Anthropic: [API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- AWS: [CloudFront pay as you go](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) ·
  [CloudFront plans](https://aws.amazon.com/cloudfront/pricing/) ·
  [Lambda](https://aws.amazon.com/lambda/pricing/) · [S3](https://aws.amazon.com/s3/pricing/) ·
  [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/) ·
  [VPC, NAT, public IPv4](https://aws.amazon.com/vpc/pricing/) ·
  [Fargate](https://aws.amazon.com/fargate/pricing/) ·
  [RDS for PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/) ·
  [RDS FAQ](https://aws.amazon.com/rds/faqs/) · [WAF](https://aws.amazon.com/waf/pricing/) ·
  [CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) ·
  [Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) ·
  [Systems Manager](https://aws.amazon.com/systems-manager/pricing/) ·
  [KMS](https://aws.amazon.com/kms/pricing/) · [ECR](https://aws.amazon.com/ecr/pricing/) ·
  [Route 53](https://aws.amazon.com/route53/pricing/) · [SES](https://aws.amazon.com/ses/pricing/) ·
  [Support](https://aws.amazon.com/premiumsupport/pricing/) ·
  [Free Tier FAQ](https://aws.amazon.com/free/free-tier-faqs/) ·
  [Activate](https://aws.amazon.com/startups/credits)
- RDS instance prices (third-party mirror of AWS prices):
  [Vantage](https://instances.vantage.sh/aws/rds/db.t4g.micro?region=us-east-1)
- Tools: [Sentry](https://sentry.io/pricing/) · [Postmark](https://postmarkapp.com/pricing) ·
  [Claude plans](https://claude.com/pricing) · [GitHub](https://github.com/pricing) ·
  [Spec Kit](https://github.com/github/spec-kit) · [SST Console](https://sst.dev/docs/console/) ·
  [OpenNext](https://github.com/opennextjs/opennextjs-aws)
- Domains (third-party): [CostGoat](https://costgoat.com/compare/domains/com)
- Trademarks: [USPTO fees](https://www.uspto.gov/trademarks/trademark-fee-information) · Costa
  Rica (third-party): [Alpi](https://alpilaw.com/trademark-registration-costs-costa-rica/) ·
  Mexico (third-party): [Praxium](https://praxiumconsultores.com/blog/cuanto-cuesta-registrar-una-marca-en-el-impi)
- Penetration testing (third-party): [Astra](https://www.getastra.com/blog/penetration-testing/cost/) ·
  [Blaze](https://www.blazeinfosec.com/post/how-much-does-penetration-testing-cost/) ·
  [RedFox](https://www.redfoxsec.com/blog/how-much-does-web-application-penetration-testing-cost-2026-pricing-guide)
- Legal (third-party): [Revision Legal](https://revisionlegal.com/services/internet-lawyer/terms-of-service-and-privacy-policies-the-fine-print/) ·
  [terms.law](https://www.terms.law/services/) ·
  [Expat.com, Costa Rica company setup](https://www.expat.com/en/guide/central-america/costa-rica/12572-setting-up-a-business-in-costa-rica.html)
- Brand (third-party): [ManyPixels](https://www.manypixels.co/blog/brand-design/brand-identity-design-cost) ·
  [Branx](https://thebranx.com/blog/startup-branding-cost-guide)
