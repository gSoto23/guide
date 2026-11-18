# Quickstart: Basic Analytics

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 009 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`),
fake model.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/portal build && pnpm --filter @guidesk/portal bundle:check
cd e2e && pnpm exec playwright test specs/analytics-us1.spec.ts specs/analytics-us3.spec.ts --workers=1
```

## Scenarios

1. **Property (US1):** publish a guide, open it from the property link and from a stay link, ask two
   questions in the chat with the assistant at full autonomy; on the property page open Analytics:
   2 views (1 property, 1 stay), 1 stay opened, 2 questions answered automatically, 100%.
2. **Topics and unanswered (US2):** ask something the guide doesn't cover; the unanswered list shows it
   with a link to the conversation.
3. **Workspace (US3):** with two properties, open Analytics from the header; totals equal the rows;
   sort by questions; open a property.
4. **Explore and add-ons (US4):** open Explore, click a partner experience, request an extra; the
   numbers and the attach rate update.
5. **Founder report (US5):** `pnpm --filter @guidesk/db report:pilot -- --from <sign-up day> --to
   <today>` prints the six metrics with targets and no names or emails.
