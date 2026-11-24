import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments/payments.module.js";
import { PhotosModule } from "../photos/photos.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { PropertyExtrasController, ServiceRequestsController } from "./extras.controller.js";
import { ExtrasService } from "./extras.service.js";
import { ServiceRequestsService } from "./service-requests.service.js";

/** The catalog and add-on requests for members (feature 008); guest routes are in the guest module. */
@Module({
  imports: [TenancyModule, PaymentsModule, PhotosModule],
  controllers: [PropertyExtrasController, ServiceRequestsController],
  providers: [ExtrasService, ServiceRequestsService],
  // Feature 018: the stay view lists a stay's requests the same way.
  exports: [ServiceRequestsService],
})
export class ExtrasModule {}
