# Screen Inventory

> **Status:** Draft v0.1 (provisional) · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [UX index](README.md) · [Principles and IA](principles-and-ia.md) · [User flows](user-flows.md) · [Design system](design-system.md) · [Wireframes](wireframes.html) · [PRD feature catalog](../product/prd.md#4-feature-catalog-and-prioritization)

Every screen Guidesk needs, by surface. Each row gives the purpose and key content, the primary
actions, the states that need design, the main persona, and the phase. Screens marked ★ have a
low-fidelity wireframe in [wireframes.html](wireframes.html).

**Conventions:**

- **IDs:** `A-` authentication and onboarding, `G-` guest guide, `H-` host portal, `X-` external
  pages Guidesk links to, `B-` internal back-office.
- **States:** E = empty, L = loading, Er = error, O = offline, Lk = locked, Lm = limit (see the
  [state vocabulary](user-flows.md#user-flows)).
- **Personas:** P1 Ana (individual host), P2 Marco (manager) and his team, P3 Emily (guest),
  P4 Luis (provider).
- **Phase:** MVP (pilot at the end of month 3), MVP month 4 (payments), Phase 2, Phase 3, per the
  [roadmap](../product/roadmap.md).

## 1. Authentication and onboarding (host)

Source: [spec 001](../../specs/001-workspace-accounts/spec.md).

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| A-01 | Sign in or sign up | One screen for new and returning users: Google, email, passkey. No password field anywhere. | Continue with Google · Continue with email · Use a passkey | L, Er (cancelled, blocked popup), O | P1, P2 | MVP |
| A-02 | Email code | 6-digit code field (paste and autofill supported), the address it went to, the 10-minute validity | Enter code · Send a new code · Change email | L, Er (wrong, expired, used), Lm (too many tries, resend cooldown), O | P1, P2 | MVP |
| A-03 | Add a passkey | One-time offer after the first sign-in, with a one-line benefit ("Sign in with your face or fingerprint") | Add passkey · Not now | L, Er (device not supported) | P1, P2 | MVP |
| A-04 ★ | Onboarding questions | Up to three questions on one scrollable screen or three short steps: properties (1–2, 3–10, 10+), PMS (list, none, other), country and language. Each skippable. | Continue · Skip | L | P1, P2 | MVP |
| A-05 | Second factor | Required for owners and admins of workspaces with more than 2 properties: passkey or authenticator app, then recovery codes to save | Add passkey · Use an authenticator app · Download codes | Lk (sensitive action blocked until done), Er | P2 | MVP |
| A-06 | Confirm it's you | Step-up re-authentication before revealing codes, integrations, invitations, role changes, deletions (FR-011) | Use passkey · Email code · Authenticator code | Er, Lm | P1, P2 | MVP |
| A-07 | Invitation | Workspace name, inviter, role, and what the role can do | Accept · Sign up with this email | Er (expired, used, revoked), Lk (signed in with another email) | P2 team | MVP |

## 2. Guest guide

Source: PRD F04, F05, F08, F09, F13. All guest screens: no account, no app, Spanish and English,
WCAG 2.2 AA, ≤ 100 KB initial JavaScript.

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| G-01 ★ | Guide home | Property name and photo; stay card (dates, check-in and checkout times) on stay links; quick tiles in template order (Arrival first); Emergency in the top bar; bottom bar Guide · Explore · Extras · Ask | Open a section · Ask · Emergency · Switch language | L (text first, photos later), O (cached copy with "Offline, saved copy"), Er (guide unpublished or link ended, see G-13) | P3 | MVP |
| G-02 | Section page | One template section (Wi-Fi, house rules, appliances, amenities, parking, checkout): text, photos, short videos (poster first), "Ask about this" | Ask about this · Open in Maps or Waze (parking, directions) · Copy (Wi-Fi network) | L, O, E (hidden when empty) | P3 | MVP |
| G-03 | Arrival and access | Directions, step photos (gate, lockbox), and locked fields for codes, each with its lock reason | Show code · Verify · Open in Maps or Waze | Lk (property link, before window, after checkout), O | P3 | MVP |
| G-04 ★ | Verify for access | Short explanation, one code field (method per OQ-20), where to find the code ("in your booking messages"), fallback reminder | Verify | Er (wrong code), Lm (5 tries, 15-minute pause with countdown), O | P3 | MVP |
| G-05 ★ | Access code shown | Code in large digits, copy button, the steps again, "Your host can see when the code was viewed" | Copy · Done | L (button shows "Showing…"), Er (retry and fallback), O (cannot show) | P3 | MVP |
| G-06 ★ | Chat | Intro naming the assistant and the host, suggested questions, messages with "From: section" links, host messages labeled, emergency card, at most one offer card per day | Send · Open section · Call emergency · Request extra | E (suggestions), L (typing indicator, streaming), Er (holding reply, retry), O (input disabled), Lm (length counter, rate pause) | P3 | MVP |
| G-07 ★ | Explore | Host's own tips first (with benefit disclosure when declared), then experiences by category, each card with partner, "from" price, and disclosure. *As built in spec 009: `/g/{publicId}/{lang}/explore`, opened from a tile on the guide home (no bottom bar yet); experiences come from Viator and Guidesk's curated Civitatis list; cards without a partner photo show a category illustration; the disclosure names Guidesk (OQ-08).* | Open tip · Open experience | E (only tips, or tab hidden), L, O (book disabled) | P3 | MVP |
| G-08 | Extras | List of the host's add-ons: name, price, currency, lead time, availability note, disclosure *As built in spec 008: `/g/{publicId}/{lang}/extras`, opened from a tile on the guide home; each extra shows its price or "Free", a short description, and "Offered by your host"; the page says extras are optional and nothing is charged in the guide. `/extras/{id}` shows the rules in plain words and the request form on a stay link; other visitors see how to request instead.* | Open extra · Request | E (tab hidden), Lk (not available on these dates), O | P3 | MVP |
| G-09 ★ | Extra status and checkout start | Request status (waiting, confirmed, not available, paid, refunded); when confirmed: itemized total with taxes and fees, Tilopay note, refund policy line *As built in spec 008 (requests only): the stay’s requests for the extra under the form, with waiting, confirmed (the host arranges payment), not available or cancelled by your host (with the reason), cancelled, and expired, each saying nothing was charged where it applies; Cancel while waiting. Payment is spec 013.* *As built in spec 013: confirmed requests that can be paid online show the total (taxes included by the host, no extra charges) and "Pay"; the provider's page takes the payment; back in the guide the request reads "processing" until the provider confirms it, then "Paid" with the reference, refunds, or a dispute note.* | Pay securely with Tilopay · Cancel request | L, Er (declined with reason), O, Lk (checkout not available: host collects payment) | P3 | MVP (request); MVP month 4 (pay) |
| G-10 | Payment return | "Confirming your payment…" until the server verifies the provider's result, then Paid or Failed | Done · Try again | L (with the 30-second message), Er (failed or cancelled) | P3 | MVP month 4 |
| G-11 | Emergency | Local emergency number (911 in Costa Rica), host's emergency contact, nearest clinic, gas and water shut-off locations if provided; reachable from every screen | Call · Open in Maps | O (works from cache, calls need signal) | P3 | MVP |
| G-12 | Language | Spanish or English, remembered on the device | Choose language | — | P3 | MVP |
| G-13 | Link ended or not found | Friendly page for expired stay links, unpublished guides, mistyped addresses; shows the public guide when possible | Open the public guide | Er | P3 | MVP |
| G-14 | Experience detail | What's included, duration, partner name, full disclosure next to the button. *As built in spec 009: `/explore/{ref}`; "Book on {partner}" opens a new tab through Guidesk's click address; a note says the partner's site confirms the price; offline, the button is disabled with a note.* | Book on the partner site | O | P3 | MVP |
| G-15 | Reservations | Car rental, transfers, restaurants through partners, with disclosure (F14) | Open partner | E, O | P3 | Phase 2 |
| G-16 | Protection offer | Optional insurance from a licensed partner, after booking only, with the partner's terms (F16, PC-09) | View offer · Buy on partner page | Lk (not available in this market) | P3 | Phase 3 |
| G-17 | Book an experience in the guide | In-guide booking through partner booking APIs (F19) | Book · Pay | L, Er | P3 | Phase 3 |

## 3. Host portal

Source: PRD F01–F03, F06–F11, F13; spec 001. Every screen works on a phone (NFR-12).

### 3.1 Home and properties

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| H-01 | Home | Setup checklist until the first guest is served, then today's arrivals, items that need the host, weekly summary | Continue setup · Open inbox · Paste a guest message | E (new workspace: checklist), L | P1, P2 | MVP |
| H-02 | Install and test alerts | How to add Guidesk to the home screen (iPhone steps), allow notifications, send a test alert | Send test alert · I did it · Later | Er (permission denied: steps to fix), Lk (browser without push: email only) | P1, P2 | MVP |
| H-10 | Properties | List with guide status (draft, published), completeness, next stay, source (manual, CSV, PMS) | Add property · Open property | E (start options), L, Lm (plan limit) | P1, P2 | MVP |
| H-11 | Add property | Five ways to start: PMS import, paste text or screenshots, CSV, duplicate, blank; recommended first by path | Choose a start | Lm | P1, P2 | MVP |
| H-12 ★ | Guide draft review | Completeness score and the top missing topics; sections with status (Ready, Needs review, Missing) and source labels; translation status; pre-publish warnings | Fill gaps with the interview · Edit section · Preview as guest · Publish | L (sections filling in), Er (partial draft, retry), Lk (agents read-only) | P1, P2 | MVP |
| H-13 | Section editor | Rich text, images, short videos, shared-block indicator with "Override for this property", "Reset to shared" | Save · Override · Reset | O (kept on device until reconnect), Er | P1, P2 | MVP |
| H-14 | AI interview | One question at a time, text or voice note, live preview of where the answer goes, reminder to keep codes out | Answer · Record voice · Skip question · Finish | L ("Transcribing…"), Er (voice failed: type instead), O | P1 | MVP |
| H-15 | Uploads | Drop or pick PDFs and photos; per-file status (scanning, extracted, rejected) and what was learned | Upload · Remove · Review extracted facts | L, Er (type, size, safety scan) | P1, P2 | MVP |
| H-16 ★ | Share the guide | Three cards: scheduled-message template (ES and EN, property link), printable QR poster (public only), upcoming stays with "Copy stay link"; reminder that the guide is optional | Copy message · Download QR · Copy stay link · Revoke stay link | E (no calendar: connect or add stay), L (sync time), Er (calendar unreadable) | P1, P2 | MVP |
| H-17 | Stays and calendar | iCal URL, last sync, upcoming and past stays, manual stays | Connect calendar · Sync now · Add stay | E, L, Er | P1, P2 | MVP |
| H-18 | Locked fields | Door, lockbox, alarm codes and sensitive Wi-Fi, masked; reveal history (who and when) | Add · Reveal (re-authenticate) · Edit | Lk (agents never; MFA required above the threshold), Er | P1, P2 | MVP |
| H-19 | Translations | Side-by-side Spanish and English per section, machine or reviewed | Accept · Edit · Mark reviewed | L | P1, P2 | MVP |
| H-24 | PMS import | Pick Beds24 or Hostex (Hostaway if OQ-26 allows), paste token with step-by-step help, import progress, per-property results | Connect (re-authenticate) · Re-import · Disconnect | L, Er (invalid token, rate limit, partial import) | P2 | MVP |
| H-25 | CSV import | Template download, upload, per-row validation table, error file | Download template · Upload · Fix and retry | L (500 rows in ≤ 30 s), Er | P2 | MVP |

### 3.2 Conversations and agent

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| H-20 ★ | Inbox | Tabs: Needs you, All, Done. Items show property and stay label, channel, reason chip (Emergency, Malfunction, Draft ready, Extra requested), time. "Paste a guest message" at the top. *As built in spec 006: `/inbox`; reason badges use the conversation reasons (Possible emergency, Draft ready, and so on); "Paste a guest message" opens H-22; trust suggestions appear above the tabs after 5 drafts on a topic were sent unchanged in 30 days; the alerts banner shows when this device could get push alerts but doesn't.* | Open item · Paste a guest message · Filter by property | E ("All caught up"), L, O (read-only), alerts-off banner | P1, P2 team | MVP |
| H-21 | Conversation | Messages; draft card with Approve, Edit, Reject; "Why this reply" (section used, topic, autonomy, checks); escalation banner with reason; Take over switch. *As built in spec 006: the property's conversation page; Reject is "Discard draft"; Take over is the "I'll reply myself" switch; "Mark done" and "Reopen"; the replying indicator comes from a 30-second presence heartbeat while a member types.* | Approve · Edit · Reject · Take over · Reply | L, Er (send failed), O, team indicator ("Marta is replying") | P1, P2 team | MVP |
| H-22 ★ | Copilot | Paste box, property picker, booking status (inquiry or confirmed), draft with check badge or explanation of what changed. *As built in spec 006: `/inbox/copilot`; only properties with a published guide; the result shows "Passed checks" or the failed checks, a note when links or contact details were removed, the sections used, and "Copy reply"; the pasted text stays when anything fails.* | Draft reply · Copy · Draft again | L, Er (kept text), caution banner for sensitive topics | P1 | MVP |
| H-23 | Service request | Extra, date and time, guest note, stay label, price; after payment: order status, receipt reference, refund *As built in spec 008: the Requests screen `/requests` (header link), waiting first and soonest date first, filtered by property and status; each request shows the stay, the guest’s note as plain text, who answered and when; Confirm, Decline with a reason and optional text, and Cancel a confirmed one; every member who handles conversations can answer, first answer wins.* | Confirm · Decline with reason · Refund (re-authenticate) | Er, Lk (agents can view, not refund; to confirm in spec 008 and 013) | P1, P2 | MVP (request); MVP month 4 (pay, refund) |
| H-26 | Agent settings | Autonomy per topic (draft, auto, full auto) with mandatory categories shown locked; tone; quiet hours; escalation contacts; custom instructions. Workspace defaults, per-property overrides. *As built in spec 007: `/settings/assistant` and `/properties/{id}/assistant`; one select per topic; each group on a property has "Use the workspace settings"; the test panel is on the property screen.* | Change autonomy · Save · Test the assistant | Lk (mandatory categories; full auto not on Free) | P1, P2 | MVP |
| H-34 | Analytics | Per property and period: guide views, questions answered automatically, escalations, top and unanswered questions, offer clicks, extra requests *As built in spec 010: `/analytics` (header link) and `/properties/{id}/analytics` (card on the property page); 7, 30, or 90 days with the change against the previous period (one note when there is nothing to compare yet); number cards, bars that are also text, a sortable table per property (first 50, then all), and unanswered questions with a link to each conversation. Analytics for agents too.* | Change period · Open unanswered question | E, L | P1, P2 | MVP |

### 3.3 Extras and content

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| H-27 | Extras catalog | Add-ons with name, description, price, currency, lead time, availability rules, pre-approval, disclosure preview *As built in spec 008: `/properties/{id}/extras` with four suggestions when empty (airport pickup, extra cleaning, groceries before arrival, late checkout), the form with rules (notice, days, what the guest picks, date range, most per stay, pre-approval), order, hide, copy to other properties, and delete; agents see it read-only.* | Add extra · Edit · Hide | E (suggested extras: airport pickup, extra cleaning) | P1, P2 | MVP |
| H-28 | Experiences | Categories shown to guests, pinned host recommendations with the benefit question. *As built in spec 009: `/properties/{id}/explore` and `/settings/explore` (workspace default); follow the default or set categories per property, hide single experiences, and a preview; host tips are the guide's recommendations in guide order (no separate pin list).* | Hide category · Pin recommendation | E | P1, P2 | MVP |
| H-29 | Shared content | Workspace-level blocks (policies, emergency contacts, checkout steps, area tips) and which properties inherit or override them | Add block · Edit (updates inheriting properties) | E | P2 | MVP |
| H-33 | Payouts | Tilopay merchant onboarding status (identity and bank checks happen at Tilopay), fees once known (OQ-37) *As built in spec 013 with a simulated provider: `/settings/payouts`; whether guests can pay online, the payout account state (not set up, under review, active, not approved) with "Set up payouts" for the owner, the platform fee (plan or agreed), how fees work, and this month's totals by currency. Requests shows each payment, its fees, "refund due", and refunds for owners and admins with re-authentication.* | Start onboarding · Check status | L, Er, Lk (country not covered) | P1, P2 | MVP month 4 |

### 3.4 Workspace and account

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| H-30 ★ | Workspace switcher | Bottom sheet listing workspaces with role badges, current one checked | Switch · Create workspace | L (under 2 s), O | P2 team | MVP |
| H-31 | Members | Members with roles, pending invitations, invite form with role descriptions | Invite (re-authenticate) · Change role · Remove · Resend · Revoke | Lm (seat limit), Er | P2 | MVP |
| H-32 | Plan and limits | Current plan, usage against limits (properties, AI replies, seats) *As built in spec 011: `/settings/plan` for owners and admins (agents see a note); the plan, each limit as text with a bar that repeats it ("unlimited" when there is none), custom limits marked, the pooled AI allowance and its renewal in the member's time zone, what counts as an AI reply, the workspace ID, and the contact address; a banner on every page at 80% and 100% of the month's AI replies; property and seat refusals link here.* | Contact us (pilot) | Lm | P1, P2 | MVP (limits) |
| H-35 | Security log | Sign-ins, factor changes, invitations, role changes, code reveals by guests and hosts | Filter · Export | E, L | P1, P2 | MVP |
| H-36 | My account | Name, email, language, sign-in methods and passkeys, authenticator, recovery codes, sessions with revoke, notification settings, data export, delete account | Add passkey · Revoke session · Export data · Delete account | Lk (delete blocked while owning a workspace with members) | P1, P2 | MVP |
| H-37 | Workspace settings | Name, default language, transfer ownership, delete workspace (type the name, 30-day restore) | Rename · Transfer · Delete | Lk (owner only) | P1, P2 | MVP |

### 3.5 Later phases

| ID | Screen | Purpose and key content | Primary actions | States | Persona | Phase |
|---|---|---|---|---|---|---|
| H-40 | Connect your PMS (messaging) | Guided wizard: OAuth where available, otherwise API key with help; what the agent will do in platform chats | Connect · Choose autonomy · Test | L, Er | P2 | Phase 2 |
| H-41 | Unified inbox | H-20 with platform chats (Airbnb, Booking.com, Vrbo) alongside the guide chat; send windows shown (PC-13) | Same as H-20 | Lk (outside the send window) | P2 | Phase 2 |
| H-42 | Subscription and billing | Plans, payment method, invoices | Upgrade · Change plan | Er | P1, P2 | Phase 2 |
| H-43 | Groups and permissions | Property groups, per-property access, owner read-only access | Create group · Grant access | E | P2 | Phase 2 |
| H-44 | Connectivity without a PMS | White-label connection setup, with the platform fee impact explained before connecting | Connect · Learn about fees | Lk | P1 | Phase 3 |
| H-45 | API and webhooks | Keys, webhooks, usage | Create key · Add webhook | E | P2 | Phase 3 |
| P-01 | Provider portal | Local providers list their services for hosts in their area (F18) | List a service | E | P4 | Phase 3 |
| B-01 | Back-office | Support, partners, moderation, agent trace viewer, consented support access (F15, SEC-15) | Search workspace · Open trace | Lk (MFA, time-boxed access) | Internal | Phase 2 (minimal in MVP) |

## 4. External pages

| ID | Page | Owned by | Notes |
|---|---|---|---|
| X-01 | Tilopay hosted payment page | Tilopay | Card data entered only here (SEC-21). Guidesk controls the return address and the order summary it sends, not the page. |
| X-02 | Partner experience pages | Viator, Civitatis, GetYourGuide | Opened in a new tab, with no referrer (SEC-02). |
| X-03 | OTA scheduled messages | Airbnb, Booking.com, Vrbo | The host pastes Guidesk's template there; Guidesk never automates it (PC-12). |

## 5. Shared overlays and system screens

| ID | Element | Used in | Notes |
|---|---|---|---|
| S-01 | Offline banner | Guide and portal | Says what works offline and what does not. |
| S-02 | Toast | Portal | Confirmations ("Draft sent", "Switched workspace"); never the only place an error appears. |
| S-03 | Bottom sheet | Both | Short choices in thumb reach; full-height on small screens; closes with Esc and back. |
| S-04 | Confirm dialog | Portal | Destructive actions name the object ("Delete Casa Colibrí's guide?"). |
| S-05 | Disclosure explainer | Guide | Opened from any disclosure: what the commission is, who gets it, and that buying is optional. |
| S-06 | Install prompt | Guide (optional), portal (checklist) | The guide never asks guests to install (PC-02); the browser's own install option is enough. |
