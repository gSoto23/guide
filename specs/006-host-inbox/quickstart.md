# Quickstart: Host Inbox and Reply Copilot

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 007 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`), fake
model (`LLM_MODE=fake`). Push is off locally unless `VAPID_*` are set; tests use a fake push sender.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
EVAL_LLM=fake pnpm --filter @guidesk/evals-agent eval
cd e2e && pnpm exec playwright test specs/inbox-us1.spec.ts specs/inbox-us2.spec.ts specs/inbox-us3.spec.ts specs/inbox-us4.spec.ts specs/inbox-us5.spec.ts specs/inbox-us6.spec.ts --workers=1
```

## Scenarios

1. **Inbox (US1):** with two properties, ask a parking question in each guide's chat (drafts on), and
   write "hay humo en la cocina" in one: Needs you lists the emergency first. Filter by one property. Mark
   the other done; write again from its guide: it returns.
2. **Draft actions and take over (US2):** reject a draft (nothing reaches the guest). Switch "I'll reply
   myself" on, ask the guide something: no assistant message, the item shows "Taken over". Write an
   emergency: the card appears. Hand back: the next question is drafted again.
3. **Copilot (US3):** open "Paste a guest message", paste "¿Puedo llevar a mi perro?", pick the property
   and "Confirmed": a draft with "Passed checks". Pick "Inquiry" and paste "¿Tienen página web?": no link,
   with a note.
4. **Push (US4):** with `VAPID_*` set on staging, turn alerts on from the inbox banner on a phone, send a
   test, then trigger an escalation: the push opens the conversation.
5. **Presence (US5):** two members open the same conversation; one types: the other sees "{name} is
   replying".
6. **Trust suggestion (US6):** send five parking drafts unchanged at one property: the inbox suggests
   letting the assistant answer parking there.
