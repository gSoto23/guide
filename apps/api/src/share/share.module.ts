import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { LockedFieldsModule } from "../locked-fields/locked-fields.module.js";
import { GuestModule } from "../guest/guest.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ShareController } from "./share.controller.js";
import { ShareService } from "./share.service.js";
import { StayLinksService } from "./stay-links.service.js";

/** The Share screen (feature 004 research R14). */
@Module({
  imports: [TenancyModule, GuidesModule, LockedFieldsModule, GuestModule],
  controllers: [ShareController],
  providers: [ShareService, StayLinksService],
})
export class ShareModule {}
