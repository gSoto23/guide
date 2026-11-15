import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DEFAULT_PILOT_SEAT_LIMIT, type SeatLimitProvider } from "@guidesk/domain";
import { workspace, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export const SEAT_LIMIT = Symbol("SEAT_LIMIT");

/** Pilot seat limits (FR-021, T073): set per workspace by Guidesk, else the default. */
@Injectable()
export class PilotSeatLimitProvider implements SeatLimitProvider {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async seatLimit(workspaceId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ limit: workspace.seatLimit })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    return row?.limit ?? DEFAULT_PILOT_SEAT_LIMIT;
  }
}
