import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ExtractionsController } from "./extractions.controller.js";
import { ExtractionsService } from "./extractions.service.js";

/** Listing extraction requests (US2, T058). */
@Module({
  imports: [TenancyModule],
  controllers: [ExtractionsController],
  providers: [ExtractionsService],
})
export class ExtractionsModule {}
