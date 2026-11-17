import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { StaysController } from "./stays.controller.js";
import { StaysService } from "./stays.service.js";

/** Stays from feeds, the PMS, and by hand (US3, T076). */
@Module({
  imports: [PropertiesModule, TenancyModule],
  controllers: [StaysController],
  providers: [StaysService],
})
export class StaysModule {}
