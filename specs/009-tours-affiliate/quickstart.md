# Quickstart: Tours and Experiences (Affiliate)

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 007 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`) with
`EXPERIENCES_MODE=fixtures` (synthetic Viator data for any destination) and a test
`CIVITATIS_AFFILIATE_ID`. No partner is contacted locally or in tests.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
EVAL_LLM=fake pnpm --filter @guidesk/evals-agent eval
cd e2e && pnpm exec playwright test specs/explore-us1.spec.ts specs/explore-us2.spec.ts specs/explore-us3.spec.ts specs/explore-us5.spec.ts --workers=1
```

## Scenarios

1. **Guests discover experiences (US1):** publish a guide for a property in Sámara, Costa Rica, with one
   restaurant tip; run `explore.refresh`; open the guide on a phone: Explore shows the tip first, then
   experiences by category with the disclosure; open one and tap "Book on Viator": the partner URL opens
   in a new tab with the affiliate parameters and one click is counted.
2. **Host settings (US2):** as the owner, hide "Water" and one experience on the property, and set the
   workspace default to hide "Culture": within a minute the guide follows; a second property that
   follows the default hides "Culture" only. As an agent, the settings are read-only.
3. **Disclosure and safe links (US3):** check the disclosure at the top and on every card and detail in
   both languages; call the click address for a hidden experience and with an extra `url=` parameter:
   both land on Explore.
4. **Freshness (US4):** change the fixture data and run the job: the guide reflects it. Make the fixture
   partner fail for two runs: Viator experiences disappear after their keeping limit; the guide still
   opens normally.
5. **Assistant (US5):** in the guide chat ask "¿Qué tours hay por aquí?": the reply links to Explore and
   names no partner experience. In the copilot, the same question gets no Explore or partner link.
