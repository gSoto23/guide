# Research: Host Inbox and Reply Copilot

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-18

Decisions for spec 006, building on specs 005 and 007.

## R1. Inbox query and tabs

- **Decision:** one API route lists the workspace's conversations for a tab:
  - `needs`: `status = needs_host`, ordered by emergency first, then `last_message_at` descending.
  - `all`: `status <> done`, by `last_message_at` descending.
  - `done`: `status = done`, by `done_at` descending.
  Optional `propertyId`; keyset pagination on (`last_message_at`, `id`) or (`done_at`, `id`), 50 per
  page. Each item joins the property name, the stay dates, the latest message (lateral subquery on
  `chat_message_seq_uq`), who took it over, and who is replying. The portal polls every 15 seconds while
  the page is visible.
- **Rationale:** FR-001, SC-001 with existing indexes (`conversation_property_status_idx`) plus a new
  `(workspace_id, status, last_message_at)` index.
- **Alternatives:** server-sent events (a new long-lived connection type for little gain at pilot scale).

## R2. Done and reopening

- **Decision:** `conversation.status` gains `done`, with `done_at` and `done_by`. Members who handle
  conversations mark done or move back (to `open`). The guest message route sets a done conversation to
  `open` (clearing `done_at`) in the same transaction that stores the message; the reply job then decides
  as usual.
- **Rationale:** FR-003; reopening at the moment the guest writes keeps the inbox right even when the
  reply job is slow.

## R3. Rejecting a draft

- **Decision:** `POST …/drafts/{id}/reject` sets the open draft to `discarded` (an existing status) with
  the same first-wins guard as sending (`status = open` in the update). The conversation keeps its status.
- **Rationale:** FR-005; reuses spec 005's states and race handling.

## R4. Taking over

- **Decision:** `conversation.taken_over_by` and `taken_over_at`; `PUT …/takeover {on}`. The reply job,
  when the conversation is taken over:
  1. Budget check, then classification only (no answer call, no settings).
  2. `emergency` → the emergency card and the emergency holding reply, status `needs_host` with reason
     `emergency`, alerts to the contacts plus owners and admins (spec 007 rules).
  3. Anything else → no message, status `needs_host` with the new reason `taken_over`, alert to the member
     who took over (the contacts when they left the workspace), under quiet hours.
  4. Over budget or classification failure → like 3 (no card can be shown without a classification).
  The trace records decision `held` with the reason. The guest chat's `pending` is false while taken over,
  so no typing indicator shows. Handing back clears both columns; the next guest message runs the normal
  pipeline. Taking over and handing back are security log events.
- **Rationale:** FR-006, FR-007, AC-SEC-007: emergencies stay protected even while a human handles the
  conversation.
- **Alternatives:** pausing the assistant entirely (emergency cards lost); a holding reply on take over
  (unnecessary text; the host is replying).

## R5. Copilot pipeline

