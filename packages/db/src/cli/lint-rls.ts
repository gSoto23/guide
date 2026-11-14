import { runMigrations } from "../migrate.js";
import { findTablesWithoutForcedRls } from "../rls-check.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
await runMigrations(url);
const offenders = await findTablesWithoutForcedRls(url);
if (offenders.length > 0) {
  console.error(
    `Tables reachable by guidesk_app or holding tenant data without ENABLE + FORCE ROW LEVEL SECURITY: ${offenders.join(", ")}`,
  );
  process.exit(1);
}
console.warn(
  "RLS check passed: every tenant or request-reachable table has forced row-level security",
);
