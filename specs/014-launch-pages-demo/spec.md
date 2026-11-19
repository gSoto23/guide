# Feature Specification: Launch Pages and Demo Workspace

**Feature Branch**: `014-launch-pages-demo`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "014 Launch pages and demo workspace (pilot readiness; OQ-35 legal review pending; SES production access and Google sign-in need a public site with a privacy policy). Two independent parts. (A) Public pages on the portal domain, in Spanish and English: a real public home page, a privacy policy, and terms of service, written as drafts for the legal review from what Guidesk actually does; a consent line on sign-in; a privacy link in the guest guide; search basics; the installed portal app opens the signed-in start page; portal budgets and CI checks. (B) A founder command that creates a demo workspace with realistic synthetic data on a non-production stage: two properties in Costa Rica with published guides, stays and stay links, extras and requests, an open escalation, and about 60 days of analytics history; never calls the AI model or partner APIs; refuses production and unknown emails; recorded in the security log; excluded from the pilot report."

**Sources**: [Pilot readiness](../../docs/pilot-readiness.md) · [Security](../../docs/architecture/security.md) (data classes, SEC-06, SEC-11, SEC-15, SEC-16, SEC-20) ·
[Performance](../../docs/architecture/performance.md) · [Brand guide](../../docs/brand/README.md) · [PRD NFR-04, NFR-06](../../docs/product/prd.md) ·
[Business model §2–3](../../docs/product/business-model.md) · [Platform policies](../../docs/research/platform-policies.md) ·
[OQ-01, OQ-35](../../docs/open-questions.md) · [Partner outreach (SES request)](../../docs/partner-outreach.md) · Spec 001 (accounts),
004 (guest guide, stay links), 005–007 (chat, inbox, assistant), 008 (extras), 009 (Explore), 010 (analytics, pilot report), 011 (plans), 013 (fees)

## Clarifications

### Session 2026-11-19

Answered with the recommended option under the founder's standing instruction to run all phases; the
founder can change any of them.

- Q: Where do the public pages live? → A: On the portal domain: the home at `/{locale}`, the privacy
  policy at `/{locale}/privacy`, and the terms at `/{locale}/terms`, in Spanish and English. No separate
  marketing site or domain.
- Q: Do the legal pages show a "draft" notice while the legal review (OQ-35) is open? → A: No public
  banner. Each page shows its last-updated date; the pilot readiness checklist tracks the review, and
  the founder publishes the production domain only after it. Staging can show the drafts.
- Q: Who is named as responsible while the legal entity is open (OQ-01)? → A: A company-name stage
  setting, shown as "Guidesk" when unset. The contact address is another stage setting; production
  refuses to deploy without it, other stages hide the lines that need it.
- Q: Does the home page show prices? → A: Free at USD 0 with its limits; Pro and Business with their
  differences and "price to be announced" (prices are pilot hypotheses, OQ-10); the fees on extras
  confirmed on 2026-11-19 (Free 10%, Pro 7%, Business 5%).
- Q: Who does the demo command belong to, and whose account does it use? → A: The founder runs it.
  It uses an existing account (the founder signs up normally first) and creates a new workspace with
  that account as owner, so no fake accounts or passwords exist.
- Q: How many properties and which plan? → A: Two properties on the Pro plan. Two keeps owners out of
  the mandatory second factor that starts above two properties (SEC-05), so the demo account is not
  forced to enroll MFA just to see the demo.
- Q: Can the command print the stay link? → A: No. A stay link is a secret (restricted data), and on
  staging the command's output lands in the cloud logs. It prints the public guide links and tells the
  founder to copy the stay link from the portal, which already offers that.
- Q: How is a demo run told apart from real data? → A: The workspace carries a demo mark. The pilot
  report leaves demo workspaces out, and every run is recorded in the security log.
- Q: What happens on a second run? → A: It creates another demo workspace with a numbered name.
  Deleting demo workspaces is out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A visitor learns what Guidesk is and starts free (Priority: P1)

A host hears about Guidesk and opens its address on a phone. The home page explains, in their
language, what Guidesk does (a property guide with an AI concierge that answers guests and hands
sensitive topics to the host), who it is for, how it works in three steps, its main features, and the
plans. A "start free" button takes them to sign in or sign up. The page works without waiting for
anything else to load and links to the privacy policy and the terms.

