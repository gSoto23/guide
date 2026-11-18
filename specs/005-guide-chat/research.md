# Research: In-Guide AI Chat

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-18

Each entry gives the decision, the rationale, and the alternatives considered. This feature builds
on spec 003 (published versions, `LlmPort`, the Anthropic adapter with the refusal fallback and
prompt caching, eval harness, the restricted-value detector) and spec 004 (guest app, guest routes,
guest context, stay sessions, per-IP limits).

## R1. Modules

- **Decision:**
  - **Domain (`packages/domain/src/agent/`):** escalation categories and the policy decision, the
    knowledge renderer (published snapshot → deterministic text with section IDs, locked fields as
    labels), output checks, holding-reply selection, suggested questions, and the conversation status
    rules. Pure TypeScript.
  - **`LlmPort`** gains `classifyGuestMessage` and `answerGuest` (structured outputs) with prompts and
    schemas in `packages/integrations/src/llm/agent/`, the Anthropic adapter, and a deterministic fake.
  - **API:** `chat` module (guest routes under `/api/v1/guest/chat`) and `conversations` module (member
    routes and assistant settings).
  - **Worker:** job `chat.reply` (the pipeline) and job `agent.cost-check` (daily); new retention rules.
  - **Guest app:** a chat script loaded on demand and an Ask entry on every page.
  - **Portal:** conversation list and page per property, and assistant settings.
  - **Evals:** a new package `evals/agent` with golden conversations.
- **Rationale:** the layering of specs 002 to 004 (constitution IV). ADR-0005 names a
  `ContextAssembler`; it lives in the domain package as the knowledge renderer rather than a new
  `packages/agent`, because it has no I/O and the domain already holds the snapshot types.
- **Alternatives:** a separate `packages/agent` was rejected for now (one more package for a few pure
  functions); it can be split out when tools and retrieval arrive.

## R2. The pipeline runs in the worker

- **Decision:** the guest's message is stored by the API, which answers at once with the stored message
  and enqueues `chat.reply` (one job per conversation at a time: pg-boss `singletonKey` per
  conversation, queue policy `stately`). The worker runs classification, the policy decision, the
  answer, output checks, and writes the reply or holding reply, the draft, the trace, and the usage. The
  chat polls for new messages (every 1.5 seconds while a reply is pending, every 5 seconds otherwise
  while open). The worker polls the queue every 500 ms for this queue.
- **Rationale:** model calls take seconds and can fail; the worker already retries, records spans, and
  keeps the API's request time low (NFR-19). Polling works through CloudFront and the guest app without
  long-lived connections, and the reply is shown whole anyway (spec clarification).
- **Alternatives:** running the model in the API request (simpler, but ties a request to a 10-second
  call and loses retries); server-sent events (no gain while replies are shown whole).

## R3. Two model calls: classification, then the answer

- **Decision:**
  - **Classification** (`classifyGuestMessage`): input is the last 6 messages of the conversation and
    the guest's new message, never the guide. Structured output: `language` (BCP 47), `topic` (the
    guide's section kinds plus `greeting` and `other`), `escalation` (`none`, `emergency`,
    `malfunction`, `complaint`, `money`, `reservation_change`, `legal`, `sensitive_request`),
    `sentiment` (`positive`, `neutral`, `negative`, `very_negative`), and `injection` (boolean). Low
    effort, 5-second deadline.
  - **Answer** (`answerGuest`): input is the cached knowledge prefix (R4), the conversation, and the
    guest language. Structured output: `answer` (text), `sectionIds` (the sections used), `answerable`
    (boolean), `needsHost` (boolean, for "the host should confirm"). Low effort, 10-second deadline.
  - Both use Claude Opus 5.5 under ADR-0005 with the server-side refusal fallback
    (`server-side-fallback-2026-07-01`, `fallbacks: "default"`); a refusal or invalid output counts as
    "not confident".
- **Rationale:** classification alone decides escalations without reading the guide, so emergencies
  never wait for a long call; the answer call carries the guide in a cached prefix. Structured outputs
  make section citations checkable.
- **Alternatives:** one call returning both (one round trip, but escalations would depend on the larger
  call and its cache); tool use (no tools are needed in this feature).

## R4. Knowledge: the published version, rendered deterministically and cached

- **Decision:** the knowledge renderer turns the published snapshot (spec 003) into text: one block per
  visible section, in order, headed `[section <id>] <title>`, each item's document as plain text in the
  guest's language with the source language as fallback, core facts (check-in and checkout times,
  maximum guests, address), recommendations with their benefit note, and each locked field as
  `«<label>: shown to verified guests in the guide»`. It has no timestamps and sorts nothing that the
  snapshot already orders. The system prompt and the knowledge are sent with `cache_control`, in the
  order tools (none) → system rules → knowledge → conversation.
