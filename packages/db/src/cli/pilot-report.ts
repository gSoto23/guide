import { createDb } from "../client.js";
import { formatPilotMetrics, pilotMetrics } from "../reports/pilot.js";

/**
 * The founder's pilot report (feature 010 US5):
 * `pnpm --filter @guidesk/db report:pilot -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--json]`.
 * Runs with the migration user's privileges, outside the portal; prints aggregates only.
 */
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const from = option("from");
const to = option("to") ?? new Date().toISOString().slice(0, 10);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!from || !DAY.test(from) || !DAY.test(to) || from > to) {
  console.error("Usage: report:pilot -- --from YYYY-MM-DD [--to YYYY-MM-DD] [--json]");
  process.exit(1);
}
const handle = createDb(url, { max: 1 });
try {
  const metrics = await pilotMetrics(handle.db, { from, to });
  console.warn(
    args.includes("--json") ? JSON.stringify(metrics, null, 2) : formatPilotMetrics(metrics),
  );
} finally {
  await handle.pool.end();
}