**Why this priority**: The portal domain's root is the first thing partners, pilot hosts, and the
reviewers of Amazon SES and Google sign-in see. Today it shows only a name and a sign-in button.

**Independent Test**: Open `/es` and `/en` on a phone-sized screen: all sections render in the right
language, the call to action reaches sign-in in one tap, the footer links reach the legal pages, and
the page passes the portal's size, speed, and accessibility checks.

**Acceptance Scenarios**:

1. **Given** a visitor with a Spanish browser, **When** they open the domain root, **Then** they land
   on the Spanish home page with the tagline "Tu casa, siempre lista para responder.", the three steps,
   the features, the plans, and a "Empieza gratis" button.
2. **Given** the home page, **When** the visitor taps the call to action, **Then** they reach the
   sign-in and sign-up screen in the same language.
3. **Given** the plans section, **When** the visitor reads it, **Then** Free shows USD 0 with 2
   properties, 100 AI replies a month, and 1 seat; Pro and Business show their differences and "price to
   be announced"; and the fees on extras read Free 10%, Pro 7%, Business 5%.
4. **Given** a contact address is configured, **When** the visitor reaches the footer, **Then** they see
   it as text they can copy; **Given** none is configured, **Then** the contact line is absent.
5. **Given** a visitor switches language on the home page, **When** the page reloads, **Then** every
   text is in the other language and the address keeps the page.

---

### User Story 2 - Hosts and guests can read how their data is handled and the terms (Priority: P1)

Before signing up, a host reads the privacy policy and the terms. A guest who opened a guide follows
its privacy link. Both pages say in plain language who is responsible, what data Guidesk keeps and
why, which providers process it, how long it is kept, which cookies exist, what rights people have and
how to use them, and the date of the last update. The sign-in screen tells new users that continuing
accepts both documents.

**Why this priority**: Amazon SES production access and Google sign-in ask for a privacy policy, and
the legal review (OQ-35) needs a first draft written from what the product actually does.

**Independent Test**: Open both pages in both languages and compare them with the data classes,
retention, and subprocessors in `docs/architecture/security.md` and the infrastructure; check the
consent line and links on sign-in and the privacy link in the guest guide.

**Acceptance Scenarios**:

1. **Given** the privacy policy, **When** a reader looks for providers, **Then** it lists AWS (hosting
   in the United States, us-east-1), Anthropic (AI answers), Amazon SES (email), Google (sign-in, only for
   people who choose it), the payment provider (only when online payments are on), Viator and Civitatis
   (only when a guest opens their link), and Sentry (error reports, only when enabled).
2. **Given** the privacy policy, **When** a reader looks for retention, **Then** it says guest messages
   and assistant records are deleted or anonymized 12 months after checkout, account data is kept while
   the account is active, and door codes and other locked values are kept until the host deletes them.
3. **Given** the privacy policy, **When** a reader looks for cookies, **Then** it names the session and
   language cookies, says there are no analytics or advertising cookies, and explains why no consent
   banner appears.
4. **Given** the privacy policy, **When** a reader wants to exercise a right, **Then** it explains
   access, correction, export, and deletion, answered within 30 days, and how to ask (the contact
   address when configured).
5. **Given** the terms, **When** a host reads them, **Then** they cover accounts and roles, acceptable
   use, the host's responsibility for the guide's accuracy and for what they sell, the assistant's
   limits and escalation of sensitive topics, platform fees and payments through the provider, the free
   pilot, suspension and termination, liability limits, changes, and the governing law (Costa Rica).
6. **Given** the sign-in screen and the invitation screen, **When** a person is about to continue,
   **Then** a line says that continuing accepts the terms and the privacy policy, with a link to each
   that opens in the same language.
7. **Given** a guest guide, **When** the guest scrolls to the end of the home or opens the chat
   panel, **Then** they find a privacy link that opens the privacy policy in the guide's language.
8. **Given** a company name is configured, **When** a reader opens either page, **Then** it names that
   company as responsible; **Given** none, **Then** it says "Guidesk".

---

### User Story 3 - The founder fills a stage with a realistic demo in one command (Priority: P2)

