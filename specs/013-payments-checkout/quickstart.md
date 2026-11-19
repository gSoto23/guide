# Quickstart: Guest Checkout and Host Payouts

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Local stack (`dev` launch configuration), `PAYMENTS_MODE` unset (simulated), fake model.

## Automated checks

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @guidesk/db test:integration
pnpm --filter @guidesk/api test:integration
pnpm --filter @guidesk/worker test:integration
pnpm --filter @guidesk/portal build && pnpm --filter @guidesk/portal bundle:check
cd e2e && pnpm exec playwright test specs/payments-us1.spec.ts specs/payments-us3.spec.ts --workers=1
```

## Scenarios

1. **Payouts (US2):** as the owner open Settings → Payouts, set up payouts, approve on the simulated
   page; Payouts shows "Active" and the plan's fee (Free 10%).
2. **Pay (US1):** add a pre-approved 85 USD extra; as the guest with a stay link request it, tap
   "Pay 85 USD", pay on the simulated page; the guide shows "Paid" with the reference; the contacts got the
   "paid" email (Mailpit).
3. **Refund (US3):** on Requests the owner refunds 20 USD after re-authenticating: "Partly refunded";
   Payouts shows the month's totals; cancelling the request asks for a full refund first.
4. **Fee (US4):** `plan:set --fee-percent 4`; the next order's platform fee is 4%.
