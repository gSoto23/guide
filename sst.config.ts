/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Guidesk infrastructure on AWS (ADR-0009). Region: us-east-1.
 * Stages: dev, staging, production. Deploy with `pnpm sst deploy --stage <stage>`.
 */
export default $config({
  app(input) {
    return {
      name: "guidesk",
      home: "aws",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      providers: {
        aws: { region: "us-east-1" },
      },
    };
  },
  async run() {
    const { vpc } = await import("./infra/network");
    const secrets = await import("./infra/secrets");
    const { database } = await import("./infra/database");
    const { email } = await import("./infra/email");
    const { api, worker } = await import("./infra/services");
    const { router, portal } = await import("./infra/web");
    const { guideApp } = await import("./infra/guide");

    return {
      vpc: vpc.id,
      databaseHost: database.host,
      apiUrl: api.url,
      portalUrl: portal.url,
      routerUrl: router.url,
      emailSender: email?.sender,
      workerService: worker.service,
      secrets: Object.keys(secrets).join(","),
    };
  },
});
