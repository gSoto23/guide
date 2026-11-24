# Quickstart: AI Reply Allowances and Top-ups

**Feature**: [spec.md](spec.md)

## Local

Prerequisites: the local stack running (`pnpm dev`), a workspace you own, and its ID (Plan and limits
shows it).

1. **Allowances**: open Plan and limits on a Free workspace → "Respuestas de IA este mes: 0 de 500".
   `pnpm --filter @guidesk/db plan:set -- --workspace <id> --plan pro --note "check"` → 500 with one
   property ("300 por propiedad activa, mínimo 500"); `--plan business` → 1,000.
2. **Pace**: from one guest device, send 26 chat messages within 10 minutes → the 26th gets the pause
   message and no AI reply is counted.
3. **Top-up**: `plan:set … --ai-replies 1 --note "test"`, then make one AI reply (assistant test) → the
   banner says the month is used up. `pnpm --filter @guidesk/db plan:topup -- --workspace <id> --replies
   3 --note "test"` → the next assistant tests answer; Plan and limits shows "Recarga: quedan N de 3".
   After 3 more replies the AI pauses again, and the owner gets the "top-up used up" email (Mailpit).
4. **Correction**: `plan:topups -- --workspace <id>` lists the top-up; `plan:topup-correct -- --top-up
   <uuid> --remaining 0 --note "test"` empties it.
5. Reset: `plan:set … --ai-replies plan --note "done"`.

## Staging

```bash
AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan show --workspace <id>
AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan topup --workspace <id> --replies 250 --note "pilot"
```

Expected: the task prints the plan report with the top-up balance and exits 0.