Before a partner demo, the founder signs up on staging, runs one command with their email, and opens
the portal: a new workspace "Demo · Guidesk" holds a beach house in Santa Teresa and an apartment in
Escazú, each with a published bilingual guide, stays (past, current, upcoming), extras and requests, an
open malfunction escalation waiting in the inbox, and two months of analytics with trends. From the
portal they copy the current stay link, open it on a phone, and show the door code, the chat, and
Explore. Nothing in the run calls the AI model or a partner.

**Why this priority**: The demo plan needs a lived-in workspace; building one by hand takes an hour
per stage and spends AI calls.

**Independent Test**: On a local or staging database with one signed-up account, run the command:
the workspace appears with all the data above, Analytics for 30 days shows values and comparisons in
every block, the inbox shows the open escalation, the current stay link (copied from the portal) shows
the door code, and the pilot report is unchanged.

**Acceptance Scenarios**:

1. **Given** an existing account, **When** the founder runs the command with its email, **Then** a new
   workspace marked as demo exists with that account as its only owner, on the Pro plan, with the two
   properties ready and their guides published in Spanish and English.
2. **Given** the demo workspace, **When** the founder opens Stays, **Then** each property has a past, a
   current, and an upcoming stay with fictional guest first names, and the current stay's link works now
   in the property's time zone and reveals the door code.
3. **Given** the demo workspace, **When** the founder opens the inbox, **Then** one conversation waits
   for the host with the reason "malfunction", and older conversations show answers the assistant gave
   by itself.
4. **Given** the demo workspace, **When** the founder opens Analytics for the last 30 days, **Then**
   guide opens, guest questions, automated resolution, escalations by reason, top topics, unanswered
   questions, Explore opens and partner clicks, and add-on requests all show values and a change against
   the previous 30 days.
5. **Given** the demo workspace, **When** the founder opens Extras and Requests, **Then** the catalog has
   an airport pickup, an extra cleaning, and a surfboard rental, and requests appear pending, confirmed,
   and declined.
6. **Given** the run finished, **When** the founder reads its output, **Then** it shows the workspace
   name, both public guide links, and how to copy the stay link from the portal, and it contains no door
   code and no stay link.
7. **Given** a second run for the same account, **When** it finishes, **Then** a separate demo workspace
   exists with a numbered name, and the first one is untouched.

---

### User Story 4 - The installed portal app opens where hosts work (Priority: P3)

A host who installed the portal on their phone's home screen (for push alerts) opens it and lands on
their signed-in start page instead of the public home page.

**Why this priority**: Once the root becomes a public page, the installed app would otherwise open on
marketing content every time.

**Independent Test**: Read the installed app's start address and open it signed in and signed out:
signed in it shows the start page; signed out it asks to sign in.

**Acceptance Scenarios**:

1. **Given** the installed portal app, **When** a signed-in host opens it, **Then** the start page opens.
2. **Given** the installed portal app, **When** a signed-out person opens it, **Then** the sign-in
   screen opens.

### Edge Cases

- **No contact address or company name configured** (local and staging): the pages read correctly
  without them; contact lines are hidden and "Guidesk" is named. Production refuses to deploy without
  the contact address.
- **Unsupported language in the address**: not found, as today.
- **JavaScript off or slow**: the public pages are complete as delivered; nothing on them waits for
  scripts.
- **A signed-in person opens the home page**: the call to action still works and takes them to their
  portal through the normal sign-in flow without asking again.
- **Search engines**: only the home, privacy, and terms pages, in both languages, are listed and
  allowed; portal screens, the API, guest guides, and stay links are never listed and stay out of
  indexes.
- **Long texts on narrow screens**: the legal pages wrap and keep a readable line length at 320 px; the
  plans stack into one column.
- **Demo on the production stage**: refused before anything is written.
- **Demo with an unknown email, or with an account that is not verified**: refused; nothing is written.
- **Demo encryption unavailable** (keys unreachable): the run fails with a clear message and leaves no
  partial workspace.
- **Demo near midnight or across time zones**: stay dates are computed in each property's time zone so
  the current stay is active when the run ends.
- **Demo analytics comparisons**: the properties and workspace look old enough (created about 75 days
  earlier) for the previous-period comparison to show.
- **Demo and plan limits**: the demo's AI-reply history counts toward the demo workspace only and stays
  under the Pro limit, so the live assistant keeps answering during the demo.
- **Demo notifications**: seeding sends no emails and no push alerts, even for the open escalation.
- **Demo workspaces in the pilot report**: left out of every metric; an account whose only workspaces
  are demo workspaces is left out of the sign-up cohorts.

