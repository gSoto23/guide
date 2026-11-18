# Quickstart: Agent Settings

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 005 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`),
with the fake model (`LLM_MODE=fake`, the local default). Mailpit shows the emails.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
pnpm --filter @guidesk/evals-agent eval
pnpm exec playwright test e2e/specs/settings-us1.spec.ts e2e/specs/settings-us2.spec.ts e2e/specs/settings-us3.spec.ts e2e/specs/settings-us4.spec.ts e2e/specs/settings-us5.spec.ts e2e/specs/settings-us6.spec.ts --workers=1
```

## Scenarios

1. **Per-topic autonomy (US1):** in Settings → Assistant, set Wi-Fi to "Answer when it's in the guide",
   keep Arrival at "I review each reply", save. Open the guide, ask for the Wi-Fi network: answered at
   once. Ask the check-in time: holding reply and a draft. The locked list shows emergencies, money,
   complaints, reservation changes, legal topics, codes, and uncertain questions.
2. **Property levels (US1):** on a second property, uncheck "Use the workspace settings" for autonomy and
   set every topic to "I review each reply": the same Wi-Fi question becomes a draft there.
3. **Clarify and general (US2):** set Other questions to "Answer and ask on its own"; ask "is it far?":
   one clarifying question arrives at once. Ask "what's the weather like in March?": a general answer
   that says it is general. At "Answer when it's in the guide", both become drafts.
4. **Quiet hours and contacts (US3):** set quiet hours covering now and choose one contact. Ask a
   parking question with drafts on: the holding reply says when the host usually answers, and Mailpit
   has nothing. Write "there's smoke in the kitchen": the contact and every owner and admin get
   `chat.needs_host` at once. Move the window's end to one minute from now: within two minutes the
   contact gets `chat.quiet_summary` listing the parking conversation.
5. **Tone and instructions (US4):** set the tone to formal: Spanish replies and holding replies use
   "usted". Save instructions with a link or "el código es 4821": refused with the reason. Save "Sugiere
   caminar a la playa": answers about the beach follow it.
6. **Test the assistant (US5):** on the property screen, test "¿a qué hora es el check-in?": the topic,
   the outcome under the saved settings, and the reply appear; no conversation or email is created.
7. **Why this reply (US6):** open "Why this reply" on an answer: the level and its source, the kind,
   the tone, quiet hours, and whether instructions were used.