- **Decision:** `POST …/properties/{pid}/copilot {message (≤ 4,000), bookingStatus}` stores a
  `copilot_run` and enqueues `copilot.draft`; the portal polls the result every second for up to 20
  seconds (like spec 007's tests). The worker:
  1. Loads the property context and the applied settings (tone, instructions).
  2. Budget check → `limited` (no model call).
  3. Classification of the pasted text (as the guest's message, no history).
  4. `emergency` → a fixed host-voice draft with the emergency number from the guide; caution
     `emergency`.
  5. `sensitive_request` → a fixed host-voice draft: for a confirmed booking it points to the guide's
     section and the stay message; for an inquiry it says access details are shared after booking;
     caution `codes`. No model answer.
  6. Otherwise → the answer call with the knowledge rendered from the published snapshot **without
     recommendations that declare a benefit** (PC-10), the tone and instructions, and a channel line
     ("the host will paste this into the booking platform's chat; write as the host; booking status:
     inquiry or confirmed"). Escalation categories set the caution (money, reservation change, complaint,
     malfunction, legal).
  7. Output checks of spec 005/007 per kind (citation for grounded answers, codes, links, promises,
     off-platform, price, clarify). For an inquiry, `removeContactDetails` strips links, email addresses,
     and phone numbers first and records what was removed (PC-05).
  8. The result: text, sections, checks, removed items, caution, topic, kind, whether the guide covered
     it; `passed` when every check passed and the guide covered it. A trace with `copilot_run_id`,
     decision `drafted`; usage counted. Limit 60 per member per hour.
- **Rationale:** FR-009 to FR-014; one pipeline shape shared with the assistant keeps policy in one place.
- **Alternatives:** a separate copilot prompt (two prompts to evaluate and keep in sync); sending
  benefit recommendations with a disclosure line (PC-10 risk in OTA threads).

## R6. Host voice and booking status in the answer call

- **Decision:** `AnswerGuestInput` gains `channel` (`guide_chat` default, `platform`) and `bookingStatus`.
  The system prompt (static, cached) gains one rule: when the channel is `platform`, write as the host in
  first person for the booking platform's chat, never mention the guide chat, and for an inquiry include
  no link or contact detail. The channel and booking status go in the user prompt, after the message, so
  the cached prefix is shared with the guide chat.
- **Rationale:** cache reuse (ADR-0005) and one schema; the deterministic removal (R5.7) backs the rule.

## R7. Web push

- **Decision:** the standard Web Push protocol with VAPID (`web-push` 4.0.0, MPL-2.0, published 2026-11-06,
  no install scripts) behind a new `PushPort` in `packages/integrations` with a fake adapter. Keys come
  from `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (the portal URL); without them push is
  disabled and the API reports it. The portal registers a service worker (`/sw.js`) that shows
  notifications and opens their link on click, and a web app manifest so iPhones can add the portal to
  the home screen (ADR-0006). The CSP gains `worker-src 'self'` and `manifest-src 'self'`.
  Delivery: the reply job and the quiet hours digest enqueue `notification.push` jobs with IDs only
  (user, kind, conversation or property, reason); the job renders the text in the user's language,
  sends to each of the user's subscriptions with a 24-hour TTL and `urgency: high` for emergencies, and
  deletes subscriptions answered with 404 or 410.
- **Rationale:** FR-015 to FR-018, SEC-20 (payload is title, short body, link; encrypted end to end by
  the protocol).
- **Alternatives:** a push vendor (OneSignal and similar: another processor with guest-adjacent data);
  implementing RFC 8291 encryption by hand (security-sensitive code with no gain).

## R8. Presence

- **Decision:** `conversation_presence (conversation_id, user_id, workspace_id, expires_at)`. The portal
  posts a heartbeat every 10 seconds while the member types in the reply box or edits a draft
  (`expires_at = now() + 30 s`); reads return unexpired rows of other members with their names.
  Retention deletes expired rows daily.
- **Rationale:** FR-019 with no new infrastructure.

## R9. Trust suggestion

- **Decision:** on inbox load, count `agent_draft` rows with status `sent` (sent unchanged, spec 005)
  whose trace had autonomy `draft`, per property and classified topic, in the last 30 days; keep those
  with 5 or more where the effective level for that topic (spec 007 resolver) is still `draft` and no
  `assistant_suggestion_dismissal` is active. The suggestion links to the property's settings when the
  property sets its own autonomy, otherwise to the workspace's. Dismissal lasts 30 days.
- **Rationale:** FR-020 without changing settings automatically (spec 007 keeps changes with owners and
  admins).

## R10. Alerts for take over and the email reason

- **Decision:** the needs-host reason list gains `taken_over` (email, push, inbox chip, i18n). Recipients
  for `taken_over`: the member who took over if still a member who handles conversations, otherwise the
  spec 007 contacts.
- **Rationale:** FR-007.

## R11. Evaluation

- **Decision:** `evals/agent` gains copilot cases (channel `platform`): a confirmed-booking house rules
  question, an inquiry asking for the website (no link after removal), a benefit recommendation never
  named, and a code request answered without the code.
- **Rationale:** constitution V; the answer prompt changed.

## R12. Founder gates and implementation notes

- **Gates:** VAPID keys for staging and production (secrets), the real-model eval run, the legal review
  (OQ-35) of the copilot's fixed texts and the push texts, and the staging quickstart with a real phone
  (Android and an iPhone home-screen app).
- **Notes (implementation, 2026-11-18):**
  - `web-push` is MPL-2.0, not MIT as first noted: file-level copyleft that applies only to changes to its
    own files; we use it unmodified as a dependency, so nothing changes for our code. It ships no types,
    so `packages/integrations/src/push/web-push.d.ts` declares the two functions we call. Its
    `sendNotification` makes its own HTTPS request, so the adapter calls `generateRequestDetails` and
    sends with `fetch` (one HTTP client, timeouts, and tests against a local endpoint). Endpoints that
    answer 404 or 410 delete the subscription.
  - Done and reopen stay consistent in the database: a member's reply and the worker's "needs the host"
    update clear `done_at` and `done_by` (the `conversation_done_consistent` check).
  - The guest's `pending` flag is computed per request, so a taken-over conversation shows no typing
    indicator.
  - Members with an empty name show their email in presence, "taken over by", and contact lists.
  - The "I'll reply myself" switch updates at once and the reload fills in who took it over and when.
  - Retention: copilot requests and their traces after 30 days; presence rows an hour after they expire.
  - Timings (local, Testcontainers): the inbox route with 1,000 conversations answers every tab and the
    property filter at p95 13 to 73 ms (`apps/api/test/integration/inbox.perf.test.ts`; target 1 s);
    the copilot job finishes within 15 s even with 3-second model calls.
  - Evals: 16 copilot cases in `evals/agent/cases/copilot.json` (8 drafts from the guide in the host's
    voice, target ≥ 95%; 8 safety cases for codes, emergencies, inquiries, money, and benefit
    recommendations, target 100%). The runner was checked with the fake model; the real-model run is
    the founder gate above.
  - Infrastructure: `VapidPublicKey` and `VapidPrivateKey` are SST secrets passed to the API and the
    worker through Secrets Manager; `VAPID_SUBJECT` is the portal URL. Deploys need both secrets set
    for the stage (`npx web-push generate-vapid-keys`, then `pnpm sst secret set`).
  - Local quickstart (2026-11-18, fake model): scenarios 1 to 6 ran as `e2e/specs/inbox-us1.spec.ts`
    to `inbox-us6.spec.ts` and passed, together with the full end-to-end suite and the accessibility
    checks (`e2e/specs/a11y.spec.ts`, feature 006 test). The real phone checks (Android and an iPhone
    home-screen app) remain for staging.
