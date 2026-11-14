# 0005. LLM provider and agent design

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder (the architect proposed the design; the founder accepted it on 2026-11-13)
- **Amended:** 2026-11-14. The knowledge strategy now includes a staged hybrid (core facts in
  context plus pgvector retrieval) with explicit switch triggers, a cost model, and retrieval
  security rules. Approved by the founder.
- **Related:** [Architecture overview](../overview.md) · [PRD §6 Agent behavior](../../product/prd.md#6-agent-behavior-requirements) · [Business model §4](../../product/business-model.md#4-unit-economics-illustrative) · [Constitution III & V](../../../.specify/memory/constitution.md)

## Context and problem statement

The Guidesk agent answers guest questions about a specific property, decides whether it may
reply or must escalate, and suggests services. Its errors hurt hosts' reviews, and inference is
the largest variable cost. We need to choose an LLM provider and model, a way to give the model
property knowledge, and the guardrails around it.

## Decision drivers

- Answer accuracy and instruction-following, in Spanish and English.
- Reliable tool use and structured outputs for classification.
- Resistance to prompt injection from guest messages.
- Cost per reply, given sparse, bursty guest conversations, and how that cost scales to
  10,000+ properties.
- Tenant isolation and data minimization in every store that holds customer data.
- Simplicity for a solo developer, with the provider swappable later.

## Considered options

- **Provider:** Anthropic Claude; another frontier provider; self-hosted open-weight models.
- **Knowledge strategy:**
  - (a) full property context with prompt caching;
  - (b) retrieval-augmented generation (RAG) with a vector store;
  - (c) fine-tuning;
  - (d) hybrid: core facts always in context, long-tail knowledge retrieved per question.
- **Agent runtime:**
  - our own orchestration on the Messages API;
  - Claude Managed Agents (Anthropic-hosted agent loop and sandbox);
  - the Claude Agent SDK (a coding-agent harness).

## Decision outcome

### Provider and model

- **Anthropic Claude through the official TypeScript SDK (`@anthropic-ai/sdk`)**, wrapped behind
  an internal `LlmPort` so the provider stays swappable.
- **Default model: `claude-opus-5-5`**, the current Claude Opus model.
  - 1M-token context.
  - List price $4 per MTok input and $20 per MTok output; cache reads $0.20 per MTok (as of
    2026-11).
  - Thinking is adaptive and cannot be disabled on this model. Depth is controlled with
    `output_config.effort`, which defaults to `medium` and should be set explicitly per route.
- **Effort per route (initial, tune with evals):**

  | Route | Effort |
  |---|---|
  | Guest chat replies | `low` (chat workloads usually hold quality at low effort) |
  | Classification | `low` |
  | Guide drafting from interviews and documents | `medium` |

- **Cheaper models are not adopted by default.** Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2 / $10)
  and Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 / $0.50) may be introduced per route only if:
  1. the eval suite shows no quality regression on that route, and
  2. the founder approves the cost/quality trade-off.

  Prompt caches are model-scoped, so splitting routes across models reduces cache reuse.
- **Refusals:** always check `stop_reason` before reading the content. Use the API's server-side
  refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) so that a
  declined request is retried on a suitable model.

### Knowledge strategy: full context now (a), staged hybrid at scale (d)

PostgreSQL is always the system of record for property knowledge: structured facts, guide
sections, uploaded documents, and the service catalog. This decision covers only **how that
knowledge reaches the model on each reply**.

A `ContextAssembler` in `packages/agent` builds the knowledge part of every prompt. It has two
strategies, `full` and `hybrid`, selected **per property**. The rest of the pipeline does not
know which strategy ran, so switching never touches the agent, the policy engine, or the
channels.

#### Stage 1 (MVP): full property context with prompt caching

A typical property's knowledge is roughly 5–30k tokens, far below the context window. We render
it into a **deterministic, stable prompt prefix** in this order:

1. tools
2. system rules
3. property knowledge, marked with `cache_control`
4. conversation, after the cache breakpoint

Why full context first:

- **Accuracy.** Guest questions often span several topics. For example, "can I check in early
  and leave my car?" needs check-in, parking, and house rules at once. A retrieval miss produces
  a confident wrong answer.
- **Knowing what is not covered.** When the model sees the whole guide, it can tell that a topic
  is missing and escalate (constitution, Principle III). With retrieval alone, "not in the
  guide" and "not retrieved" look the same.
- **Simplicity.** No embedding pipeline, chunking, or second data path while we learn what
  guests actually ask.
