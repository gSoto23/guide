import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { effectiveSeatLimit, isPlan, type SeatLimitProvider } from "@guidesk/domain";
import { workspace, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export const SEAT_LIMIT = Symbol("SEAT_LIMIT");

/** Seat limits from the plan or Guidesk's custom limit (FR-021; feature 011 FR-002, FR-003). */
@Injectable()
export class PlanSeatLimitProvider implements SeatLimitProvider {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async seatLimit(workspaceId: string): Promise<number | null> {
    const [row] = await this.handle.db
      .select({ plan: workspace.plan, limit: workspace.seatLimit })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    return effectiveSeatLimit({
      plan: isPlan(row?.plan) ? row.plan : "free",
      seatLimit: row?.limit ?? null,
    });
  }
}
