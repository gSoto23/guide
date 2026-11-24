import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PlanSummary } from "@guidesk/contracts";
import {
  limitsFor,
  monthlyAiReplies,
  openTopUps,
  topUpBalance,
  workspaceLimitInputs,
} from "@guidesk/db";
import { monthBounds } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "../database/request-db.js";

/**
 * The workspace's plan and usage for owners and admins (feature 011 FR-014, research R9). Every read
 * runs under the member's RLS context; nothing here writes the plan or a custom limit.
 */
@Injectable()
export class PlansService {
  constructor(
    private readonly requestDb: RequestDb,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async summary(workspaceId: string): Promise<PlanSummary> {
    const tx = this.requestDb.current();
    const now = new Date();
    const inputs = await workspaceLimitInputs(tx, workspaceId);
    if (!inputs) throw new ApiProblem(404, "not_found");
    const limits = limitsFor(inputs);
    // One request transaction runs one query at a time, so these are awaited in turn.
    const seats = await tx.execute<{ members: number; pending: number }>(sql`
      SELECT (SELECT count(*)::int FROM membership WHERE workspace_id = ${workspaceId}::uuid) AS members,
             (SELECT count(*)::int FROM invitation
               WHERE workspace_id = ${workspaceId}::uuid AND status = 'pending'
                 AND expires_at > ${now}) AS pending`);
    const changed = await tx.execute<{ plan_changed_at: Date | null }>(
      sql`SELECT plan_changed_at FROM workspace WHERE id = ${workspaceId}::uuid`,
    );
    const used = await monthlyAiReplies(tx, workspaceId, now);
    const topUps = await openTopUps(tx, workspaceId, now);
    const balance = await topUpBalance(tx, workspaceId, now);
    const members = Number(seats.rows[0]?.members ?? 0);
    const pending = Number(seats.rows[0]?.pending ?? 0);
    const changedAt = changed.rows[0]?.plan_changed_at ?? null;
    const { start, resetsAt } = monthBounds(now);
    return {
      workspaceId,
      plan: inputs.plan,
      changedAt: changedAt ? new Date(changedAt).toISOString() : null,
      limits: {
        properties: { ...limits.properties, used: inputs.activeProperties },
        seats: { ...limits.seats, used: members + pending, members, pending },
        aiReplies: {
          ...limits.aiReplies,
          used,
          monthStart: start.toISOString(),
          resetsAt: resetsAt.toISOString(),
        },
      },
      topUps: {
        balance,
        items: topUps.map(({ id, granted, remaining, addedAt, expiresAt }) => ({
          id,
          granted,
          remaining,
          addedAt,
          expiresAt,
        })),
      },
      contactEmail: this.config.PLAN_CONTACT_EMAIL ?? null,
    };
  }
}