## Requirements *(mandatory)*

### Functional Requirements

**Public home page**

- **FR-001**: The portal domain root MUST show a public home page in Spanish and English at `/{locale}`,
  reachable from `/` by the existing language detection, with: the brand tagline, what Guidesk is and
  for whom (individual hosts and property managers), how it works in three steps (create the guide from
  your listing, share the link with guests, the assistant answers and hands sensitive topics to you), the
  main features (guide, guide chat with escalation, copilot for platform chats, extras and Explore,
  analytics), the plans, and a footer.
- **FR-002**: The plans section MUST show Free at USD 0 with its limits (2 active properties, 100 AI
  replies a month, 1 seat), Pro and Business with their differences (properties, AI replies, seats) and
  "price to be announced", the fees on extras (Free 10%, Pro 7%, Business 5%), and that the pilot is free.
  The numbers MUST come from the same values the product enforces, so a change to the plans changes the
  page.
- **FR-003**: A "start free" call to action MUST take the visitor to sign in or sign up in the same
  language, and the header MUST offer sign-in and a language switch.
- **FR-004**: The footer MUST link to the privacy policy and the terms, show the contact address when
  configured, and show the company name.
- **FR-005**: The home page MUST NOT claim an official partnership or in-platform messaging with Airbnb,
  Booking.com, or Vrbo; it MUST describe the copilot as drafting replies the host pastes into the
  platform chat.

**Legal pages**

- **FR-006**: The privacy policy MUST state, in Spanish and English: who is responsible (company name or
  "Guidesk") and how to contact them; what data hosts give (account, workspace, team, properties, guide
  content, uploads, stays, extras, payout setup at the provider) and what guests give (guide visits,
  chat messages, add-on requests, first name when the host enters it), and why; that Guidesk does not ask
  guests for contact data; the data classes and retention from the security architecture; the
  subprocessors listed in User Story 2; where data is stored (United States); that the AI provider
  receives only what an answer needs and never door codes or other locked values; the cookies (session,
  language) and the absence of analytics and advertising cookies; people's rights and the 30-day answer;
  children (not directed to children); international transfers; changes; and the last-updated date.
- **FR-007**: The terms MUST state, in Spanish and English: the service and who may use it; accounts,
  roles, and the owner's responsibility for their team; acceptable use (no unlawful content, no misuse of
  guests' data, no circumventing platform rules, no attacks on the service); the host's responsibility
  for the guide's accuracy and for the extras they offer and deliver; that the assistant can make mistakes,
  follows the host's settings, and hands sensitive topics to the host; that guests are not charged by
  Guidesk except through the provider for extras they choose; platform fees per plan and payouts through
  the provider; the free pilot and that paid plans will be announced before they apply; suspension and
  termination; disclaimers and liability limits; changes with notice; and the governing law and courts
  of Costa Rica.
- **FR-008**: Both legal pages MUST show their last-updated date in the reader's language and have a
  stable address per language.
- **FR-009**: The sign-in screen and the invitation screen MUST show that continuing accepts the terms
  and the privacy policy, with links that open the documents in the same language.
- **FR-010**: The guest guide MUST show a privacy link on its home and in the chat panel that opens the
  privacy policy on the portal domain in the guide's language. The guide MUST stay not indexed.

**Search basics and the installed app**

- **FR-011**: Each public page MUST have its own title and description per language and declare its
  other-language version.
- **FR-012**: A robots file on the portal domain MUST allow only the public pages and disallow every
  other path; a sitemap MUST list only the public pages in both languages.
- **FR-013**: The installed portal app MUST open the signed-in start page; signed-out people reach
  sign-in from there.

**Quality of the public pages**

- **FR-014**: The public pages MUST stay within the portal's budgets (150 KB of JavaScript per route;
  LCP ≤ 2.5 s, CLS ≤ 0.1, and an accessibility score of at least 0.95 in the lab), MUST be added to the
  CI size and lab checks, and MUST meet WCAG 2.2 AA.
- **FR-015**: The public pages MUST load nothing from other origins (no third-party scripts, fonts,
  images, or trackers) and MUST keep the portal's existing security headers.
