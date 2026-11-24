import { Module } from "@nestjs/common";
import { ExtrasModule } from "../extras/extras.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CalendarController } from "./calendar.controller.js";
import { CalendarService } from "./calendar.service.js";

/** The stay calendar and the stay view (feature 018). */
@Module({
  imports: [TenancyModule, ExtrasModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
