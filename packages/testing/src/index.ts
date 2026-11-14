import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createOwnerRole, runMigrations } from "@guidesk/db";

export interface TestDatabase {
  /** Connection URI for the non-superuser owner (migrations already applied). */
  url: string;
  stop(): Promise<void>;
}

/** Same major version as production (ADR-0009). */
export const POSTGRES_IMAGE = "postgres:16.16-alpine";

/**
 * Starts a disposable PostgreSQL container and applies every migration. Requires Docker.
 * Used by Vitest global setups for integration tests (research R14).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase("guidesk")
    .withUsername("guidesk")
    .withPassword("guidesk_test_only")
    .start();
  // A non-superuser owner, like the RDS master user, so RLS and grants apply as in production.
  const url = await createOwnerRole(container.getConnectionUri());
  await runMigrations(url);
  return {
    url,
    stop: async () => {
      await container.stop();
    },
  };
}
