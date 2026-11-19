import { sql } from "drizzle-orm";
import { limitsFor, planUsageNotice, workspaceLimitInputs, type Database } from "@guidesk/db";
import { aiUsageThreshold, JOB_QUEUES, monthBounds, type AiUsageThreshold } from "@guidesk/domain";
import { renderPlanAiUsage, type EmailLocale } from "@guidesk/emails";
import type { EmailMessage } from "@guidesk/integrations";
import { membersOf } from "./chat-reply.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * AI usage emails, every 5 minutes (feature 011 research R5): for each workspace with AI replies
 * this UTC month, the highest threshold reached (80% or 100% of its limit) is claimed once in
 * `plan_usage_notice`, and only a new claim emails the owners, each in their language. Reaching
 * 100% first also claims 80%, so owners never get a late 80% email. Counts only.
 */
export const PLAN_USAGE_TICK_CRON = "*/5 * * * *";

export interface PlanUsageTickDeps {
  db: Database;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  now?: () => Date;
  span?: JobSpanDeps;
}

export interface PlanUsageTickReport {
  checked: number;
  notified: number;
}

function formatResetsAt(locale: EmailLocale, resetsAt: Date): string {
  const text = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-CR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(resetsAt);
  return `${text} UTC`;
}

/** Claims the thresholds up to `reached` for the month; true when `reached` itself is new. */
async function claim(
  db: Database,
  workspaceId: string,
  month: string,
  reached: AiUsageThreshold,
): Promise<boolean> {
  const thresholds = reached === 100 ? [80, 100] : [80];
  const claimed = await db
    .insert(planUsageNotice)
    .values(thresholds.map((threshold) => ({ workspaceId, month, threshold })))
    .onConflictDoNothing()
    .returning({ threshold: planUsageNotice.threshold });
  return claimed.some((row) => row.threshold === reached);
}

export async function runPlanUsageTick(deps: PlanUsageTickDeps): Promise<PlanUsageTickReport> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const { start, resetsAt } = monthBounds(now);
  const month = start.toISOString().slice(0, 10);
  const report: PlanUsageTickReport = { checked: 0, notified: 0 };
  // Workspaces with replies this month and no 100% notice yet; the sum uses (workspace_id, day).
  const rows = await db.execute<{ workspace_id: string; name: string; used: number }>(sql`
    SELECT u.workspace_id, w.name, sum(u.replies)::int AS used
      FROM chat_usage_daily u
      JOIN workspace w ON w.id = u.workspace_id
     WHERE u.day >= ${month}::date
       AND NOT EXISTS (
         SELECT 1 FROM plan_usage_notice n
          WHERE n.workspace_id = u.workspace_id AND n.month = ${month}::date AND n.threshold = 100)
     GROUP BY u.workspace_id, w.name
    HAVING sum(u.replies) > 0`);
  for (const row of rows.rows) {
    report.checked += 1;
    const inputs = await workspaceLimitInputs(db, row.workspace_id);
    if (!inputs) continue;
    const limit = limitsFor(inputs).aiReplies.limit;
    const used = Number(row.used);
    const reached = aiUsageThreshold(used, limit);
    if (!reached || !(await claim(db, row.workspace_id, month, reached))) continue;
    for (const owner of await membersOf(db, row.workspace_id, ["owner"])) {
      const rendered = await renderPlanAiUsage(owner.locale, {
        workspaceName: row.name,
        threshold: reached,
        used,
        limit,
        resetsAt: formatResetsAt(owner.locale, resetsAt),
        planLink: `${deps.portalUrl}/${owner.locale}/settings/plan`,
      });
      await deps.queueEmail({ to: owner.email, ...rendered, template: "plan.ai_usage" });
    }
    report.notified += 1;
  }
  return report;
}

/** The pg-boss handler: one span per run with counts only (constitution VIII). */
export function createPlanUsageTickHandler(deps: PlanUsageTickDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.planUsageTick },
      async (span) => {
        const report = await runPlanUsageTick(deps);
        span.set({
          "job.outcome": "completed",
          "workspaces.checked": report.checked,
          "workspaces.notified": report.notified,
        });
      },
      deps.span,
    );
  };
}
