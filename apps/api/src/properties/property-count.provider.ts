import { Inject, Injectable } from "@nestjs/common";
import type { PropertyCountProvider } from "@guidesk/domain";
import { countActiveProperties, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

/**
 * Active properties per workspace, for the MFA threshold (FR-048, research R12). Removed
 * properties do not count. Runs in the system context, because guards check it before the
 * request's transaction starts.
 */
@Injectable()
export class ActivePropertyCount implements PropertyCountProvider {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  countProperties(workspaceId: string): Promise<number> {
    return countActiveProperties(this.handle.db, workspaceId);
  }
}
