import { createDb, databaseUrlFromParts } from "../client.js";
import {
  addTopUp,
  correctTopUp,
  formatPlanReport,
  formatTopUps,
  listTopUps,
  parseCustomLimit,
  parseFeePercent,
  parseTopUpReplies,
  PlanAdminError,
  setPlan,
  showPlan,
} from "../plans/admin.js";

/**
 * The founder's plan tool (feature 011 US3; top-ups from feature 019 US3):
 * `pnpm --filter @guidesk/db plan:set -- --workspace <uuid> --plan free|pro|business
 *   [--properties <n>|plan] [--seats <n>|plan] [--ai-replies <n>|plan] --note "<text>"`
 * `pnpm --filter @guidesk/db plan:show -- --workspace <uuid> [--json]`
 * `pnpm --filter @guidesk/db plan:topup -- --workspace <uuid> --replies <n> --note "<text>" [--yes]`
 * `pnpm --filter @guidesk/db plan:topups -- --workspace <uuid> [--json]`
 * `pnpm --filter @guidesk/db plan:topup-correct -- --top-up <uuid> --remaining <n> --note "<text>"`
 * Runs with the migration user's privileges, outside the portal and the API. Locally it reads
 * DATABASE_URL; on AWS (`scripts/aws-task.sh <stage> plan …`) the connection arrives in parts.
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
  '  plan:topup -- --workspace <uuid> --replies <1-100000> --note "<text>" [--yes]',
  "  plan:topups -- --workspace <uuid> [--json]",
  '  plan:topup-correct -- --top-up <uuid> --remaining <n> --note "<text>"',
].join("\n");

const url = process.env.DATABASE_URL ?? databaseUrlFromParts(process.env);
if (!url) {
  console.error(
    "DATABASE_URL, or DATABASE_HOST, DATABASE_NAME, DATABASE_USER, and DATABASE_PASSWORD, are required",
  );
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
  } else if (command === "topup") {
    const row = await addTopUp(handle.db, {
      workspaceId,
      replies: parseTopUpReplies(option("replies")),
      note: option("note") ?? "",
      confirmed: args.includes("--yes"),
    });
    console.warn(`Top-up ${row.id} added: ${row.granted} replies, expires ${row.expiresAt}.`);
    console.warn(formatPlanReport(await showPlan(handle.db, workspaceId)));
  } else if (command === "topups") {
    const rows = await listTopUps(handle.db, workspaceId);
    console.warn(args.includes("--json") ? JSON.stringify(rows, null, 2) : formatTopUps(rows));
  } else if (command === "topup-correct") {
    const remaining = option("remaining");
    const row = await correctTopUp(handle.db, {
      topUpId: option("top-up") ?? "",
      remaining: remaining !== undefined && /^\d+$/.test(remaining) ? Number(remaining) : -1,
      note: option("note") ?? "",
    });
    console.warn(`Top-up ${row.id} corrected: ${row.remaining} of ${row.granted} left.`);
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