- **Rationale:** ADR-0005 stage 1 (full context with caching). Locked values are never in the snapshot
  (spec 003 FR-052), and the renderer never calls the reveal service, so the model cannot see a code
  (SEC-06, SC-007).
- **Alternatives:** retrieval over chunks (ADR-0005 stage 2, for guides that outgrow the context).

## R5. The policy decision

- **Decision:** a pure function decides from the classification, the autonomy, and the limits:
  1. Over a limit → pause message (device) or holding reply with reason `limit` (budget).
  2. `escalation` other than `none` and `sensitive_request` → holding reply (with the emergency card
     first for `emergency`), status `needs_host` with the reason, no draft.
  3. `sentiment = very_negative` → treated as `complaint`.
  4. `sensitive_request` → a fixed pointer reply to the section that holds the matching locked field
     (Arrival for codes, Wi-Fi for the Wi-Fi password), no model answer, no escalation; with
     `injection` true it also records the attempt.
  5. `topic = greeting` with no question → a fixed greeting with suggested questions.
  6. Otherwise → answer call; if `answerable` is false or `needsHost` is true → holding reply and a
     draft (the model's text) for the host with reason `not_confident`; with autonomy `draft` → holding
     reply and a draft (`draft_ready`); with `auto` → output checks (R6), then the answer or, on failure,
     a draft with the failed check (`check_failed`).
- **Rationale:** PRD §6.2 verbatim, with the mandatory categories decided before any answer is written.
- **Alternatives:** asking the model to decide whether to escalate in the answer call (the decision
  would depend on the model's judgment of a long prompt).

## R6. Output checks

- **Decision:** a pure function checks a candidate answer against the knowledge:
  - **Citation:** at least one `sectionId`, each in the published snapshot.
  - **Codes:** no sequence the restricted-value detector (spec 002/003) flags as code-like unless the same
    sequence appears in the knowledge text (times, prices, and phone numbers from the guide pass).
  - **Links:** every URL must appear in the knowledge text or point to the guide origin.
  - **Promises:** no refund, discount, compensation, date-change, or rule-exception promise (phrase list
    in Spanish and English, folded like the off-platform check).
  - **Off-platform:** feature 003's `asksOffPlatform` (PC-06).
  Member replies run the same checks as warnings (PC-14); a member can override them for their own text.
- **Rationale:** FR-020 and AC-SEC-008. Deterministic checks are testable and cheap.
- **Alternatives:** a second model call to judge the answer (cost and latency for a weaker guarantee).

## R7. Guest chat identity and routes

- **Decision:** the chat cookie `__Host-guidesk_chat` (`guidesk_chat` on plain-HTTP local runs): 32
  random bytes, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, set by the first `POST
  /api/v1/guest/chat/messages`; only its SHA-256 hash is stored. A conversation is the pair (cookie hash,
  property). When the request also carries a working stay session (spec 004) for the property, the
  conversation's stay is set (and updated to the latest stay). Routes: `GET /api/v1/guest/chat?publicId=
  &after=` (intro data and messages after a cursor) and `POST /api/v1/guest/chat/messages` (`{publicId,
  text, language, clientId}`; `clientId` makes retries idempotent). Both `no-store`, both behind the
  guest interceptor (per-IP limits, `noindex`).
- **Rationale:** FR-004 and PC-03 with no identifier beyond a random cookie; the same pattern as spec
  004's stay session.
- **Alternatives:** keeping the conversation in `localStorage` with a bearer header (readable by
  scripts).

## R8. Limits and budgets

- **Decision:** per device, 20 messages per 10 minutes (`chat:device:{hash}` in the PostgreSQL rate
  limiter); per property and per workspace, daily counters in `chat_usage_daily` (assistant replies and
  drafts, and their cost), checked by the API before enqueueing and again by the worker before calling the
  model. Defaults on `workspace` (`chat_daily_limit` 1,000, `chat_property_daily_limit` 200), changeable by
  Guidesk. Owners get one email per property per day when a limit is reached (`chat.limit_reached`).
- **Rationale:** SEC-07 and NFR-14 with the existing limiter and no Redis.

## R9. Notifications

- **Decision:** when a conversation moves to `needs_host` and `last_notified_at` is older than 30 minutes,
  the worker sends `chat.needs_host` to every member of the workspace (owners, admins, agents) through the
  existing notices service and outbox, in each recipient's language, with a deep link to the conversation
  page. No guest message text beyond the first 300 characters of the latest one; never a locked value.
- **Rationale:** FR-023, NFR-19 (60 seconds). Push notifications are spec 006.

## R10. The guest chat UI

- **Decision:** an Ask button on every guide page (server-rendered, hidden without scripts) loads
  `chat.<hash>.js` and its styles on first tap (budget 30 KB gzip together). The panel is a dialog with the
  intro, suggested questions, the message list (`aria-live="polite"` announcing complete messages), the
  input with a 2,000-character counter, the typing indicator, and the emergency card. Texts come from the
  page's JSON data block (the `guest` catalog gains a `chat` namespace).
- **Rationale:** spec 004's budget and CSP (no inline scripts); FR-002.

## R11. Member side

- **Decision:** routes under `/api/v1/workspaces/{ws}/properties/{pid}/conversations` (list, detail,
  send draft, reply) with `conversations.handle` (owners, admins, agents), and assistant settings
  (`GET/PUT /api/v1/workspaces/{ws}/assistant-settings` with `workspace.settings`, `GET/PUT
  …/properties/{pid}/assistant-settings` with `properties.manage`). Portal pages: the property's
  conversations and the conversation page (H-21 subset), and an "Assistant" card in property and workspace
  settings. Sending a draft uses an optimistic lock on the draft row (`status = 'open'`).
- **Rationale:** FR-022 to FR-027 with the spec 001 capability matrix.

## R12. Traces, cost, and the cost alert

- **Decision:** `agent_trace` rows per assistant output with the classification, decision, reason,
  autonomy, sections, version, checks, model, tokens (including cache reads and writes), and cost in
  micro-dollars (spec 003's `usageCost`, extended for cache tokens). Members get a projection without
  model, tokens, or cost. `agent.cost-check` runs daily, computes the 7-day average cost per reply, and logs
  an error event (captured by Sentry and the infra alarms) above $0.10.
- **Rationale:** FR-030 to FR-032, constitution III and VIII, NFR-10.

## R13. Evaluation suite

- **Decision:** `evals/agent` with golden cases on two fixed fictional guides (Spanish and English):
  answerable questions (with the expected section), escalation cases for every category, code-seeking and
  injection cases (in guest messages and in guide text), language cases (English, Spanish, Portuguese,
  French), greeting and out-of-scope cases. Scored by deterministic checks (escalation category, section
  cited, language detected, no code or forbidden link, answerable flag). Runs with the fake model locally
  and with the real model in CI when `ANTHROPIC_API_KEY` is set, as in spec 003. Thresholds from SC-003.
- **Rationale:** constitution V and FR-034.

## R14. Retention and data

- **Decision:** `retention.daily` deletes conversations (with messages, drafts, and traces, by cascade) 12
  months after the stay's checkout, or 12 months after the last message without a stay; `chat_usage_daily`
  rows after 13 months. No guest contact data is stored; the cookie only as a hash.
- **Rationale:** FR-033, security data class Confidential (OQ-35 pending).

## R15. Testing

- **Decision:** unit tests for the policy, knowledge renderer, output checks, and fake adapter;
  contract tests for the Anthropic adapter's new calls on recorded fixtures; integration tests for the
  guest chat routes, the `chat.reply` job (every policy branch, limits, notifications, traces), member
  routes and settings (roles, cross-tenant), and a security review test; guest app tests for the chat
  page data; end-to-end tests on the phone viewport for each story with the fake model; axe on the chat and
  the conversation page; a timing test for the job with the fake model plus simulated latency.

## R16. Rollout

- **Decision:** no feature flag for the chat; the model mode follows `LLM_MODE` (fake locally and in
  tests, Anthropic in AWS). Founder gates before the pilot: the agent eval suite against the real model
  (needs the `ANTHROPIC_API_KEY` CI secret), the legal review of intro and holding texts (OQ-35), and the
  quickstart on staging.
- **Local quickstart run (T051, 2026-11-18):** with the fake model on the local stack, scenarios 1 to 6
  pass through `chat-us1` to `chat-us6` (one worker), axe finds no WCAG A/AA violation on the chat, the
  conversation list and page, and the assistant card, and the feature 004 guest specs still pass with
  the Ask button. Monorepo typecheck, lint, and unit tests pass; integration suites pass (API 383 tests,
  worker 146, database 47); the chat loads 3.3 KB gzip of script and styles (budget 30 KB). The agent
  eval suite runs with `EVAL_LLM=fake` (scores not meaningful); the real-model run and the staging items
  above remain open.
- **Implementation notes:** members read traces through column grants rather than a view (same
  protection, one less object); daily budgets are checked by the worker before any model call (the API
  only enforces the device limit), so an over-budget message still gets a holding reply; a per-address
  backstop of 60 messages per 10 minutes covers devices that drop the chat cookie; the intro names the
  host only once the workspace has a chosen name (default names such as "Espacio de Ana" read oddly to
  guests).
