import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { StayMessage } from "@guidesk/contracts";
import { property, restrictedValuePublic } from "@guidesk/db";
import {
  documentText,
  lockedFieldPlaceholder,
  stayMessage,
  type MessageLanguage,
} from "@guidesk/domain";
import { RequestDb } from "../database/request-db.js";
import type { Caller } from "../guides/guide-view.service.js";
import { PublishService } from "../guides/publish.service.js";
import { RevealService } from "../locked-fields/reveal.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import type { ShareTarget } from "./share.service.js";
import { StayLinksService } from "./stay-links.service.js";

/**
 * The ready-to-paste stay message (feature 004 US4, FR-039, FR-040, research R14): the stay link,
 * times, address, and the published Arrival and Wi-Fi sections as plain text. Locked fields read
 * as their label unless the host asks for values, which come from feature 003's reveal service
 * and are recorded as an export. A public Wi-Fi password is ordinary content.
 */
@Injectable()
export class StayMessagesService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly publish: PublishService,
    private readonly reveals: RevealService,
    private readonly stayLinks: StayLinksService,
    private readonly securityLog: SecurityLogService,
  ) {}

  async message(
    caller: Caller,
    workspaceId: string,
    target: ShareTarget,
    stayId: string,
    language: MessageLanguage,
    withValues: boolean,
  ): Promise<StayMessage> {
    const stay = await this.stayLinks.eligible(workspaceId, target, stayId);
    const link = await this.stayLinks.copy(caller, workspaceId, target, stayId);
    const preview = await this.publish.preview(workspaceId, target.propertyId, {
      source: "published",
      lang: language,
    });
    const tx = this.requestDb.current();
    const fields = await tx
      .select({
        id: restrictedValuePublic.id,
        label: restrictedValuePublic.label,
        isPublic: restrictedValuePublic.isPublic,
      })
      .from(restrictedValuePublic)
      .where(eq(restrictedValuePublic.propertyId, target.propertyId));
    const [facts] = await tx
      .select({
        addressLine1: property.addressLine1,
        addressUnit: property.addressUnit,
        city: property.city,
      })
      .from(property)
      .where(and(eq(property.id, target.propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    const used = new Set<string>();
    const values = new Map<string, string>();
    const resolve = async (fieldId: string): Promise<void> => {
      const field = fields.find((candidate) => candidate.id === fieldId);
      if (!field || values.has(fieldId)) return;
      if (field.isPublic || withValues) {
        const value = await this.reveals.valueOf(workspaceId, target.propertyId, fieldId);
        if (value !== null) {
          values.set(fieldId, value);
          if (!field.isPublic) used.add(fieldId);
          return;
        }
      }
      values.set(fieldId, lockedFieldPlaceholder(field.label, language));
    };
    const sectionText = async (kind: string): Promise<string | null> => {
      const section = preview.sections.find((candidate) => candidate.kind === kind);
      if (!section) return null;
      const docs = section.items
        .filter((item) => item.kind === "text" && item.doc)
        .map((item) => item.doc);
      for (const doc of docs) {
        for (const match of JSON.stringify(doc).matchAll(/"fieldId":"([0-9a-f-]{36})"/g)) {
          await resolve(match[1]!);
        }
      }
      const text = docs
        .map((doc) => documentText(doc, (id) => values.get(id) ?? ""))
        .filter(Boolean)
        .join("\n");
      return text || null;
    };
    const arrival = await sectionText("arrival");
    const wifi = await sectionText("wifi");
    const address = [facts?.addressLine1, facts?.addressUnit, facts?.city]
      .filter(Boolean)
      .join(", ");
    const text = stayMessage(language, {
      propertyName: target.propertyName,
      stayLink: link.url,
      checkInDate: stay.checkInDate,
      checkoutDate: stay.checkoutDate,
      checkInTime: (stay.checkInTime ?? target.checkInTime)?.slice(0, 5) ?? null,
      checkoutTime: (stay.checkoutTime ?? target.checkoutTime)?.slice(0, 5) ?? null,
      address: address || null,
      arrival,
      wifi,
      confirmationCode: link.confirmationCode,
      guestName: stay.guestName,
    });
    if (used.size > 0) {
      await this.securityLog.record({
        type: "restricted_value.exported",
        outcome: "success",
        actorUserId: caller.userId,
        workspaceId,
        targetType: "stay",
        targetId: stayId,
        metadata: { propertyId: target.propertyId, stayId, fields: used.size, language },
      });
    }
    return { text };
  }
}
