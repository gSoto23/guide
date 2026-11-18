import { Injectable } from "@nestjs/common";
import type { ShareStay } from "@guidesk/contracts";
import type { ShareTarget } from "./share.service.js";

/** Stay links (feature 004 US2). Filled in by the US2 tasks. */
@Injectable()
export class StayLinksService {
  async list(_workspaceId: string, _target: ShareTarget): Promise<ShareStay[]> {
    return [];
  }
}
