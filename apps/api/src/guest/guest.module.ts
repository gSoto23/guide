import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { LockedFieldsModule } from "../locked-fields/locked-fields.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { GuestContext } from "./guest-context.js";
import { GuestGuideService } from "./guest-guide.service.js";
import { GuestController } from "./guest.controller.js";
import { GuestInterceptor } from "./guest.interceptor.js";
import { GuestReveals } from "./reveals.service.js";
import { GuestSessions } from "./sessions.service.js";
import { StayLinkSecrets } from "./stay-link-secrets.js";

/** The guest guide's public routes (feature 004 research R1, R12). */
@Module({
  imports: [TenancyModule, GuidesModule, LockedFieldsModule],
  controllers: [GuestController],
  providers: [
    GuestContext,
    GuestGuideService,
    GuestInterceptor,
    GuestReveals,
    GuestSessions,
    StayLinkSecrets,
  ],
  exports: [GuestContext, StayLinkSecrets],
})
export class GuestModule {}
