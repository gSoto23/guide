import { Module } from "@nestjs/common";
import { ExploreCoreModule } from "../explore/explore-core.module.js";
import { GuidesModule } from "../guides/guides.module.js";
import { LockedFieldsModule } from "../locked-fields/locked-fields.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { GuestExploreService } from "./explore.service.js";
import { GuestContext } from "./guest-context.js";
import { GuestGuideService } from "./guest-guide.service.js";
import { GuestController } from "./guest.controller.js";
import { GuestInterceptor } from "./guest.interceptor.js";
import { GuestOpens } from "./opens.service.js";
import { GuestReveals } from "./reveals.service.js";
import { GuestSessions } from "./sessions.service.js";
import { StayLinkSecrets } from "./stay-link-secrets.js";
import { GuestVerification } from "./verification.service.js";

/** The guest guide's public routes (feature 004 research R1, R12). */
@Module({
  imports: [TenancyModule, GuidesModule, LockedFieldsModule, ExploreCoreModule],
  controllers: [GuestController],
  providers: [
    GuestContext,
    GuestGuideService,
    GuestInterceptor,
    GuestReveals,
    GuestSessions,
    StayLinkSecrets,
    GuestVerification,
    GuestOpens,
    GuestExploreService,
  ],
  exports: [GuestContext, GuestSessions, StayLinkSecrets],
})
export class GuestModule {}
