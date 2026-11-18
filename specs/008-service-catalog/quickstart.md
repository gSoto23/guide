# Quickstart: Service Catalog and Host Add-on Requests

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack of specs 001 to 009 (`dev` launch configuration; guest app on `http://127.0.0.1:3001`),
fake model, push off unless `VAPID_*` are set (tests use a fake push sender).

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
EVAL_LLM=fake pnpm --filter @guidesk/evals-agent eval
cd e2e && pnpm exec playwright test specs/extras-us1.spec.ts specs/extras-us2.spec.ts specs/extras-us3.spec.ts --workers=1
```

## Scenarios

1. **Catalog (US1):** on a property, add the suggested airport pickup ($85, 24 hours, date and time),
   a pre-approved bike rental, and a late checkout with the turnover rule; copy the pickup to another
   property. As an agent, the catalog is read-only.
2. **Requests (US2):** with a stay link, open Extras, request the pickup for a date inside the range:
   "Waiting for your host". Request the bike: "Confirmed". On the property link, Request isn't offered.
3. **Answers (US3):** the contacts get an email (Mailpit); in Requests, confirm the pickup and decline
   another with a reason; the guest sees each status.
4. **Expiry (US4):** a request whose lead time passes expires on the next tick.
5. **Assistant (US5):** in the guide chat ask "¿Pueden recogernos en el aeropuerto?": the reply may name
   the pickup and link to Extras; the copilot doesn't.
