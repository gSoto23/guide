import { Injectable } from "@nestjs/common";
import { roomLeft } from "@guidesk/domain";
import { lockPropertySlots, type Transaction } from "@guidesk/db";
import { ApiProblem } from "../common/problem.js";

export interface CreationSlots {
  /** Null when the plan has no property limit (feature 011). */
  limit: number | null;
  used: number;
  /** Properties that can still be created; capped imports take at most this many. */
  free: number;
}

/**
 * The property limit on every creation path (FR-047, FR-049, research R12). It locks the
 * workspace row inside the caller's transaction, so the count and the insert that follows are
 * atomic, and parallel creations cannot exceed the limit.
 */
@Injectable()
export class PropertyLimitService {
  /**
   * Reserves room for `count` new properties. With `capped`, an import takes what fits and only
   * fails when nothing fits.
   */
  async withCreationSlot(
    tx: Transaction,
    workspaceId: string,
    count: number,
    options: { capped?: boolean } = {},
  ): Promise<CreationSlots> {
    const slots = await lockPropertySlots(tx, workspaceId);
    if (!slots) throw new ApiProblem(404, "not_found");
    if (slots.workspaceStatus === "pending_deletion") {
      throw new ApiProblem(409, "workspace_pending_deletion");
    }
    const limit = slots.limit;
    const free = roomLeft(limit, slots.used);
    if (free === 0 || (!options.capped && count > free)) {
      throw new ApiProblem(409, "plan_limit_reached", undefined, {
        details: { limit, used: slots.used },
      });
    }
    return { limit, used: slots.used, free };
  }
}
