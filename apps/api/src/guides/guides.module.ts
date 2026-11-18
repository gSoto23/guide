import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { GuideLimitsController } from "./guide-limits.controller.js";
import { GuideLimitsService } from "./guide-limits.service.js";
import { GuideViewService } from "./guide-view.service.js";
import { GuidesController } from "./guides.controller.js";
import { GuidesService } from "./guides.service.js";

/** The guide builder (feature 003): guides, sections, items, publishing, and limits. */
@Module({
  imports: [TenancyModule],
  controllers: [GuidesController, GuideLimitsController],
  providers: [GuideLimitsService, GuideViewService, GuidesService],
  exports: [GuideLimitsService, GuideViewService, GuidesService],
})
export class GuidesModule {}
