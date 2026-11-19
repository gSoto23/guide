# Quickstart: Launch Pages and Demo Workspace

How to check that spec 014 works. Contracts:
[public pages](contracts/public-pages.md) · [demo seed command](contracts/demo-seed-cli.md) · [data model](data-model.md).

## Prerequisites

- The local stack running, with `preview_start dev` or `pnpm dev`: portal on `:3000`, API on `:4000`,
  guide on `:3001`, Postgres on `55432`.
- Migrations applied (`pnpm db:migrate`).
- One account signed up locally (email code through Mailpit, or Google).
- For staging: the stage deployed, an account signed up there, and the AWS CLI configured for the
  staging account.

## Scenario 1: Public home page (US1)

1. Open `http://localhost:3000/` with a Spanish browser language. It lands on `/es`.
2. The page shows:
   - the tagline "Tu casa, siempre lista para responder.";
   - who it is for, three steps, and five features;
   - plans: Free USD 0 with 2 properties, 100 AI replies, and 1 seat; Pro and Business "Precio por
     anunciar"; fees on extras 10%, 7%, and 5%; "Gratis durante el piloto";
   - a footer with Privacidad and Términos.
3. "Empieza gratis" opens `/es/sign-in`. "English" opens `/en` with every text in English.
4. With `CONTACT_EMAIL=hola@example.com` in `.env` (restart the portal), the footer shows the address.
   Without it, there is no contact line.
5. Expected: `pnpm --filter @guidesk/portal build && pnpm --filter @guidesk/portal bundle:check` passes
   with `/es`, `/en`, `/es/privacy`, and `/en/terms` listed.

## Scenario 2: Privacy policy and terms (US2)

1. Open `/es/privacy` and `/en/privacy`. Check:
   - the last-updated date;
   - the responsible party ("Guidesk", or `COMPANY_NAME`);
   - the data hosts and guests give;
   - that AI answers never receive door codes;
   - the providers: AWS us-east-1, Anthropic, Amazon SES, Google, the payment provider, Viator and
     Civitatis, Sentry;
   - retention: 12 months after checkout for messages and traces;
   - cookies: session and language only, and no banner;
   - rights within 30 days.
2. Open `/es/terms` and `/en/terms`. Check the sections from the spec (FR-007), with Costa Rica as the
   governing law.
3. Open `/es/sign-in` and an invitation link. The consent line links to both pages.
4. Open a published guide on `:3001`. The end of the home and the chat panel show "Privacidad", which
   opens `http://localhost:3000/es/privacy`.
5. `curl -s localhost:3000/robots.txt` and `curl -s localhost:3000/sitemap.xml` list only the six public
   URLs.
6. Expected: `pnpm --filter @guidesk/i18n test` passes (public catalogs parity), and `cd e2e && pnpm exec
   playwright test public-pages smoke --workers=1` passes (the axe checks for the public pages are in
   `public-pages.spec.ts`).

## Scenario 3: Installed app (US4)

1. `curl -s localhost:3000/manifest.webmanifest` shows `"start_url":"/start"`.
2. Opening `/start` signed in shows the start page. Signed out, it shows sign-in.

## Scenario 4: Demo workspace, locally (US3)

1. Build the API and run the seed with your local account's email:

   ```bash
   pnpm --filter @guidesk/api build
   pnpm --filter @guidesk/api demo:seed -- --email you@example.com
   ```

2. Expected output: the workspace "Demo · Guidesk", two guide URLs, and the line about copying the stay
   link. No token or code is printed.
3. In the portal, switch to "Demo · Guidesk". Check:
   - **Properties:** two properties, ready, with published guides.
   - **Stays:** past, current, and upcoming stays. Copy the current stay link and open it on a phone-sized
     window: the door code reveals.
   - **Inbox:** one conversation waits with the reason malfunction.
   - **Analytics, last 30 days:** every block shows values and a change against the previous period.
   - **Requests:** pending, confirmed, and declined.
4. Run it again. "Demo · Guidesk 2" appears, and the first workspace is unchanged.
5. Refusals:
   - `--email nobody@example.com` exits 4 (`unknown_account`);
   - `STAGE=production pnpm --filter @guidesk/api demo:seed -- --email you@example.com` exits 3
     (`production_refused`).
6. `pnpm --filter @guidesk/db report:pilot -- --from <75 days ago>` gives the same numbers as before the
   seed.
7. Expected: `pnpm --filter @guidesk/api test:integration -- demo-seed` passes.

## Scenario 5: Demo workspace on staging

1. Find the cluster, the API task definition, and the network settings:
   - The SST outputs and the ECS console list the cluster and the API service.
   - `aws ecs describe-services --cluster <cluster> --services <api service>` gives the task definition,
     subnets, and security groups.
2. Run a one-off task with the API's role and network:

   ```bash
   aws ecs run-task --cluster <cluster> --launch-type FARGATE \
     --task-definition <api task definition> \
     --network-configuration "awsvpcConfiguration={subnets=[<private subnets>],securityGroups=[<api security group>],assignPublicIp=DISABLED}" \
     --overrides '{"containerOverrides":[{"name":"<api container>","command":["node","dist/cli/demo-seed.js","--email","you@example.com"]}]}'
   ```

3. Read the output in the task's CloudWatch log stream. Expected: the same lines as locally, with no
   secret.
4. Open the staging portal and repeat the checks from Scenario 4, step 3, on a real phone.
5. On the production stage, the same command exits 3 (`production_refused`) and writes nothing.