- **Cost is negligible at pilot scale** (see the cost model below).

Caching notes:

- Any byte change in the prefix invalidates the cache, so knowledge is serialized
  deterministically, with sorted keys and no timestamps.
- Verify caching with `usage.cache_read_input_tokens`.
- Cache entries last 5 minutes by default, and each read refreshes them. Guest conversations are
  sparse, so the pilot measures the distribution of gaps between messages in the same
  conversation.
- A 1-hour TTL (`ttl: "1h"`) on the property-knowledge breakpoint pays off only for gaps of 5–60
  minutes, because its write costs 2× base input instead of 1.25×. Choose it from the measured
  gap distribution, not from the average.

#### Stage 2 (at scale): hybrid

- **Core knowledge, always in context and cached.** Check-in and checkout, arrival and access
  steps (without sensitive values), house rules, parking, amenities, emergency contacts, and a
  summary of the service catalog. Target about 3–5k tokens per property.
- **Long-tail knowledge, retrieved per question.** Appliance manuals, uploaded documents, long
  local recommendations, and the extended FAQ.
  - Chunks and embeddings are stored with **pgvector in the primary PostgreSQL**.
  - Retrieve a few chunks per question (start with 4–6, about 2–3k tokens).
  - Place the retrieved chunks **after the cache breakpoint**, in the user turn, so the cached
    prefix stays stable.
- **Unknown handling.** When no chunk passes a minimum similarity score, the retrieval result is
  "not found". The policy engine treats it like an unknown answer and drafts or escalates
  instead of guessing.
- **Languages.** Guides and guests may use different languages (ES/EN), so use a multilingual
  embedding model. The eval suite includes cross-language retrieval cases.

#### Switch triggers

A property moves to `hybrid` when any trigger fires:

| Trigger | Initial threshold | Scope |
|---|---|---|
| Knowledge size | Assembled property knowledge exceeds 30k tokens | That property |
| Cache hit rate | Below 50% of replies over 30 days in production | Platform-wide review |
| Knowledge-input cost | Above 10% of the Pro price per property per month (about $1 at a $10 Pro price) | Platform-wide review |

Gate: switching any property to `hybrid` requires the eval suite to show accuracy equal to
`full`. That includes the cross-topic, "not in the guide", and escalation cases. Thresholds are
starting values, and the end-of-pilot review revisits them with real data.

#### Cost model (illustrative)

The table shows the knowledge part of the input only. It assumes 15k tokens of property
knowledge and `claude-opus-5-5` list prices from 2026-11:

- $4 per MTok input;
- cache reads $0.20 per MTok;
- 5-minute cache writes 1.25× input;
- 1-hour cache writes 2× input.

| Strategy and case | Knowledge input per reply |
|---|---|
| Full context, cache hit | $0.003 |
| Full context, cache miss (5-minute write) | $0.075 |
| Full context, cache miss (1-hour write) | $0.12 |
| RAG only, about 3k retrieved tokens | $0.012 |
| Hybrid: 4k core cached (50% hits) plus 2k retrieved | about $0.018 |

System rules, tools, conversation history, and output tokens cost the same under every
strategy, so the table leaves them out.

Projections at a 50% cache hit rate, with 60 replies per property per month (4 stays × 15
replies):

| Scale | Full context | Hybrid | RAG only |
|---|---|---|---|
| Pilot, 30 properties (1,800 replies) | ~$70/month | ~$32/month | ~$22/month |
| 10,000 properties (600k replies) | ~$23,400/month | ~$10,800/month | ~$7,200/month |

At 10,000 properties, hybrid saves about $1.26 per property per month compared with full
context. That is about 10–14% of the Pro price, so the switch matters at scale and not in the
pilot. Hybrid keeps most of RAG's savings while core facts stay always visible to the model.

#### Retrieval security rules (apply from Stage 2)

- **No external vector database.** pgvector in the primary PostgreSQL inherits RLS, backups,
  encryption, and deletion. A separate vector store needs a new ADR.
- **Tenant isolation.** Every retrieval query runs under the same `workspace_id` RLS as other
  reads and filters by `property_id`. Contract tests prove that a query can never return
  another workspace's or another property's chunks.
- **Sensitive fields are never chunked or embedded.** Embeddings are not anonymous: research has
  shown that text can be largely reconstructed from them.
- **Deletion.** Deleting a document or property deletes its chunks and embeddings in the same
  transaction, to support data-subject erasure requests (GDPR, CCPA, LATAM laws).
