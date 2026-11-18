# Quickstart: In-Guide AI Chat

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 004 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`),
with the fake model (`LLM_MODE=fake`, the local default).

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
pnpm --filter @guidesk/evals-agent eval
pnpm exec playwright test e2e/specs/chat-us1.spec.ts e2e/specs/chat-us2.spec.ts e2e/specs/chat-us3.spec.ts e2e/specs/chat-us4.spec.ts e2e/specs/chat-us5.spec.ts e2e/specs/chat-us6.spec.ts --workers=1
```

## Scenarios

1. **Answer (US1):** publish a guide, set the property's assistant to "Answer automatically when it's
   safe", open the guide, tap Ask, ask how to check out: the answer cites Checkout. Ask for the door
   code: a pointer to Arrival, no code.
2. **Escalation (US2):** write "there's smoke in the kitchen": the emergency card first, then a holding
   reply; Mailpit has `chat.needs_host` for every member.
3. **Drafts (US3):** with "I review every reply", ask about parking: holding reply; open the email link,
   send the draft; the guest's chat shows it within 5 seconds.
4. **Settings (US4):** change the workspace default and a property override; agents can only read them.
5. **Limits (US5):** send 21 messages in 10 minutes: the 21st is paused without a model call.
6. **Traces (US6):** open "Why this reply" on an answer: sections, topic, checks, autonomy.

## Founder gates before the pilot

- The agent eval suite against the real model (`ANTHROPIC_API_KEY` CI secret).
- The legal review of intro, holding, and pause texts (OQ-35).
- This quickstart on staging with the real model (latency and cost per reply).
