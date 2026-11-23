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
| Management (the founder's original AWS account) | Billing, a USD 250 monthly budget alert, AWS Organizations, and IAM Identity Center. **No workloads.** | Active since 2026-11-23 |
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
   ([section 6](#6-github-deploys-through-oidc)), the domain and its DNS, and the SES domain identity
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
- Without a domain, staging leaves `GUIDESK_PORTAL_DOMAIN`, `GUIDESK_API_DOMAIN`, and
  `GUIDESK_GUIDE_DOMAIN` unset and runs on CloudFront default URLs (allowed outside production).
- Staging's email sender is one address. SES emails it a verification link after the deploy that
  creates the identity, and the SES sandbox only delivers to verified recipients. An address sender
  gets no DMARC or DKIM records; those exist only for a domain sender (`infra/email.ts`).
- After the deploy, run the migrations as a one-off task of the API (the deploy workflow does the
  same):

  ```bash
  AWS_PROFILE=guidesk-staging scripts/aws-task.sh staging migrate
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

## 7. Cost guardrails

- The USD 250 monthly budget alert lives in the management account and covers the whole
  organization.
- Pilot estimate for both stages: about USD 200 to 230 a month, with fck-nat instances instead of
  managed NAT gateways and AWS WAF in production only (ADR-0009, updates of 2026-11-23).
- One-off commands (migrations, the demo seed) run as short ECS tasks through
  `scripts/aws-task.sh`, so no bastion host or standing database access is needed.