- **The embedding provider is a new subprocessor.** Choose it in a spec, after a review of its
  data-processing terms (constitution, Principle VI).
- **Retrieved text is untrusted data.** Uploaded documents can contain injected instructions, so
  retrieved chunks are framed as reference data, never as instructions, the same as guest
  text.

#### Other options

- **RAG only (b) is rejected as the primary strategy.** It loses core facts on retrieval misses
  and cannot detect "not in the guide". Its cost advantage over hybrid is small.
- **Fine-tuning (c) is rejected:** knowledge changes per property and over time.

### Agent runtime: our own orchestration on the Messages API

The agent is a short, controlled pipeline, not an open-ended autonomous loop:

1. **Normalize** the inbound message, from any channel, through `ChannelPort`.
2. **Classify** using structured outputs (`output_config.format`): topic category, intent,
   language, sentiment, risk flags.
3. **Decide** in the deterministic **policy engine (code)**. It combines the classification, the
   host's autonomy settings, and the mandatory escalation categories (PRD §6.2) into one of
   `reply`, `draft`, or `escalate`. *The LLM proposes, code decides.*
4. **Generate** the reply with the cached property context and strict tools (`strict: true`):

   | Tool | Purpose |
   |---|---|
   | `get_stay_context` | Reservation and stay details |
   | `list_services` | Catalog offers |
   | `create_service_request` | Record an add-on request |
   | `escalate_to_host` | Hand off to the host |

   Forced `tool_choice` is not supported on this model, so use `auto` and instruct the model in
   the prompt.
5. **Check the output** with deterministic checks, plus an LLM check where needed:
   - no off-platform booking or payment links;
   - disclosure present on offers;
   - no sensitive values;
   - no promises of refunds or changes;
   - correct language.

   A failure becomes a draft or an escalation.
6. **Deliver or draft**, then **trace**: store the classification, decision, tool calls, model,
   tokens, cost, and latency in `AGENT_RUN`.

**Security rules:**

- Guest text only ever appears as user content.
- Host and operator instructions live in the system prompt. Mid-conversation operator
  instructions use mid-conversation system messages.
- Sensitive property values are **never** placed in the prompt. The agent points guests to the
  verified guide section, and code enforces the rule.

**Managed Agents and the Agent SDK are not adopted.** The agent needs neither a sandbox nor file
or bash tools. Keeping the loop in our code keeps the policy engine, latency, and tracing under
our control.

### Evaluation (constitution, Principle V)

- `evals/` holds golden conversations per category, in Spanish and English:
  - factual Q&A;
  - unknown answers;
  - each mandatory escalation category;
  - offers and disclosure;
  - prompt-injection attempts;
  - sensitive-data requests;
  - tone.
- Graders combine deterministic checks with LLM-as-judge rubrics.
- Every change to prompts, tools, model, or effort runs the suite in CI. Regressions block the
  merge.
- The suite also reports cost per reply.

### Consequences

- **Good:**
  - High answer quality and instruction-following on the most capable current Opus model.
  - Simple knowledge pipeline in the MVP, with a measured path to the hybrid strategy per
    property behind the `ContextAssembler`.
  - Customer data stays in one PostgreSQL under RLS in both stages.
  - Policy enforcement is deterministic and testable.
  - The provider is swappable behind `LlmPort`.
  - Every reply is auditable.
- **Bad:**
  - The per-reply cost on Opus is the main variable cost. The illustrative estimate is about
    $0.03–0.11 per reply depending on cache hits (see the business model). This makes Free-plan
    reply caps necessary, and model choice per route a recurring, eval-driven decision.
  - Dependence on a single provider in practice.
  - Full-context cost depends on cache hits and grows with very large properties. The hybrid
    strategy and its triggers cap it, at the price of an embedding pipeline and a new
    subprocessor in Stage 2.

### Confirmation

- An eval suite exists and gates CI before the first pilot.
- A pilot dashboard shows cache hit rate, cost per reply, cost per stay, accuracy, and escalation
  precision. It also shows knowledge tokens per property and the gap distribution between guest
  messages, which feed the switch triggers.
- The end-of-pilot review checks the switch triggers and thresholds against real data.
- Revisit this ADR when cost per stay exceeds budget (NFR-10), when evals show quality gaps, or
  when new models ship.

## Notes

- Model IDs and prices come from Anthropic's model catalog as of 2026-11. Re-verify before
  implementation.
- Data handling: send the minimum guest personal data, and review Anthropic's commercial terms
  and data-processing terms before production (constitution, Principle VI).