- **FR-016**: Every text on the public pages MUST exist in Spanish and English and pass the catalog
  parity check; the pages MUST follow the brand guide (colors, type, tone).
- **FR-017**: The contact address and company name MUST come from optional stage settings, be shown as
  plain text, and production MUST refuse to deploy without the contact address.

**Demo workspace**

- **FR-018**: The founder MUST be able to run one command with an account's email that creates a demo
  workspace with that account as its only owner. The command MUST refuse an email with no account or an
  unverified account, and MUST refuse to run on the production stage, before writing anything.
- **FR-019**: The demo workspace MUST carry a demo mark, be on the Pro plan, be named "Demo · Guidesk"
  (numbered on later runs for the same account), and look created about 75 days before the run.
- **FR-020**: The demo MUST contain two ready properties in Costa Rica with complete facts and their
  time zone: a beach house in Santa Teresa (Puntarenas) for 6 guests and an apartment in Escazú (San
  José) for 3 guests.
- **FR-021**: Each property MUST have a published guide in Spanish and English with the default sections
  filled (arrival, Wi-Fi, house rules, amenities, checkout, local tips, emergencies), a door code stored
  as a locked value that only guests with a valid stay link see, a public Wi-Fi password, and a property
  link.
- **FR-022**: Each property MUST have a past stay, a current stay active at the end of the run in the
  property's time zone, and an upcoming stay, with fictional guest first names and no contact details;
  the current and upcoming stays MUST have stay links created the same way the product creates them.
- **FR-023**: The demo MUST contain an extras catalog (airport pickup USD 85, extra cleaning USD 35,
  surfboard rental USD 15 a day) and requests in the pending, confirmed, and declined states; no
  payments.
- **FR-024**: The demo MUST contain assistant settings with automatic answers for Wi-Fi and check-in
  topics, Explore turned on, guest conversations answered by the assistant, one open escalation with the
  reason "malfunction", and at least one unanswered question.
- **FR-025**: The demo MUST contain about 60 days of history per property, with day-to-day variation, so
  every Analytics block for the last 7 and 30 days shows values and a comparison (the 90-day view shows
  values without a comparison): guide opens
  (property and stay links), stays whose guest opened the guide, guest questions with topics, automated
  answers, escalations by at least four reasons, unanswered questions, Explore opens, partner clicks for
  Viator and Civitatis, and add-on requests by state. Monthly AI-reply usage MUST stay under the Pro
  limit.
- **FR-026**: The run MUST NOT call the AI model, the payment provider, PMS providers, or partner APIs,
  and MUST NOT send emails or push alerts.
- **FR-027**: The run MUST be all-or-nothing: on any failure, no demo workspace or partial data remains.
- **FR-028**: The run MUST record one security event with the demo workspace and the owner account, and
  MUST print the workspace name, the two public guide links, and how to copy the current stay link from
  the portal. Its output MUST NOT contain door codes or stay links.
- **FR-029**: The founder's pilot report MUST leave demo workspaces out of every metric, and leave out
  accounts whose only workspaces are demo workspaces.
- **FR-030**: The command MUST work locally and on staging, where it runs with the same permission to
  encrypt locked values and stay links that the product's services have; the quickstart MUST explain how
  to run it on staging.

### Key Entities *(include if feature involves data)*

- **Public page**: the home, privacy policy, or terms page in one language; has a title, a description,
  a stable address, an other-language version, and (legal pages) a last-updated date.
- **Stage settings for the public pages**: the contact address (required in production) and the company
  name (optional); also the stage name, so tools can tell production apart.
- **Demo mark**: a flag on a workspace that says it holds synthetic data; demo workspaces are left out of
  the pilot report.
- **Demo run**: one execution of the demo command; produces one demo workspace and one security event.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor reaches the sign-up screen from the domain root in at most two taps,
  in their browser's language.
- **SC-002**: The home, privacy, and terms pages each load at most 150 KB of JavaScript and meet LCP ≤
  2.5 s, CLS ≤ 0.1, and an accessibility score of at least 0.95 in the CI lab checks, in both languages.
- **SC-003**: 100% of the public pages' texts exist in both languages (catalog parity passes).
- **SC-004**: The privacy policy names every subprocessor the deployed product uses and the retention
  of every data class, matching the security architecture document on the day of the check.
- **SC-005**: The founder goes from a stage with one signed-up account to a complete demo in under 5
  minutes with one command.
