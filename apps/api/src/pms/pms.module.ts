import { Module } from "@nestjs/common";
import { ImportRunsModule } from "../imports/import-runs.module.js";
import { PmsController } from "./pms.controller.js";
import { PmsService } from "./pms.service.js";

/** PMS connections (feature 002 US4, T093). */
@Module({
  imports: [ImportRunsModule],
  controllers: [PmsController],
  providers: [PmsService],
})
export class PmsModule {}
