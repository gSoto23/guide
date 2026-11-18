import { Module } from "@nestjs/common";
import { GuidesModule } from "../guides/guides.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { SharedBlocksController } from "./shared-blocks.controller.js";
import { SharedBlocksService } from "./shared-blocks.service.js";

/** Workspace shared content (feature 003 US7, research R14). */
@Module({
  imports: [TenancyModule, GuidesModule],
  controllers: [SharedBlocksController],
  providers: [SharedBlocksService],
})
export class SharedBlocksModule {}
