import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { guideOpenDaily } from "@guidesk/db";
import { todayIn } from "@guidesk/domain";
import { RateLimitService } from "../common/rate-limit.service.js";
import { GuestContext } from "./guest-context.js";

/** Opens counted per network address per hour; more are ignored silently (research R13). */
export const OPENS_PER_HOUR = 60;

/** Link previews, crawlers, and monitoring identify themselves; they are never counted (FR-050). */
const AUTOMATED =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord|skype|curl|wget|python-requests|lighthouse|pingdom|uptime/i;

/**
 * Guide opens (feature 004 US6, FR-049, FR-050, research R13): counts per property, day in the
 * property's time zone, and link kind. No address, device, or guest identifier is stored; the
 * browser sends at most one open per link and day.
 */
@Injectable()
export class GuestOpens {
  constructor(
    private readonly context: GuestContext,
    private readonly rateLimit: RateLimitService,
  ) {}

  async record(
    publicId: string,
    kind: "property" | "stay",
    userAgent: string | undefined,
    ipKey: string,
  ): Promise<void> {
    if (!userAgent || AUTOMATED.test(userAgent)) return;
    const target = await this.context.byPublicId(publicId);
    const limit = await this.rateLimit.consume(`guest-opens:ip:${ipKey}`, OPENS_PER_HOUR, 3600);
    if (!limit.allowed) return;
    await this.context.db
      .insert(guideOpenDaily)
      .values({
        workspaceId: target.workspaceId,
        propertyId: target.propertyId,
        day: todayIn(target.timeZone),
        linkKind: kind,
        opens: 1,
      })
      .onConflictDoUpdate({
        target: [guideOpenDaily.propertyId, guideOpenDaily.day, guideOpenDaily.linkKind],
        set: { opens: sql`${guideOpenDaily.opens} + 1` },
      });
  }
}
