import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { PropertyExtrasController, ServiceRequestsController } from "./extras.controller.js";
import { ExtrasService } from "./extras.service.js";
import { ServiceRequestsService } from "./service-requests.service.js";

/** The catalog and add-on requests for members (feature 008); guest routes are in the guest module. */
@Module({
  imports: [TenancyModule, PaymentsModule],
  controllers: [PropertyExtrasController, ServiceRequestsController],
  providers: [ExtrasService, ServiceRequestsService],
})
export class ExtrasModule {}
