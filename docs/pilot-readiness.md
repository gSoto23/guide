# Pilot Readiness Checklist

**Status:** 2026-11-19. Every Phase 1 MVP spec (001 to 011, and 013 with a simulated payment
provider) is merged in `main`. What remains before the first pilot guest is listed here: every item
needs the founder (an account, a decision, a secret, a signature, or a check with real people and
devices). Each item links to where it was recorded. Tick items as they close and note the date.

Order of work: start the long-lead items in section 1 first (weeks of lead time), then the AWS stage
(section 2), then the checks with real services (section 3), then the staging run (section 4).

The questions for Tilopay, Beds24, Hostex, Viator, and Civitatis, and the text of the SES production
access request, are drafted in [partner outreach](partner-outreach.md).

## 1. Decisions, accounts, and legal (long lead)

- [ ] **Legal entity** that bills and collects (OQ-01). Blocks Tilopay and real payments.
- [ ] **Tilopay merchant account** and written answers (OQ-37): split settlement for hosts under the
  payment-facilitator model, host onboarding requirements, countries covered, international cards,
  refunds through the API, the event signature scheme, and fees ([draft](partner-outreach.md#1-tilopay)).
  Then the Tilopay adapter (a new spec)
  and the sandbox confirmation steps of [ADR-0007](architecture/adr/0007-tilopay-initial-payment-provider.md).
  Until then production runs with `PAYMENTS_MODE=off` (spec 013).
- [ ] **Legal review (OQ-35)** of every text guests and hosts see, in one pass:
  - the guide's disclosures and templates (spec 004 R20);
  - the chat's intro and holding replies (spec 005 R16), and the formal and quiet-hours texts (spec 007
    R16);
  - the copilot's fixed texts and the push texts (spec 006 R12);
  - extras texts, and whether early check-in and late checkout may be sold as extras and through
    checkout (spec 008 R10, spec 013);
  - the Explore partner disclosure (spec 009 R13);
  - checkout texts, "taxes included by the host", receipts, and guest data at checkout (spec 013 R10);
  - the privacy policy and terms of service: drafts written from what Guidesk does are live at
    `/{locale}/privacy` and `/{locale}/terms` on the portal (spec 014), with the last-updated date in
    `apps/portal/lib/public/legal.ts`;
  - the consent line on sign-in and invitations, and the public home page's claims (spec 014).
- [ ] **Fee policy and plan numbers:** confirm or change the defaults chosen during the build:
  - who absorbs the card fee: the host (OQ-09, spec 013);
  - Guidesk's platform fee: Free 10%, Pro 7%, Business 5% (`packages/domain/src/payments/`), confirmed
    by the founder on 2026-11-19. With Tilopay's reported card fee of 4.2% plus USD 0.30, a USD 35
    add-on costs the host about 15% in total on Free, 12% on Pro, and 10% on Business;
  - what happens to that fee when a host refunds: today each order keeps the fee fixed at payment and
    no rule returns it, so decide whether a refund returns the fee in proportion (spec 013; the Tilopay
    answer on how refunds reverse a split settlement shapes it);
  - plan limits: Free 2 properties, 100 AI replies a month, 1 seat; Pro 300 AI replies per active
    property and 3 seats; Business unlimited seats (OQ-10, `packages/domain/src/plans/`).
- [ ] **PMS read-only import permission** in writing from Beds24 and Hostex for a customer's own token
  (OQ-26, spec 002 R15). Blocks `GUIDESK_PMS_BEDS24` and `GUIDESK_PMS_HOSTEX`. Drafts:
  [Beds24](partner-outreach.md#2-beds24), [Hostex](partner-outreach.md#3-hostex).
- [ ] **Affiliate programs** (OQ-34, spec 009 R13): join Viator (basic-access API key) and Civitatis
  (affiliate number), ask Civitatis for its feed or API, and confirm each partner's content terms.
  Drafts: [Viator](partner-outreach.md#4-viator), [Civitatis](partner-outreach.md#5-civitatis).
- [ ] **Brand and domains** (OQ-11): trademark search and the domains. The visual identity (direction
  "A · Bienvenida") is already in main (PR #3, [brand guide](brand/README.md)).
- [ ] **Design partners and dates** (OQ-03, OQ-02): the 10 to 20 hosts and 3 to 5 managers, their PMS,
  the pilot start date, and the monthly budget.

## 2. AWS and the staging stage

- [ ] **AWS account** with GitHub OIDC for deploys; set the repository variable `AWS_DEPLOY_ROLE_ARN`
  (the deploy workflow skips until it exists).
- [ ] **Domains** for the stage: `GUIDESK_PORTAL_DOMAIN`, `GUIDESK_API_DOMAIN`, and
  `GUIDESK_GUIDE_DOMAIN` (required in production), and the email sender `GUIDESK_EMAIL_SENDER`. Set
  them, like every `GUIDESK_*` setting, as variables of the GitHub environment (Settings →
  Environments → staging or production → Variables); the deploy passes them to SST. With the DNS in
  Route 53, SST creates the certificates and records.
- [ ] **Public pages (spec 014):** `GUIDESK_CONTACT_EMAIL` (the address shown on the home page and in
  the legal pages; production refuses to deploy without it) and `GUIDESK_COMPANY_NAME` (the company
  named as responsible, once the legal entity exists, OQ-01; "Guidesk" until then).
- [ ] **Email:** verify the sending domain in Amazon SES and request production access (sending to any
  address) well before the pilot ([ADR-0009](architecture/adr/0009-mvp-hosting-and-transactional-email.md);
  [request text](partner-outreach.md#6-amazon-ses-production-access)).
- [ ] **Secrets per stage** with `pnpm sst secret set <Name> <value> --stage <stage>`
  (`infra/secrets.ts`): `BetterAuthSecret`, `GoogleClientId`, `GoogleClientSecret`, `EdgeSharedSecret`,
  `AnthropicApiKey`, `FeedUrlPepper`, `VapidPublicKey` and `VapidPrivateKey` (generate with
  `npx web-push generate-vapid-keys`; deploys fail without them, spec 006 R12), and `ViatorApiKey`
  (defaults to `unset`, which hides Viator products).
- [ ] **Optional stage settings:** `GUIDESK_SENTRY_DSN`, `GUIDESK_PLAN_CONTACT_EMAIL` (where hosts ask
  for a plan change, spec 011), `GUIDESK_CIVITATIS_AFFILIATE_ID`, and
  `GUIDESK_EXPERIENCE_IMAGE_ORIGINS` (partner photo hosts, confirm with the live Viator key).
- [ ] **GuardDuty Malware Protection** on the uploads bucket, blocking for screenshots, CSV files,
  media, and documents (spec 002 R9, spec 003 R22). Uploads wait for the scan in AWS.
- [ ] **AWS Organizations AI-services opt-out policy** covering Transcribe (spec 003 R22).
- [ ] **CloudFront and WAF logs** on the guide's distribution must not record `/s/{token}` paths
  (standard logs off or URI redaction, spec 004 R20).
- [ ] **Database access for the founder's tools** in staging and production: `report:pilot` (spec
  010) and `plan:set` / `plan:show` (spec 011) run where migrations run.

## 3. Checks with real services and people

- [ ] **`ANTHROPIC_API_KEY` CI secret**, then the eval suites with the real model: guide AI (spec 003),
  the guide chat agent and assistant settings (specs 005 and 007), the 16 copilot cases (spec 006), and
  the Explore and extras cases (specs 008 and 009). Prompt or schema changes merge only after they pass.
- [ ] **Voice answers:** Transcribe check on 20 real recordings (10 Spanish, 10 English, phone
  microphones), draft within 30 seconds for 90% (spec 003 R22). Then `GUIDESK_GUIDE_INTERVIEW_VOICE`.
- [ ] **Scanned PDFs:** check the OCR of scanned pages on a few real scanned house manuals; the flag is
  off by default (spec 003 R22). Then `GUIDESK_GUIDE_SCANNED_PDF`.
- [ ] **Screenshot extraction:** spot check with real host screenshots (spec 002 R3). Then
  `GUIDESK_EXTRACTION_SCREENSHOTS`.
- [ ] **Calendars:** add real Booking.com and Vrbo iCal exports to the classification fixtures (spec
  002 R8).
- [ ] **PMS imports:** replace the synthetic fixtures with recordings from test accounts (spec 002).
- [ ] **Viator live key:** Spanish support, sort values, duration field, rate limits, and image hosts
  (spec 009 R1 and R13); curate Civitatis entries for the pilot destinations.
- [ ] **Payments:** the Tilopay adapter and its sandbox run (section 1), then `PAYMENTS_MODE=tilopay`
  in `infra/services.ts`.

## 4. The staging run

Run each spec's quickstart on staging with real phones on mobile data (each `specs/*/quickstart.md`):

- [ ] Sign-up, sign-in, passkeys, invitations, and workspace switching (001).
- [ ] Property onboarding: manual, listing text, CSV, calendars (002).
- [ ] Guide builder, AI interview, translations, uploads (003).
- [ ] Guest guide with a real stay link, code reveal, and offline use (004); watch the guest renderer
  for `429` responses (spec 004 R20).
- [ ] Guide chat with the real model, escalations, and the inbox (005, 006, 007).
- [ ] Push alerts on Android and on an iPhone home-screen app (006).
- [ ] Explore with live partner data (009).
- [ ] Extras and requests with a real stay link (008); checkout once Tilopay exists (013).
- [ ] Analytics and the pilot report against staging data (010).
- [ ] Migrations run after every deploy as a one-off task of the API (`scripts/aws-task.sh <stage>
  migrate`, also a step of the deploy workflow).
- [ ] The public home, privacy policy, and terms on the stage's domain, and the demo workspace
  (`AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging demo-seed <email>`, spec 014 quickstart
  scenario 5).
- [ ] Plan limits, the usage emails, and Plan and limits (011).

## 5. Pilot operations

- [ ] Move each design partner to Pro or Business with `pnpm --filter @guidesk/db plan:set -- --workspace
  <uuid> --plan pro --note "pilot"` (spec 011); set a negotiated fee with `--fee-percent` (spec 013).
- [ ] Run `pnpm --filter @guidesk/db report:pilot -- --from <date>` monthly for the PRD §8 metrics
  (spec 010).
- [ ] Close the GitGuardian incident for the synthetic Wi-Fi password in test fixtures (opened with spec
  004; the code uses neutral values such as `TEST-0000` since then).
- [ ] Decide pricing from pilot evidence (roadmap exit criteria, OQ-10).

## Feature flags and modes

| Setting (stage environment) | Off until |
|---|---|
| `GUIDESK_PMS_BEDS24`, `GUIDESK_PMS_HOSTEX` | OQ-26 confirmations and recorded fixtures |
| `GUIDESK_EXTRACTION_SCREENSHOTS` | The real-screenshot spot check |
| `GUIDESK_GUIDE_INTERVIEW_VOICE` | The Transcribe check and the AI-services opt-out |
| `GUIDESK_GUIDE_SCANNED_PDF` | A check on real scanned manuals |
| `PAYMENTS_MODE` (`off` in `infra/services.ts`) | The Tilopay adapter and its sandbox run |
| `ViatorApiKey` (`unset`) | Joining Viator |
