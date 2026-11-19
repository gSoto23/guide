# Contract: Demo Seed Command

## Invocation

```text
node dist/cli/demo-seed.js --email <account email> [--json]
pnpm --filter @guidesk/api demo:seed -- --email <account email> [--json]
```

| Argument | Required | Rule |
|---|---|---|
| `--email` | Yes | An existing account's email (case-insensitive) whose email is verified |
| `--json` | No | Prints the result as one JSON object instead of text |

Environment: the API's configuration (`DATABASE_URL` or the `DATABASE_*` parts, the KMS settings,
`GUIDE_URL`, `NODE_ENV`, and `STAGE` on AWS).

## Guards (checked in this order, before any write)

| Check | Exit | Message code |
|---|---|---|
| Missing or malformed `--email` | 2 | `usage` |
| `STAGE=production`, or `NODE_ENV=production` without `STAGE` | 3 | `production_refused` |
| No account with that email | 4 | `unknown_account` |
| Account email not verified | 4 | `unverified_account` |

## Success (exit 0)

Text output:

```text
Demo workspace created: Demo · Guidesk (<workspace id>)
Owner: <email>
Casa Brisa guide: <GUIDE_URL>/g/<publicId>
Loft Escazú guide: <GUIDE_URL>/g/<publicId>
Current stay link: open the portal → Casa Brisa → Stays → current stay → Copy link.
```

JSON output: `{ "workspaceId", "workspaceName", "properties": [{ "name", "guideUrl" }] }`.

The output never contains a stay token, a confirmation code, or a door code.

## Failure during the build (exit 1)

- The transaction rolls back, and no demo workspace or partial row remains.
- The command prints `seed_failed: <short reason>` to stderr, without values from the data.

## Side effects on success

- One new workspace with `demo = true` and the dataset in [data-model.md](../data-model.md).
- One `workspace.demo_seeded` security event.
- No email, push, AI, PMS, payment, or partner call.
