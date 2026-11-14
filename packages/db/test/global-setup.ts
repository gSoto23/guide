import type { TestProject } from "vitest/node";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { runMigrations } from "../src/migrate.js";
import { createOwnerRole } from "../src/provision.js";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// @guidesk/testing depends on this package, so the DB package starts its own container here.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer("postgres:16.16-alpine")
    .withDatabase("guidesk")
    .withUsername("guidesk")
    .withPassword("guidesk_test_only")
    .start();
  // Migrations and tests run as a non-superuser owner, like the RDS master user (T103).
  const url = await createOwnerRole(container.getConnectionUri());
  await runMigrations(url);
  project.provide("databaseUrl", url);
  return async () => {
    await container.stop();
  };
}
