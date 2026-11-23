import { databaseUrlFromParts } from "../client.js";
import { runMigrations } from "../migrate.js";

/**
 * Applies pending migrations. Locally it reads DATABASE_URL; on AWS the connection arrives in parts
 * (DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_SSLMODE, and the password
 * from Secrets Manager), so it runs as a one-off task of the API's task definition:
 * `node node_modules/@guidesk/db/dist/cli/migrate.js` (scripts/aws-task.sh migrate).
 */
const url = process.env.DATABASE_URL ?? databaseUrlFromParts(process.env);
if (!url) {
  console.error(
    "DATABASE_URL, or DATABASE_HOST, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD, are required",
  );
  process.exit(1);
}
await runMigrations(url);
console.warn("Migrations applied");
