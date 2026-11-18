import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { GuideMediaController } from "./guide-media.controller.js";
import { GuideMediaService } from "./guide-media.service.js";

/** Guide images and videos (feature 003 research R9). */
@Module({
  imports: [TenancyModule, GuidesModule],
  controllers: [GuideMediaController],
  providers: [GuideMediaService],
})
export class GuideMediaModule {}
