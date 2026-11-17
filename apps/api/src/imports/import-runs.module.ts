import { Module } from "@nestjs/common";
import { ImportRunsController } from "./import-runs.controller.js";
import { ImportRunsService } from "./import-runs.service.js";

/** Import runs shared by PMS and CSV imports (feature 002, T094). */
@Module({
  controllers: [ImportRunsController],
  providers: [ImportRunsService],
  exports: [ImportRunsService],
})
export class ImportRunsModule {}
