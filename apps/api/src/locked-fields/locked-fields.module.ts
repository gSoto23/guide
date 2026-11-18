import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { LockedFieldsController, MoveToLockedFieldController } from "./locked-fields.controller.js";
import { LockedFieldsService } from "./locked-fields.service.js";
import { RevealService } from "./reveal.service.js";

/** Locked fields (feature 003 US2, research R4). */
@Module({
  imports: [TenancyModule, GuidesModule],
  controllers: [LockedFieldsController, MoveToLockedFieldController],
  providers: [LockedFieldsService, RevealService],
  exports: [LockedFieldsService],
})
export class LockedFieldsModule {}
