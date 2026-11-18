import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { agentTrace, type Database } from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import { reportAlert } from "@guidesk/observability";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The assistant's daily cost check (feature 005 FR-032, research R12, NFR-10): the 7-day average
 * cost of assistant outputs that used the model. Above $0.10 it raises an operational alert. Reads
 * traces in the system context; reports numbers only.
 */
export const AGENT_COST_CHECK_CRON = "30 4 * * *";
/** $0.10 in micro-dollars. */
export const AGENT_COST_BUDGET_MICROS = 100_000;

export interface AgentCostReport {
  replies: number;
  averageMicros: number;
  overBudget: boolean;
}

export async function runAgentCostCheck(
  db: Database,
  alert: (name: string, tags: Record<string, string | number>) => void = reportAlert,
  /** Tests narrow the check to their own workspace; production checks every workspace. */
  workspaceId?: string,
): Promise<AgentCostReport> {
  const [row] = await db
    .select({
      replies: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${agentTrace.costUsdMicros}), 0)::bigint`,
    })
    .from(agentTrace)
    .where(
      and(
        isNotNull(agentTrace.model),
        gt(agentTrace.createdAt, sql`now() - interval '7 days'`),
        ...(workspaceId ? [eq(agentTrace.workspaceId, workspaceId)] : []),
      ),
    );
  const replies = row?.replies ?? 0;
  const averageMicros = replies > 0 ? Math.round(Number(row?.cost ?? 0) / replies) : 0;
  const overBudget = averageMicros > AGENT_COST_BUDGET_MICROS;
  if (overBudget) {
    alert("agent.cost_over_budget", {
      averageMicros,
      budgetMicros: AGENT_COST_BUDGET_MICROS,
      replies,
    });
  }
  return { replies, averageMicros, overBudget };
}

export function createAgentCostCheckHandler(deps: { db: Database; span?: JobSpanDeps }) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.agentCostCheck },
      async (span) => {
        const report = await runAgentCostCheck(deps.db);
        span.set({ "job.items": report.replies, "job.outcome": report.overBudget ? "over" : "ok" });
        if (report.overBudget) span.recordFailure("cost_over_budget");
      },
      deps.span,
    );
  };
}
