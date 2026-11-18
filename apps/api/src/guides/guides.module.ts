import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { GuideLimitsController } from "./guide-limits.controller.js";
import { GuideLimitsService } from "./guide-limits.service.js";

/** The guide builder (feature 003): guides, sections, items, publishing, and limits. */
@Module({
  imports: [TenancyModule],
  controllers: [GuideLimitsController],
  providers: [GuideLimitsService],
  exports: [GuideLimitsService],
})
export class GuidesModule {}
