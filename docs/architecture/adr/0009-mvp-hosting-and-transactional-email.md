# 0009. AWS hosting and transactional email for the MVP

- **Status:** Accepted. The founder chose **AWS** on 2026-11-14 and accepted the service-level
  design below the same day.
- **Date:** 2026-11-14
- **Deciders:** Founder (cloud choice); architect (service design, proposed in the plan for
  spec 001)
- **Related:** [ADR-0004](0004-typescript-monorepo-stack.md) (its initial hosting row is
  replaced by this ADR) · [Plan 001 research R2, R7, R9, R10](../../../specs/001-workspace-accounts/research.md) · [Performance §4](../performance.md#4-backend-and-database) · [Security](../security.md#4-controls) · OQ-22, OQ-29

## Context and problem statement

ADR-0004 proposed Vercel, a container PaaS, and a managed PostgreSQL host, without a final choice
(OQ-22). On 2026-11-14 the founder decided to use AWS. We need a concrete AWS design for the
portal and guest guide (Next.js), the API and worker (NestJS, pg-boss), PostgreSQL, transactional
email (OQ-29), encryption keys (SEC-06), and secrets. It must stay simple enough for one developer.

## Decision drivers

- Every service in one region, close to the US and Latin America (performance doc §4).
- Little operations work, and infrastructure as code in TypeScript (same language as the stack).
- The guest guide is static-first behind a CDN, with on-demand revalidation (performance doc §2).
- Host-only cookies through one browser origin (SEC-11).
- Point-in-time recovery for the database (SEC-17); KMS for restricted data (SEC-06).
- Low fixed cost during the free pilot.

## Considered options

- **Next.js hosting:**
  - OpenNext on Lambda and S3 behind CloudFront (via SST);
  - AWS Amplify Hosting;
  - Next.js in a container on ECS.
- **API and worker:** ECS Fargate, Lambda, AWS App Runner.
- **Database:** RDS for PostgreSQL, Aurora PostgreSQL Serverless v2.
- **Email:** Amazon SES, Postmark, Resend.
- **Infrastructure as code:** SST, AWS CDK, Terraform.

## Decision outcome

Region: **`us-east-1` (N. Virginia)** for everything, with CloudFront at the edge.

| Layer | Choice | Notes |
|---|---|---|
| Edge and routing | **CloudFront** with **AWS WAF** | One distribution per app domain. `/api/*` routes to the API load balancer, so the browser sees a single origin and cookies stay host-only (SEC-11). WAF adds edge rate limits and bot rules (SEC-07). CloudFront viewer headers provide the approximate location (research R7) |
| Portal and guest guide (Next.js) | **OpenNext on Lambda and S3, deployed with SST's `Nextjs` component** | Static and ISR pages are served from S3 and CloudFront; server rendering runs on Lambda. The Next.js apps never connect to the database: they call the API |
| API and worker | **ECS Fargate** (two services) behind an **Application Load Balancer** | Long-running NestJS API and a pg-boss worker. Start with 1–2 small tasks per service |
| PostgreSQL | **Amazon RDS for PostgreSQL 16** | Single-AZ for the pilot, Multi-AZ before the public launch. Automated backups with point-in-time recovery (SEC-17). Storage encrypted with KMS. Connections only from the private subnets of the Fargate services |
| Transactional email | **Amazon SES** with a configuration set, and SPF, DKIM, and DMARC on the sending domain | Request production access (leaving the SES sandbox) before the pilot. React Email templates behind `NotificationPort`; Postmark stays the fallback adapter |
| Keys and secrets | **AWS KMS** (customer-managed keys) and **Secrets Manager** | A customer-managed KMS key wraps the per-workspace data keys for restricted values: door codes, calendar links, and PMS credentials (SEC-06, feature 002 research R5). Secrets Manager stores the auth secret, Google OAuth credentials, the database credentials, the internal proxy secret, the feed-link pepper, and the Anthropic API key |
| Uploads (feature 002) | **Amazon S3** uploads bucket | Private. The browser posts screenshots and CSV files straight to it with presigned forms that fix the key, type, and size; nothing is served from it. Objects are deleted once processed, and a lifecycle rule deletes anything older than 1 day (research R9) |
| Malware scanning (feature 002) | **Amazon GuardDuty Malware Protection for S3** | On the uploads bucket, before files are processed (research R9). To be enabled before screenshots or CSV import reach production hosts (production gate, research R15) |
| Sandbox functions (feature 002) | Two **Lambda** functions outside the VPC: `feed-reader` and `file-processor` | The only code that fetches host-supplied links or parses uploaded bytes (SEC-09, SEC-10, research R2). No route to internal services; the file processor's role can only read and delete `uploads/*`. The API and the worker call them through `SandboxPort` |
| Guide media (feature 003) | **Amazon S3** media bucket | Private. Cleaned images and videos from the file processor (`media/*`), shown through presigned GET URLs on the bucket's own origin for 15 minutes (SEC-11, spec 003 research R9). Spec 004 adds a CDN for guests |
| Speech to text (feature 003) | **Amazon Transcribe** batch jobs | Interview voice notes, read from the uploads bucket; the transcript is written under `transcripts/` and deleted with the job right after reading (spec 003 research R8). Behind the `guide.interviewVoice` flag until the R22 gate, with the AWS AI-services opt-out policy |
| Observability | **CloudWatch** logs and metrics, OpenTelemetry, and **Sentry** for errors | Personal-data scrubbing per SEC-06 |
| Infrastructure as code | **SST** (TypeScript; 4.17 at setup) | Components for Next.js, ECS Cluster and Service, Postgres (RDS), Email (SES), VPC, Router, and Secrets. One stage per environment (`dev`, `staging`, `production`); preview stages for the portal. AWS CDK is the fallback if SST stops fitting |
| Networking | One VPC with public and private subnets | Prefer VPC endpoints (S3, Secrets Manager, CloudWatch) to reduce NAT gateway traffic and cost; keep one NAT gateway for outbound calls (Claude API, Tilopay, PMS APIs) |

Accounts: separate AWS accounts for `production` and for `dev`/`staging` under AWS Organizations,
with IAM Identity Center for human access and MFA required (SEC-15). CI deploys through GitHub
OIDC roles; no long-lived AWS keys.

### Consequences

- **Good:**
  - One cloud, one bill, one identity system (IAM), one region.
  - KMS, WAF, SES, and S3 are native, which closes the KMS question (OQ-22) and simplifies SEC-06,
    SEC-07, SEC-10, and SEC-17.
  - Infrastructure as code in TypeScript from day one.
  - A future fallback path for the LLM: Claude is also available through Amazon Bedrock
    (performance doc §7). Adopting it needs its own ADR.
- **Bad:**
  - More to operate than Vercel and Railway: VPC, NAT, load balancer, ECS, and RDS settings. SST
    reduces, but does not remove, this work.
  - Fixed monthly costs exist even when idle: load balancer, NAT gateway, RDS instance, and
    Fargate tasks. The budget must show them.
  - No database branches per pull request (Neon had them). Previews share the staging database,
    with separate schemas or seeded data.
  - SES deliverability is our responsibility: domain authentication, bounce and complaint
    handling, and sending reputation. One-time codes depend on it.
  - SST is a third-party tool. Pin versions; CDK is the fallback.

### Confirmation

- Staging runs on this design before the pilot and meets the API p95 ≤ 300 ms budget in k6
  tests.
- A point-in-time restore test passes (SEC-17).
- One-time codes reach the inbox in p95 ≤ 30 s through SES.
- The infrastructure is fully reproducible from the repository (`sst deploy --stage staging`).
- Revisit when a second region is needed, if fixed costs are too high for the pilot, or if
  SES delivery misses the target (switch to the Postmark adapter).

Sources: [SST components](https://sst.dev/docs/components/) ·
[SST Next.js on AWS](https://sst.dev/docs/start/aws/nextjs) ·
[SST container support](https://sst.dev/blog/container-support/)
