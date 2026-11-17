import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CalendarFeedsController } from "./calendar-feeds.controller.js";
import { CalendarFeedsService } from "./calendar-feeds.service.js";

/** Calendar feeds: saved after a check through the isolated feed reader (US3, T075). */
@Module({
  imports: [PropertiesModule, TenancyModule],
  controllers: [CalendarFeedsController],
  providers: [CalendarFeedsService],
  exports: [CalendarFeedsService],
})
export class CalendarFeedsModule {}
