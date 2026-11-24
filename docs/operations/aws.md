# AWS operations runbook

**Status:** 2026-11-23. How to sign in to Guidesk's AWS accounts, set stage secrets, and deploy by
hand until GitHub deploys through OIDC. The decisions behind it are in
[ADR-0009](../architecture/adr/0009-mvp-hosting-and-transactional-email.md#amendment-2026-11-23-accounts-and-access);
what is done and what is pending is in [pilot readiness §2](../pilot-readiness.md#2-aws-and-the-staging-stage).

> **This repository is public.** Never write account IDs, the organization or Identity Center IDs,
> the access portal URL, support case numbers, secret values, or personal email addresses in it. Use
> placeholders such as `<staging-account-id>`.

## 1. Accounts

All accounts belong to one AWS Organization. Everything runs in `us-east-1`.

| Account | Purpose | Status |
|---|---|---|
| Management (the founder's original AWS account) | Billing, a USD 250 monthly budget alert, AWS Organizations, and IAM Identity Center. **No workloads.** Temporarily holds the `guidesk.io` DNS zone ([section 7](#7-domain-and-dns)) | Active since 2026-11-23 |
| `guidesk-staging` | The SST `staging` stage (and any dev or preview stage) | Active since 2026-11-23, tagged `project=guidesk`, `stage=staging` |
| `guidesk-production` | The SST `production` stage | Not created: waits for the account quota increase ([section 3](#3-create-the-production-account)) |

Production never runs in the management account: service control policies (SCPs) never apply to
it, a compromised workload there reaches the whole organization, and moving production out later
means migrating the database, media, and DNS.

## 2. Sign in

Human access goes through IAM Identity Center only: one user for the founder with MFA required, and
the `AdministratorAccess` permission set (8-hour sessions) on each account. There are no IAM users
and no long-lived access keys.

`~/.aws/config` (on the founder's machine, never in the repository) holds one SSO session and one
profile per account:

```ini
[sso-session guidesk]
sso_start_url = <access-portal-url>
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile guidesk-admin]
sso_session = guidesk
sso_account_id = <management-account-id>
sso_role_name = AdministratorAccess
region = us-east-1

[profile guidesk-staging]
sso_session = guidesk
sso_account_id = <staging-account-id>
sso_role_name = AdministratorAccess
region = us-east-1

# Added once the production account exists (section 3).
[profile guidesk-production]
sso_session = guidesk
sso_account_id = <production-account-id>
sso_role_name = AdministratorAccess
region = us-east-1
```

Sign in once per 8-hour session. The login belongs to the `guidesk` SSO session, so it covers every
profile above:

```bash
aws sso login --profile guidesk-admin
```

Then choose the account per command with `AWS_PROFILE`, and check which account you are in before
changing anything:

```bash
AWS_PROFILE=guidesk-staging aws sts get-caller-identity
```

In zsh, prefer the `AWS_PROFILE=<profile> <command>` prefix to a `--profile` flag kept in a shell
variable: zsh does not split a variable into words, so `$P` holding `--profile guidesk-staging` is
passed as one argument.

## 3. Create the production account

A new organization may hold only 2 accounts (the management and staging accounts use both). A
Service Quotas increase was requested on 2026-11-23. AWS refuses requests for 10 or fewer, so the
request asks for 11. It became a support case and is pending. Follow the case in the Support Center
of the management account.

Once AWS approves it:

1. Create the account from the management account. Its root email is a plus-address of the founder's
   mailbox, like staging's (do not write it here):

   ```bash
   AWS_PROFILE=guidesk-admin aws organizations create-account \
     --email '<production-root-email>' \
     --account-name guidesk-production \
     --tags Key=project,Value=guidesk Key=stage,Value=production
   ```

2. Wait until the request reports `SUCCEEDED`, and note the new account ID (outside the repository):

   ```bash
   AWS_PROFILE=guidesk-admin aws organizations describe-create-account-status \
     --create-account-request-id <request-id>
   ```

3. In IAM Identity Center, assign the founder's user the `AdministratorAccess` permission set on
   `guidesk-production` (console: IAM Identity Center → AWS accounts → `guidesk-production` →
   Assign users or groups).
4. Add the `guidesk-production` profile to `~/.aws/config` ([section 2](#2-sign-in)) and check it
   with `AWS_PROFILE=guidesk-production aws sts get-caller-identity`.
5. Expect AWS Support to verify the new account before it can create CloudFront distributions, as
   it did for staging ([section 5](#5-deploy-by-hand-from-a-clean-worktree)); open that case as soon
   as the account exists.
6. Prepare the stage as in [pilot readiness §2](../pilot-readiness.md#2-aws-and-the-staging-stage):
   secrets ([section 4](#4-stage-secrets)), the GitHub OIDC deploy role
   ([section 6](#6-github-deploys-through-oidc)), the apex DNS zone moved into this account
   ([section 7](#7-domain-and-dns)), and the SES domain identity
   with production access. Production refuses to deploy without its three domains and
   `GUIDESK_CONTACT_EMAIL` (`infra/config.ts`).

## 4. Stage secrets

The secret names are in `infra/secrets.ts`. Set each one through **stdin**, so the value never
appears in the command line, the shell history, or the process list. For a generated value:

```bash
umask 077
tmp=$(mktemp)
openssl rand -base64 48 | tr -d '\n' > "$tmp"
AWS_PROFILE=guidesk-staging pnpm sst secret set BetterAuthSecret --stage staging < "$tmp"
rm -f "$tmp"
```

For a value you were given (a Google client secret, an Anthropic key), paste it into a private file
the same way, set it with `< file`, and delete the file. Never pass a value as an argument.

A changed secret reaches the services on the next deploy. Rotating `VapidPublicKey` and
`VapidPrivateKey` drops every subscribed device, and rotating `BetterAuthSecret` ends current
sessions.

Staging on 2026-11-23:

| Secret | Value in staging |
|---|---|
| `BetterAuthSecret`, `EdgeSharedSecret`, `FeedUrlPepper` | Generated random values |
| `VapidPublicKey`, `VapidPrivateKey` | A generated VAPID pair (`npx web-push generate-vapid-keys`) |
| `GoogleClientId`, `GoogleClientSecret` | `unset` until the founder creates the Google OAuth client. It needs the deployed portal URL: the redirect URI is `<portal-url>/api/auth/callback/google` |
| `AnthropicApiKey` | `unset` until the founder enters a key with a spending limit (paid model calls need the founder's approval) |
| `ViatorApiKey` | `unset` (its default) until Guidesk joins Viator |

### Warning: `sst secret list` prints values

`pnpm sst secret list` prints every secret **with its value**. Only ever run it through `cut`, which
keeps the names:

```bash
AWS_PROFILE=guidesk-staging pnpm sst secret list --stage staging | cut -d= -f1
```

Values leaked this way once (2026-11-23) and were rotated. If it happens again, in a terminal, a
log, a screen share, or an AI assistant's shell, set new values for every printed secret and
redeploy.

## 5. Deploy by hand from a clean worktree

Until GitHub deploys through the OIDC role ([section 6](#6-github-deploys-through-oidc)), the founder
deploys from their machine. Always deploy from a clean `git worktree`, never from the working
checkout.

**Why:** `apps/portal/next.config.ts` loads the repository root `.env` at build time. A development
checkout's `.env` holds local settings (for example `API_PROXY_URL=http://localhost:4000`), which
would be built into the deployed portal. CI has no `.env`, and a fresh worktree has none either, so
it builds what CI would build.

```bash
git fetch origin
git worktree add --detach ../guidesk-deploy <commit>
cd ../guidesk-deploy
pnpm install --frozen-lockfile
pnpm build
AWS_PROFILE=guidesk-staging GUIDESK_EMAIL_SENDER=<verified-sender-address> pnpm sst deploy --stage staging
```

- Pass the other `GUIDESK_*` settings the deploy workflow passes (`.github/workflows/deploy.yml`)
  when the stage needs them; unset ones take their defaults.
- Until its hostnames are set ([section 7](#7-domain-and-dns)), staging leaves
  `GUIDESK_PORTAL_DOMAIN`, `GUIDESK_API_DOMAIN`, and `GUIDESK_GUIDE_DOMAIN` unset and runs on
  CloudFront default URLs (allowed outside production).
- Staging's email sender is one address. SES emails it a verification link after the deploy that
  creates the identity, and the SES sandbox only delivers to verified recipients. An address sender
  gets no DMARC or DKIM records; those exist only for a domain sender (`infra/email.ts`).
- After the deploy, run the migrations as a one-off task of the API (the deploy workflow does the
  same):

  ```bash
  AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging migrate
  ```

- The founder's plan tool runs the same way (specs 011 and 019): `plan show`, `plan set`, `plan
  topup`, `plan topups`, and `plan topup-correct`, with the options of
  `packages/db/src/cli/plan.ts`. The script passes the arguments as JSON, so notes may hold spaces:

  ```bash
  AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan show --workspace <uuid>
  AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging plan topup --workspace <uuid> --replies 250 --note "pilot"
  ```

- Remove the worktree when done: `git worktree remove ../guidesk-deploy`.
- The API and worker images are arm64 (Graviton). CI deploys on an `ubuntu-24.04-arm` runner, so it
  builds them natively; a manual deploy builds them natively on an arm64 machine and needs emulation
  on an x86 one.

### CloudFront needs a verified account

AWS Support must verify a new account before it can create CloudFront distributions. The first
staging deploy (2026-11-23) created everything except CloudFront, and a support case is open from
the staging account. While it waits, the partial stack costs about USD 1 a day. Once AWS verifies
the account:

1. Rerun the same deploy from a clean worktree; SST resumes where it stopped.
2. Run the migrations: `AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging migrate`.
3. Record the CloudFront URLs and the outcome in
   [pilot readiness §2](../pilot-readiness.md#2-aws-and-the-staging-stage).

Expect the same check on the production account.

## 6. GitHub deploys through OIDC

The deploy workflow (`.github/workflows/deploy.yml`) assumes an AWS role through GitHub's OIDC
tokens, so GitHub holds no AWS keys.

**Staging (created 2026-11-23):**

- An IAM OIDC identity provider for `token.actions.githubusercontent.com`, audience
  `sts.amazonaws.com`.
- The role `guidesk-github-deploy`
  (`arn:aws:iam::<staging-account-id>:role/guidesk-github-deploy`):
  - trust: only `repo:gSoto23/guide:environment:staging`, that is, jobs of this repository that run
    in the GitHub environment `staging`;
  - sessions of 1 hour;
  - permissions: `AdministratorAccess`, scoped to the staging account, because SST creates every kind
    of resource the stage uses.

**Not wired up yet.** Do these GitHub steps only after CloudFront is verified and a manual deploy
has finished:

1. Create the GitHub environment `staging` (Settings → Environments), with deployment branches
   limited to `main`.
2. Set its environment variable `GUIDESK_EMAIL_SENDER` to the verified sender address. Without it,
   a CI deploy would delete the SES identity (`infra/email.ts` only creates it when the variable is
   set).
3. Set the repository variable `AWS_DEPLOY_ROLE_ARN` to the role ARN (Settings → Secrets and
   variables → Actions → Variables). The deploy job skips while it is empty.

**Production (later):** create the same provider and a role in the production account that only
`repo:gSoto23/guide:environment:production` may assume. The `production` environment then
overrides `AWS_DEPLOY_ROLE_ARN` with that role's ARN, while the repository variable keeps the
staging role.

Public Actions logs show the role ARN, so the account number appears there. AWS does not treat
account IDs as secret; this repository still keeps them out of its documents.

## 7. Domain and DNS

**The domain is `guidesk.io`** (founder decision, 2026-11-23, OQ-11). The owner of guidesk.com will
not sell. It is registered at **Dynadot**, an external registrar, because the management account
cannot register domains in Route 53 (registrations fail with "contact AWS Support"). Privacy
protection and auto-renew are on. **If the registration lapses, every QR poster and stay link
breaks**, so keep the registrar's payment method current, and keep its account behind two-factor
sign-in and its transfer lock on.

A bare IP address cannot replace a domain: CloudFront and the load balancer have no fixed IP
addresses, ACM certificates need names, and passkeys and Google sign-in need a domain.

### Zone layout

All DNS is in Route 53, one hosted zone per stage account (USD 0.50 a month each):

| Zone | Account | Holds |
|---|---|---|
| `guidesk.io` (apex) | Management, **temporarily**; production once it exists | Production's records, and the NS record that delegates `staging.guidesk.io` |
| `staging.guidesk.io` | Staging | Everything under `staging.guidesk.io`, written by SST |

Proposed hostnames (the founder can still change them):

| | Production | Staging |
|---|---|---|
| Portal and public pages (`GUIDESK_PORTAL_DOMAIN`) | `guidesk.io` | `staging.guidesk.io` |
| API (`GUIDESK_API_DOMAIN`) | `api.guidesk.io` | `api.staging.guidesk.io` |
| Guest guide (`GUIDESK_GUIDE_DOMAIN`) | `guia.guidesk.io` | `guia.staging.guidesk.io` |
| Email sender domain (`GUIDESK_EMAIL_SENDER`) | `guidesk.io` | `staging.guidesk.io` |

Staging keeps its single verified-address sender until its domain sender is set up.

### How delegation works

1. The registrar lists the apex zone's four name servers for `guidesk.io`. Every lookup under
   `guidesk.io` starts at that zone. (The name servers were being switched at the registrar on
   2026-11-23.)
2. The apex zone holds an `NS` record for `staging.guidesk.io` whose values are the staging zone's
   name servers. Lookups for `staging.guidesk.io` and anything below it are handed to the zone in
   the staging account.
3. SST, deploying with the staging profile or role, finds the `staging.guidesk.io` zone in its own
   account and writes the certificate validation records, the CloudFront aliases, and the SES
   records there. It never needs access to the management or production account.

Check a delegation with `dig +short NS staging.guidesk.io`, which should list the staging zone's
name servers.

### Move the apex zone to production

SST in production must manage the apex records itself (the portal on `guidesk.io`, `api.`,
`guia.`, the SES records), and it cannot write to a zone in another account. So once the
production account exists, and before its first deploy:

1. Export the old zone's records:
   `AWS_PROFILE=guidesk-admin aws route53 list-resource-record-sets --hosted-zone-id <apex-zone-id>`.
2. Create the hosted zone `guidesk.io` in the production account
   (`AWS_PROFILE=guidesk-production aws route53 create-hosted-zone --name guidesk.io --caller-reference <unique-string>`).
3. Recreate every record except the zone's own `SOA` and `NS`. There are few: at least the `NS`
   record delegating `staging.guidesk.io`, with the same values, so staging keeps working.
4. At the registrar, replace the name servers with the new zone's four name servers.
5. Wait until lookups return the new name servers (allow up to 48 hours), keeping both zones
   identical meanwhile, then delete the old zone from the management account.
6. Deploy production with its hostnames; SST creates its certificates and records in the new zone.

## 8. Cost guardrails

- The USD 250 monthly budget alert lives in the management account and covers the whole
  organization.
- Pilot estimate for both stages: about USD 200 to 230 a month, with fck-nat instances instead of
  managed NAT gateways and AWS WAF in production only (ADR-0009, updates of 2026-11-23).
- One-off commands (migrations, the demo seed) run as short ECS tasks through
  `scripts/aws-task.sh`, so no bastion host or standing database access is needed.