- **SC-006**: In the demo, every Analytics block for the last 30 days shows a value and a comparison with
  the previous 30 days.
- **SC-007**: A demo run makes zero calls to the AI model and partner APIs, and sends zero emails and push
  alerts.
- **SC-008**: Running the demo command does not change any number in the pilot report.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

The public pages touch the sign-in screen's content; the demo command writes restricted data (door
codes, stay links) and tenant data outside the API.

### Threats (STRIDE)

- **E (elevation)**: Someone runs the demo command against production to plant data in a real stage, or
  in a real person's account, or to distort the pilot metrics.
- **I (information disclosure)**: The demo command prints or logs a door code or a stay link, which on
  staging land in the cloud logs.
- **I**: The robots file or sitemap reveals portal paths, guide links, or stay links to crawlers.
- **T (tampering)**: A configured contact address or company name containing markup changes what the
  public pages show.
- **I**: A public page loads a third-party script or font that tracks visitors.
- **R (repudiation)**: A demo workspace appears with no trace of who created it or when.
- **D (denial of service)**: A failed run leaves a half-built workspace that breaks screens or reports.

### Controls Applied

- **SEC-06**: The demo's door codes and stay links go through the same field-level encryption the
  product uses, under the demo workspace's data key; nothing is stored or printed in plain text.
- **SEC-11**: The public pages keep the nonce-based CSP and the other security headers; no new origins.
- **SEC-14**: All demo rows carry the demo workspace's ID, so RLS keeps them inside it.
- **SEC-15**: The command is a founder tool that runs with the migration or service role where those
  run, never from the portal or the API's HTTP surface, and refuses the production stage.
- **SEC-16**: Each run writes one append-only security event.
- **SEC-20**: The privacy policy documents minimization, retention, and rights; the public pages set no
  analytics or advertising cookies.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given the production stage, when the demo command runs, then it refuses before writing
  anything and exits with an error.
- **AC-SEC-002**: Given an email with no account, or with an unverified account, when the demo command
  runs, then it refuses and writes nothing.
- **AC-SEC-003**: Given a successful run, when its output and the application logs are searched, then
  neither contains the door code or any stay link token, and the stored door code and stay link tokens
  are ciphertext.
- **AC-SEC-004**: Given demo workspaces exist, when the pilot report runs, then its numbers equal those
  of the same database without the demo workspaces.
- **AC-SEC-005**: Given the robots file and the sitemap, when they are read, then they list only the
  public pages and contain no portal screen, API path, guide link, or stay link.
- **AC-SEC-006**: Given the public pages, when they load, then no request leaves the portal's origin.
- **AC-SEC-007**: Given a contact address or company name containing markup, when the pages render it,
  then the markup shows as text.
- **AC-SEC-008**: Given a failure midway through a demo run, when the run ends, then no demo workspace
  or partial data remains.

### Platform Policies

- **PC-01, PC-02**: The demo guides deliver arrival information that hosts would also send through the
  platform; nothing in them requires opening the guide or an account.
- **PC-06, PC-08, PC-09**: The demo's extras are optional, priced by the host, and never a deposit; no
  demo text moves a booking or its payment off the platform.
- **PC-07**: Explore keeps its commission disclosure in the demo.
- **PC-12**: The home page describes the copilot as copy-and-paste; Guidesk does not read or send
  platform messages on its own.
- **Trademarks**: Airbnb, Booking.com, and Vrbo are named only to describe where hosts' guests come from,
  with no logos and no claim of partnership.

## Assumptions

- The legal texts are drafts for the legal review (OQ-35); the lawyer may change them, and the founder
  publishes the production domain after the review. Costa Rica as governing law follows the expected
  legal entity (OQ-01).
- Pro and Business prices stay "to be announced" until the pilot decides them (OQ-10).
- Guidesk uses only functional cookies today (portal session, language, guest session), so no consent
  banner is needed; adding analytics later would need a new decision.
- The founder can run one-off commands on staging with the API's permissions; how migrations run there
  (a one-off task) is the same mechanism.
- The demo's synthetic content is written by hand in the repository; no AI generates it at run time.
- Demo workspaces stay until a later feature deletes them; staging is the expected place to run the
  command.
- Showing online payments in the demo is out of scope: payments stay off on AWS stages until the founder
  decides otherwise.
