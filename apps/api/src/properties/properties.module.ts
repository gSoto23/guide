import { Module } from "@nestjs/common";
import { PhotosModule } from "../photos/photos.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { TimeZonesController } from "../time-zones/time-zones.controller.js";
import { PropertiesController } from "./properties.controller.js";
import { PropertiesService } from "./properties.service.js";
import { PropertyLimitService } from "./property-limit.service.js";

/** Properties (feature 002): creation, confirmation, limits, duplicate, remove, and restore. */
@Module({
  imports: [TenancyModule, PhotosModule],
  controllers: [PropertiesController, TimeZonesController],
  providers: [PropertyLimitService, PropertiesService],
  exports: [PropertyLimitService, PropertiesService],
})
export class PropertiesModule {}
