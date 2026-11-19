import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { PlansController } from "./plans.controller.js";
import { PlansService } from "./plans.service.js";

/** Plan and limits for owners and admins (feature 011). */
@Module({
  imports: [TenancyModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
