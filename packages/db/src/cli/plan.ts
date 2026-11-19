import { createDb } from "../client.js";
import {
  formatPlanReport,
  parseCustomLimit,
  parseFeePercent,
  PlanAdminError,
  setPlan,
  showPlan,
} from "../plans/admin.js";

/**
 * The founder's plan tool (feature 011 US3):
 * `pnpm --filter @guidesk/db plan:set -- --workspace <uuid> --plan free|pro|business
 *   [--properties <n>|plan] [--seats <n>|plan] [--ai-replies <n>|plan] --note "<text>"`
 * `pnpm --filter @guidesk/db plan:show -- --workspace <uuid> [--json]`
 * Runs with the migration user's privileges, outside the portal and the API.
 */
const [command, ...args] = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const USAGE = [
  "Usage:",
  '  plan:set -- --workspace <uuid> --plan free|pro|business [--properties <n>|plan] [--seats <n>|plan] [--ai-replies <n>|plan] [--fee-percent <0-30>|plan] --note "<text>"',
  "  plan:show -- --workspace <uuid> [--json]",
].join("\n");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const workspaceId = option("workspace") ?? "";
const handle = createDb(url, { max: 1 });
try {
  if (command === "set") {
    const result = await setPlan(handle.db, {
      workspaceId,
      plan: option("plan") ?? "",
      properties: parseCustomLimit("properties", option("properties")),
      seats: parseCustomLimit("seats", option("seats")),
      aiReplies: parseCustomLimit("ai-replies", option("ai-replies")),
      feeBps: parseFeePercent(option("fee-percent")),
      note: option("note") ?? "",
    });
    console.warn(`Plan changed from ${result.from} to ${result.to}.`);
    console.warn(formatPlanReport(await showPlan(handle.db, workspaceId)));
  } else if (command === "show") {
    const report = await showPlan(handle.db, workspaceId);
    console.warn(
      args.includes("--json") ? JSON.stringify(report, null, 2) : formatPlanReport(report),
    );
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof PlanAdminError)) throw error;
  console.error(`${error.message}\n${USAGE}`);
  process.exitCode = 1;
} finally {
  await handle.pool.end();
}
