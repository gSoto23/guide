# Quickstart: Plan Limits

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 010 (`dev` launch configuration), fake model.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
pnpm --filter @guidesk/portal build && pnpm --filter @guidesk/portal bundle:check
cd e2e && pnpm exec playwright test specs/plan-us1.spec.ts specs/plan-us4.spec.ts --workers=1
```

## Scenarios

1. **AI replies (US1):** on a Free workspace with a published guide, set a custom AI limit of 2 with
   `plan:set`; ask three questions in the guide chat: two answers, then the holding reply; the inbox
   shows the conversation waiting with "AI replies for this month are used up"; a copilot draft says
   the same; the owner gets the 80% and 100% emails within 5 minutes (local mail log).
2. **Properties and seats (US2):** on Free with 2 properties, adding a third (blank, listing,
   duplicate) is refused with the limit and a link to Plan and limits; inviting a member is refused
   with the seat limit.
3. **Founder tool (US3):** `plan:set --plan business --note "pilot"`; the third property and the
   invitation now succeed; the security log shows "Guidesk changed the plan from Free to Business";
   `plan:show` prints the limits with their sources and usage.
4. **Screen and banner (US4):** as the owner open Settings → Plan and limits: plan, meters as text,
   renewal moment, workspace ID, contact; with usage at 80% a banner appears on every page; an agent
   cannot open the screen and never sees the banner.
